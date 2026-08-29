import { Router, RequestHandler } from "express";
import { pool } from "../db/pool";

export const vetoRouter = Router({ mergeParams: true });

type VetoParams = { vacationId: string; userId: string };

const putVeto: RequestHandler<VetoParams> = async (req, res) => {
  const { vacationId, userId } = req.params;
  const placeId = String(req.body.placeId ?? "");
  if (!placeId) return void res.status(400).json({ error: "placeId is required" });

  const { rows: placeRows } = await pool.query("SELECT id FROM places WHERE id = $1 AND vacation_id = $2", [
    placeId,
    vacationId,
  ]);
  if (placeRows.length === 0) return void res.status(404).json({ error: "Place not found in this vacation" });

  const { rows: userRows } = await pool.query("SELECT id FROM users WHERE id = $1 AND vacation_id = $2", [
    userId,
    vacationId,
  ]);
  if (userRows.length === 0) return void res.status(404).json({ error: "User not found in this vacation" });

  // (vacation_id, user_id) is the primary key, so this upsert both sets a
  // fresh veto and replaces any existing one — a user can never have more
  // than one active veto at a time.
  await pool.query(
    `INSERT INTO vetoes (vacation_id, user_id, place_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (vacation_id, user_id) DO UPDATE SET place_id = EXCLUDED.place_id, created_at = now()`,
    [vacationId, userId, placeId]
  );

  res.json({ placeId });
};

const deleteVeto: RequestHandler<VetoParams> = async (req, res) => {
  const { vacationId, userId } = req.params;
  await pool.query("DELETE FROM vetoes WHERE vacation_id = $1 AND user_id = $2", [vacationId, userId]);
  res.json({ placeId: null });
};

vetoRouter.put("/veto", putVeto);
vetoRouter.delete("/veto", deleteVeto);
