import { Router, RequestHandler } from "express";
import { pool } from "../db/pool";
import { triggerFinalBatch } from "../jobs/researchScheduler";
import { hashPassword, verifyPassword, signUnlockToken } from "../services/vacationAuth";
import { requireVacationUnlock } from "../middleware/vacationLock";
import { median } from "../util/stats";

export const vacationsRouter = Router();

// Never send password_hash to the client — hasPassword is all the frontend
// needs to know whether to show the unlock screen.
function toPublicVacation<T extends { password_hash?: string | null }>(row: T) {
  const { password_hash, ...rest } = row;
  return { ...rest, hasPassword: password_hash != null };
}

vacationsRouter.get("/", async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT v.id, v.name, v.duration_days, v.active_hours_per_day, v.avg_travel_time_hours,
            v.status, v.places_total, v.places_processed, v.avg_place_process_seconds, v.password_hash, v.created_at,
            (SELECT u.name FROM users u WHERE u.vacation_id = v.id ORDER BY u.created_at ASC LIMIT 1) AS first_user_name
     FROM vacations v ORDER BY v.created_at DESC`
  );
  res.json(rows.map(toPublicVacation));
});

vacationsRouter.get("/:id", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM vacations WHERE id = $1", [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: "Vacation not found" });

  const vacation = rows[0];
  const remaining = vacation.places_total - vacation.places_processed;
  const etaSeconds =
    vacation.avg_place_process_seconds != null && remaining > 0
      ? Math.round((remaining / Math.max(1, Number(process.env.RESEARCH_CONCURRENCY ?? 2))) * vacation.avg_place_process_seconds)
      : vacation.status === "ready"
      ? 0
      : null;

  res.json(toPublicVacation({ ...vacation, eta_seconds: etaSeconds }));
});

// Every place's photo is hotlinked from a third-party site (no proxying/
// caching of our own), so an uncached one can be slow to load. This lets
// the client warm the browser's image cache for the whole vacation up
// front — a handful of KB of JSON — instead of every duel potentially
// paying for a first-time fetch of two brand-new photos.
vacationsRouter.get("/:id/photos", requireVacationUnlock("id"), async (req, res) => {
  const { rows } = await pool.query<{ photo_url: string }>(
    `SELECT photo_url FROM places
     WHERE vacation_id = $1 AND research_status = 'done' AND photo_url IS NOT NULL`,
    [req.params.id]
  );
  res.json({ photoUrls: rows.map((r) => r.photo_url) });
});

const unlockVacation: RequestHandler<{ id: string }> = async (req, res) => {
  const { id } = req.params;
  const password = String(req.body.password ?? "");

  const { rows } = await pool.query<{ password_hash: string | null }>(
    "SELECT password_hash FROM vacations WHERE id = $1",
    [id]
  );
  if (rows.length === 0) return void res.status(404).json({ error: "Vacation not found" });
  if (!rows[0].password_hash) return void res.json({ token: signUnlockToken(id) }); // not actually protected

  if (!password || !verifyPassword(password, rows[0].password_hash)) {
    return void res.status(401).json({ error: "Incorrect password" });
  }
  res.json({ token: signUnlockToken(id) });
};
vacationsRouter.post("/:id/unlock", unlockVacation);

// A password-protected vacation requires the password to delete, same as
// to view it — the unlock token isn't accepted here on purpose, since a
// token only proves "was let in at some point", not "knows the password
// right now" (e.g. it could be a returning session, or in principle a
// stolen/replayed token). Deleting cascades to every table that references
// this vacation (places, buckets, bucket_weights, matches, vetoes, users,
// and transitively user_round_seen) via their FK ON DELETE CASCADE rules —
// a single DELETE here is genuinely everything.
const deleteVacation: RequestHandler<{ id: string }> = async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query<{ password_hash: string | null }>(
    "SELECT password_hash FROM vacations WHERE id = $1",
    [id]
  );
  if (rows.length === 0) return void res.status(404).json({ error: "Vacation not found" });

  if (rows[0].password_hash) {
    const password = String(req.body?.password ?? "");
    if (!password || !verifyPassword(password, rows[0].password_hash)) {
      return void res.status(401).json({ error: "Incorrect password" });
    }
  }

  await pool.query("DELETE FROM vacations WHERE id = $1", [id]);
  res.json({ ok: true });
};
vacationsRouter.delete("/:id", deleteVacation);

// Just the shell — name and duration. Places and the active-hours/travel-
// time pacing preferences are now collected collaboratively afterward (see
// routes/places.ts, routes/tripPrefs.ts) rather than all at once here, so
// the vacation can be shared and joined the moment it exists.
vacationsRouter.post("/", async (req, res) => {
  try {
    const name = String(req.body.name ?? "").trim();
    const durationDays = Number(req.body.durationDays);
    const password = String(req.body.password ?? "").trim();

    if (name.length < 3 || name.length > 100)
      return res.status(400).json({ error: "Vacation name must be between 3 and 100 characters" });
    if (!Number.isFinite(durationDays) || durationDays <= 0)
      return res.status(400).json({ error: "durationDays must be a positive number" });

    const passwordHash = password ? hashPassword(password) : null;

    const { rows } = await pool.query(
      `INSERT INTO vacations (name, duration_days, password_hash) VALUES ($1, $2, $3) RETURNING *`,
      [name, durationDays, passwordHash]
    );
    res.status(201).json(toPublicVacation(rows[0]));
  } catch (err) {
    console.error("[vacations] create failed:", err);
    res.status(500).json({ error: "Failed to create vacation" });
  }
});

// Locks in the collaboratively-built places list and pacing preferences,
// and kicks off the (now possibly-already-partially-done, thanks to the
// draft-phase research batching) research/classification pipeline. Row-
// locked and re-checks status='draft' for the same reason every places.ts
// route does — a duplicate/stale click just gets a clean "already started"
// response instead of erroring or double-firing the pipeline.
const DEFAULT_ACTIVE_HOURS_PER_DAY = 8;
const DEFAULT_AVG_TRAVEL_TIME_HOURS = 0.25;

const startRanking: RequestHandler<{ id: string }> = async (req, res) => {
  const { id } = req.params;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: vacationRows } = await client.query<{ status: string }>(
      "SELECT status FROM vacations WHERE id = $1 FOR UPDATE",
      [id]
    );
    if (vacationRows.length === 0) {
      await client.query("ROLLBACK");
      return void res.status(404).json({ error: "Vacation not found" });
    }
    if (vacationRows[0].status !== "draft") {
      await client.query("ROLLBACK");
      return void res.status(409).json({ error: "Ranking has already started" });
    }

    const { rows: countRows } = await client.query<{ count: string }>(
      "SELECT count(*) FROM places WHERE vacation_id = $1",
      [id]
    );
    const placeCount = Number(countRows[0].count);
    if (placeCount < 2) {
      await client.query("ROLLBACK");
      return void res.status(400).json({ error: "At least 2 places are required to start ranking" });
    }

    const { rows: prefRows } = await client.query<{ active_hours_per_day: string; avg_travel_time_hours: string }>(
      "SELECT active_hours_per_day, avg_travel_time_hours FROM vacation_trip_prefs WHERE vacation_id = $1",
      [id]
    );
    const activeHoursPerDay =
      prefRows.length > 0 ? median(prefRows.map((r) => Number(r.active_hours_per_day))) : DEFAULT_ACTIVE_HOURS_PER_DAY;
    const avgTravelTimeHours =
      prefRows.length > 0
        ? median(prefRows.map((r) => Number(r.avg_travel_time_hours)))
        : DEFAULT_AVG_TRAVEL_TIME_HOURS;

    const { rows: updatedRows } = await client.query(
      `UPDATE vacations SET status = 'creating', places_total = $1, active_hours_per_day = $2, avg_travel_time_hours = $3
       WHERE id = $4 RETURNING *`,
      [placeCount, activeHoursPerDay, avgTravelTimeHours, id]
    );
    await client.query("COMMIT");
    res.json(toPublicVacation(updatedRows[0]));

    triggerFinalBatch(id).catch((err) => {
      console.error(`[vacations] final research batch failed for ${id}:`, err);
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[vacations] start-ranking failed:", err);
    res.status(500).json({ error: "Failed to start ranking" });
  } finally {
    client.release();
  }
};
vacationsRouter.post("/:id/start-ranking", startRanking);
