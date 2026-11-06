import { Router, RequestHandler } from "express";
import { pool } from "../db/pool";
import { parsePlaceNames } from "../util/parsePlaceNames";
import { fetchPlacePhoto } from "../services/eagerPhoto";
import { scheduleBatch } from "../jobs/researchScheduler";

// Mounted at /api/vacations/:vacationId/places — the draft-phase
// collaborative places list. Every mutating route row-locks the vacation
// first (SELECT ... FOR UPDATE) and re-checks status='draft' inside that
// same transaction, so a straggling add/rename/delete can never land after
// a concurrent start-ranking has already committed — a plain pre-check
// (SELECT then separate write) would leave exactly that race open.
export const placesRouter = Router({ mergeParams: true });

type VacationParams = { vacationId: string };
type PlaceParams = { vacationId: string; placeId: string };

interface PlaceRow {
  id: string;
  name: string;
  updated_at: string;
}

function toPlace(row: PlaceRow) {
  return { id: row.id, name: row.name, updatedAt: row.updated_at };
}

// Also used by the draft-phase editing screen's poll to detect a status
// change (e.g. someone else just started ranking) without a second request.
const getPlaces: RequestHandler<VacationParams> = async (req, res) => {
  const { vacationId } = req.params;
  const { rows: vacationRows } = await pool.query<{ status: string }>(
    "SELECT status FROM vacations WHERE id = $1",
    [vacationId]
  );
  if (vacationRows.length === 0) return void res.status(404).json({ error: "Vacation not found" });

  const { rows } = await pool.query<PlaceRow>(
    "SELECT id, name, updated_at FROM places WHERE vacation_id = $1 ORDER BY created_at",
    [vacationId]
  );
  res.json({ vacationStatus: vacationRows[0].status, places: rows.map(toPlace) });
};

// Case-insensitively dedupes against both the rest of this same paste and
// this vacation's existing places — in the old one-shot flow, dedup only
// ever needed to cover a single paste, but places now accumulate across many
// independent calls from potentially different people, so the same name
// showing up twice is a real, expected case now (mirrors the existing
// case-insensitive "return the existing row" dedupe in routes/users.ts).
const addPlaces: RequestHandler<VacationParams> = async (req, res) => {
  const { vacationId } = req.params;
  const names = parsePlaceNames(String(req.body.text ?? ""));
  if (names.length === 0) return void res.status(400).json({ error: "No place names provided" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: vacationRows } = await client.query<{ status: string }>(
      "SELECT status FROM vacations WHERE id = $1 FOR UPDATE",
      [vacationId]
    );
    if (vacationRows.length === 0) {
      await client.query("ROLLBACK");
      return void res.status(404).json({ error: "Vacation not found" });
    }
    if (vacationRows[0].status !== "draft") {
      await client.query("ROLLBACK");
      return void res.status(409).json({ error: "Ranking has already started" });
    }

    const { rows: existingRows } = await client.query<{ name: string }>(
      "SELECT name FROM places WHERE vacation_id = $1",
      [vacationId]
    );
    const existingLower = new Set(existingRows.map((r) => r.name.toLowerCase()));

    const created: PlaceRow[] = [];
    let skipped = 0;
    for (const name of names) {
      if (existingLower.has(name.toLowerCase())) {
        skipped++;
        continue;
      }
      existingLower.add(name.toLowerCase());
      const { rows } = await client.query<PlaceRow>(
        "INSERT INTO places (vacation_id, name) VALUES ($1, $2) RETURNING id, name, updated_at",
        [vacationId, name]
      );
      created.push(rows[0]);
    }

    await client.query("COMMIT");
    res.status(201).json({ created: created.map(toPlace), skipped });

    // Fire-and-forget, outside the transaction, after responding — photos
    // eagerly per place (own concurrency, not Ollama-gated), research
    // batched via the debounce scheduler.
    for (const place of created) {
      fetchPlacePhoto(place.id, place.name, vacationId).catch(() => {});
    }
    if (created.length > 0) scheduleBatch(vacationId);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[places] add failed:", err);
    res.status(500).json({ error: "Failed to add places" });
  } finally {
    client.release();
  }
};

const renamePlace: RequestHandler<PlaceParams> = async (req, res) => {
  const { vacationId, placeId } = req.params;
  const name = String(req.body.name ?? "").trim();
  const expectedUpdatedAt = req.body.expectedUpdatedAt;
  if (name.length === 0) return void res.status(400).json({ error: "name is required" });
  if (!expectedUpdatedAt) return void res.status(400).json({ error: "expectedUpdatedAt is required" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: vacationRows } = await client.query<{ status: string }>(
      "SELECT status FROM vacations WHERE id = $1 FOR UPDATE",
      [vacationId]
    );
    if (vacationRows.length === 0) {
      await client.query("ROLLBACK");
      return void res.status(404).json({ error: "Vacation not found" });
    }
    if (vacationRows[0].status !== "draft") {
      await client.query("ROLLBACK");
      return void res.status(409).json({ error: "Ranking has already started" });
    }

    const { rows } = await client.query<PlaceRow>(
      `UPDATE places SET name = $1, updated_at = now()
       WHERE id = $2 AND vacation_id = $3 AND updated_at = $4
       RETURNING id, name, updated_at`,
      [name, placeId, vacationId, expectedUpdatedAt]
    );
    if (rows.length === 0) {
      // Distinguish "doesn't exist" (someone deleted it) from "exists but
      // changed" (someone else renamed it first) so the frontend can show
      // the right message rather than a generic error either way.
      const { rows: stillExists } = await client.query("SELECT 1 FROM places WHERE id = $1 AND vacation_id = $2", [
        placeId,
        vacationId,
      ]);
      await client.query("ROLLBACK");
      return void res
        .status(stillExists.length > 0 ? 409 : 404)
        .json({ error: stillExists.length > 0 ? "This place was changed by someone else" : "This place was removed" });
    }

    await client.query("COMMIT");
    res.json(toPlace(rows[0]));
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[places] rename failed:", err);
    res.status(500).json({ error: "Failed to rename place" });
  } finally {
    client.release();
  }
};

// Idempotent by design — two people deleting the same place at once is a
// harmless no-op on the second call, not a conflict worth flagging.
const deletePlace: RequestHandler<PlaceParams> = async (req, res) => {
  const { vacationId, placeId } = req.params;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: vacationRows } = await client.query<{ status: string }>(
      "SELECT status FROM vacations WHERE id = $1 FOR UPDATE",
      [vacationId]
    );
    if (vacationRows.length === 0) {
      await client.query("ROLLBACK");
      return void res.status(404).json({ error: "Vacation not found" });
    }
    if (vacationRows[0].status !== "draft") {
      await client.query("ROLLBACK");
      return void res.status(409).json({ error: "Ranking has already started" });
    }

    await client.query("DELETE FROM places WHERE id = $1 AND vacation_id = $2", [placeId, vacationId]);
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[places] delete failed:", err);
    res.status(500).json({ error: "Failed to delete place" });
  } finally {
    client.release();
  }
};

placesRouter.get("/", getPlaces);
placesRouter.post("/", addPlaces);
placesRouter.patch("/:placeId", renamePlace);
placesRouter.delete("/:placeId", deletePlace);
