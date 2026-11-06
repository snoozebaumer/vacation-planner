import { pool } from "../db/pool";
import { findBestPhoto } from "./photoSearch";

// Fired once, fire-and-forget, right after a place is inserted during the
// draft (collaborative places-editing) phase — deliberately decoupled from
// the Ollama research batch (see jobs/researchScheduler.ts): photo lookup is
// IO-bound and cheap, so there's no reason to make someone wait through a
// debounce window just to see a picture appear.
//
// Uses whatever locationContext the vacation currently has on file rather
// than recomputing it — inferSharedLocationContext is itself an Ollama call,
// and doing that synchronously per photo-add would recreate exactly the
// contention this split exists to avoid. It gets progressively more accurate
// as research batches run and refine it; early photos just search a little
// less precisely disambiguated in the meantime.
export async function fetchPlacePhoto(placeId: string, placeName: string, vacationId: string): Promise<void> {
  try {
    const { rows } = await pool.query<{ location_context: string | null }>(
      "SELECT location_context FROM vacations WHERE id = $1",
      [vacationId]
    );
    const locationContext = rows[0]?.location_context ?? null;

    const photo = await findBestPhoto(placeName, locationContext).catch(() => null);
    await pool.query(
      `UPDATE places SET photo_url = $1, photo_aspect_ratio = $2, photo_status = $3 WHERE id = $4`,
      [photo?.url ?? null, photo?.aspectRatio ?? null, photo ? "done" : "failed", placeId]
    );
  } catch (err) {
    console.error(`[eagerPhoto] failed for place "${placeName}":`, err);
    await pool.query(`UPDATE places SET photo_status = 'failed' WHERE id = $1`, [placeId]).catch(() => {});
  }
}
