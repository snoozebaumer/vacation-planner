import { Router, RequestHandler } from "express";
import multer from "multer";
import { pool } from "../db/pool";
import { processVacation } from "../jobs/processVacation";
import { hashPassword, verifyPassword, signUnlockToken } from "../services/vacationAuth";
import { requireVacationUnlock } from "../middleware/vacationLock";

export const vacationsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 } });

function parsePlaceNames(raw: string): string[] {
  const names = raw
    .split(/\r?\n|,/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return Array.from(new Set(names));
}

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

vacationsRouter.post("/", upload.single("placesFile"), async (req, res) => {
  try {
    const name = String(req.body.name ?? "").trim();
    const durationDays = Number(req.body.durationDays);
    const activeHoursPerDay = Number(req.body.activeHoursPerDay);
    const avgTravelTimeHours =
      req.body.avgTravelTimeHours !== undefined && req.body.avgTravelTimeHours !== ""
        ? Number(req.body.avgTravelTimeHours)
        : 0.25;
    const password = String(req.body.password ?? "").trim();

    if (name.length < 3 || name.length > 100)
      return res.status(400).json({ error: "Vacation name must be between 3 and 100 characters" });
    if (!Number.isFinite(durationDays) || durationDays <= 0)
      return res.status(400).json({ error: "durationDays must be a positive number" });
    if (!Number.isFinite(activeHoursPerDay) || activeHoursPerDay <= 0 || activeHoursPerDay > 24)
      return res.status(400).json({ error: "activeHoursPerDay must be a positive number, at most 24" });
    if (!Number.isFinite(avgTravelTimeHours) || avgTravelTimeHours < 0)
      return res.status(400).json({ error: "avgTravelTimeHours must be a non-negative number" });

    const rawPlaces = req.file ? req.file.buffer.toString("utf-8") : String(req.body.placesText ?? "");
    const placeNames = parsePlaceNames(rawPlaces);
    if (placeNames.length < 2)
      return res.status(400).json({ error: "At least 2 places are required to create a ranking" });

    const passwordHash = password ? hashPassword(password) : null;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: vacationRows } = await client.query(
        `INSERT INTO vacations (name, duration_days, active_hours_per_day, avg_travel_time_hours, places_total, password_hash)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [name, durationDays, activeHoursPerDay, avgTravelTimeHours, placeNames.length, passwordHash]
      );
      const vacation = vacationRows[0];

      for (const placeName of placeNames) {
        await client.query("INSERT INTO places (vacation_id, name) VALUES ($1, $2)", [vacation.id, placeName]);
      }

      await client.query("COMMIT");
      res.status(201).json(toPublicVacation(vacation));

      processVacation(vacation.id).catch((err) => {
        console.error(`[vacations] background processing failed for ${vacation.id}:`, err);
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("[vacations] create failed:", err);
    res.status(500).json({ error: "Failed to create vacation" });
  }
});
