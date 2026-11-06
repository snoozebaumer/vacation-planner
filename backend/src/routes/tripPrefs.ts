import { Router, RequestHandler } from "express";
import { pool } from "../db/pool";

// Mounted at /api/vacations/:vacationId/users/:userId — same base as
// bucketWeightsRouter. Draft-phase only: this is each user's personal
// pacing preference (active hours/day, avg travel time between places),
// median-combined into the vacation's actual values at start-ranking time
// (see vacations.ts) — same idea as bucket_weights, just two scalars
// instead of a per-bucket split.
export const tripPrefsRouter = Router({ mergeParams: true });

type UserParams = { vacationId: string; userId: string };

const getTripPrefs: RequestHandler<UserParams> = async (req, res) => {
  const { vacationId, userId } = req.params;
  const { rows } = await pool.query<{ active_hours_per_day: string; avg_travel_time_hours: string }>(
    "SELECT active_hours_per_day, avg_travel_time_hours FROM vacation_trip_prefs WHERE vacation_id = $1 AND user_id = $2",
    [vacationId, userId]
  );
  if (rows.length === 0) return void res.json({ prefs: null });
  res.json({
    prefs: {
      activeHoursPerDay: Number(rows[0].active_hours_per_day),
      avgTravelTimeHours: Number(rows[0].avg_travel_time_hours),
    },
  });
};

// Row-locks the vacation before checking status so this can never race a
// concurrent start-ranking commit — see the same pattern in places.ts.
const putTripPrefs: RequestHandler<UserParams> = async (req, res) => {
  const { vacationId, userId } = req.params;
  const activeHoursPerDay = Number(req.body.activeHoursPerDay);
  const avgTravelTimeHours = Number(req.body.avgTravelTimeHours);

  if (!Number.isFinite(activeHoursPerDay) || activeHoursPerDay <= 0 || activeHoursPerDay > 24) {
    return void res.status(400).json({ error: "activeHoursPerDay must be a positive number, at most 24" });
  }
  if (!Number.isFinite(avgTravelTimeHours) || avgTravelTimeHours < 0) {
    return void res.status(400).json({ error: "avgTravelTimeHours must be a non-negative number" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ status: string }>(
      "SELECT status FROM vacations WHERE id = $1 FOR UPDATE",
      [vacationId]
    );
    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return void res.status(404).json({ error: "Vacation not found" });
    }
    if (rows[0].status !== "draft") {
      await client.query("ROLLBACK");
      return void res.status(409).json({ error: "Ranking has already started" });
    }

    await client.query(
      `INSERT INTO vacation_trip_prefs (vacation_id, user_id, active_hours_per_day, avg_travel_time_hours)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (vacation_id, user_id) DO UPDATE SET
         active_hours_per_day = EXCLUDED.active_hours_per_day,
         avg_travel_time_hours = EXCLUDED.avg_travel_time_hours,
         updated_at = now()`,
      [vacationId, userId, activeHoursPerDay, avgTravelTimeHours]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[tripPrefs] failed to save:", err);
    return void res.status(500).json({ error: "Failed to save preferences" });
  } finally {
    client.release();
  }

  res.json({ ok: true });
};

tripPrefsRouter.get("/trip-prefs", getTripPrefs);
tripPrefsRouter.put("/trip-prefs", putTripPrefs);
