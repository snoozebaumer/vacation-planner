import { Router, RequestHandler } from "express";
import { pool } from "../db/pool";

export const usersRouter = Router({ mergeParams: true });

type VacationParams = { vacationId: string };

const listUsers: RequestHandler<VacationParams> = async (req, res) => {
  const { rows } = await pool.query(
    "SELECT * FROM users WHERE vacation_id = $1 ORDER BY created_at DESC",
    [req.params.vacationId]
  );
  res.json(rows);
};

const createUser: RequestHandler<VacationParams> = async (req, res) => {
  const name = String(req.body.name ?? "").trim();
  if (name.length < 3 || name.length > 100)
    return void res.status(400).json({ error: "Name must be between 3 and 100 characters" });

  const vacationId = req.params.vacationId;
  const { rows: vacationRows } = await pool.query("SELECT id FROM vacations WHERE id = $1", [vacationId]);
  if (vacationRows.length === 0) return void res.status(404).json({ error: "Vacation not found" });

  const { rows: existing } = await pool.query(
    "SELECT * FROM users WHERE vacation_id = $1 AND lower(name) = lower($2)",
    [vacationId, name]
  );
  if (existing.length > 0) return void res.status(200).json(existing[0]);

  const { rows } = await pool.query(
    "INSERT INTO users (vacation_id, name) VALUES ($1, $2) RETURNING *",
    [vacationId, name]
  );
  res.status(201).json(rows[0]);
};

usersRouter.get("/", listUsers);
usersRouter.post("/", createUser);
