import { RequestHandler } from "express";
import { pool } from "../db/pool";
import { verifyUnlockToken } from "../services/vacationAuth";

// Applied to every router that exposes a protected vacation's actual
// content (users, matchup, ranking, export, buckets, weights, veto). This
// is the real enforcement point — a password-protected vacation's data
// simply isn't served without a valid token, regardless of how the request
// gets here (the Angular app, a direct URL, curl). The vacation's own
// GET-by-id stays unprotected on purpose: the frontend needs to know
// `hasPassword` before it can even show the unlock screen.
export function requireVacationUnlock(paramName = "vacationId"): RequestHandler {
  return async (req, res, next) => {
    const vacationId = req.params[paramName];
    if (!vacationId) return void next();

    const { rows } = await pool.query<{ password_hash: string | null }>(
      "SELECT password_hash FROM vacations WHERE id = $1",
      [vacationId]
    );
    // Missing vacation or no password set — let the route itself 404 or
    // proceed normally; this middleware only ever adds a restriction.
    if (rows.length === 0 || !rows[0].password_hash) return void next();

    const token = req.header("X-Vacation-Unlock");
    if (!token || !verifyUnlockToken(token, vacationId)) {
      return void res.status(401).json({ error: "This vacation is password protected", locked: true });
    }
    next();
  };
}
