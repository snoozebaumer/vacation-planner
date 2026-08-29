import { pool } from "../db/pool";
import { findBestPhoto } from "../services/photoSearch";
import { researchPlaceDuration } from "../services/llmResearch";
import { inferSharedLocationContext } from "../services/locationContext";
import { ensureBucketsForVacation } from "../services/bucketAssignment";
import { mapWithConcurrency } from "../util/concurrency";
import { createSemaphore } from "../util/semaphore";

// Photo lookups are IO-bound (network calls to DuckDuckGo) and can run with
// decent parallelism. LLM research calls all hit the same Ollama model
// instance, which — especially on CPU-only inference — gets slower per
// request the more of them run concurrently, so it gets its own, tighter cap.
const PHOTO_CONCURRENCY = Number(process.env.PHOTO_CONCURRENCY ?? 4);
const LLM_CONCURRENCY = Number(process.env.LLM_CONCURRENCY ?? 1);

const llmSemaphore = createSemaphore(LLM_CONCURRENCY);

async function processPlace(placeId: string, placeName: string, locationContext: string | null): Promise<void> {
  await pool.query("UPDATE places SET research_status = 'researching' WHERE id = $1", [placeId]);

  const [photo, research] = await Promise.all([
    findBestPhoto(placeName, locationContext).catch(() => null),
    llmSemaphore
      .run(() => researchPlaceDuration(placeName, locationContext))
      .catch(() => ({ hours: 2, source: "fallback" as const, description: "" })),
  ]);

  await pool.query(
    `UPDATE places SET
       estimated_hours = $1,
       research_status = 'done',
       research_source = $2,
       description = $3,
       photo_url = $4,
       photo_aspect_ratio = $5,
       photo_status = $6
     WHERE id = $7`,
    [
      research.hours,
      research.source,
      research.description || null,
      photo?.url ?? null,
      photo?.aspectRatio ?? null,
      photo ? "done" : "failed",
      placeId,
    ]
  );
}

export async function processVacation(vacationId: string): Promise<void> {
  const { rows: places } = await pool.query<{ id: string; name: string }>(
    "SELECT id, name FROM places WHERE vacation_id = $1 ORDER BY created_at",
    [vacationId]
  );

  const startedAt = Date.now();
  let processedCount = 0;

  const locationContext = await inferSharedLocationContext(places.map((p) => p.name)).catch(() => null);
  if (locationContext) {
    console.log(`[processVacation] vacation ${vacationId}: inferred shared location "${locationContext}"`);
    await pool.query("UPDATE vacations SET location_context = $1 WHERE id = $2", [locationContext, vacationId]);
  }

  try {
    await mapWithConcurrency(places, PHOTO_CONCURRENCY, async (place) => {
      try {
        await processPlace(place.id, place.name, locationContext);
      } catch (err) {
        console.error(`[processVacation] failed to process place "${place.name}":`, err);
        await pool.query(
          `UPDATE places SET research_status = 'failed', photo_status = 'failed', estimated_hours = 2 WHERE id = $1`,
          [place.id]
        );
      } finally {
        processedCount++;
        const elapsedSeconds = (Date.now() - startedAt) / 1000;
        const avgSeconds = elapsedSeconds / processedCount;
        await pool.query(
          `UPDATE vacations SET places_processed = $1, avg_place_process_seconds = $2 WHERE id = $3`,
          [processedCount, avgSeconds, vacationId]
        );
      }
    });

    try {
      await ensureBucketsForVacation(vacationId);
    } catch (err) {
      // Non-fatal: any read path (ranking, matchup, weights) lazily retries
      // classification for still-unbucketed places, so the vacation can
      // still be used even if this pass failed.
      console.error(`[processVacation] bucket classification failed for ${vacationId}:`, err);
    }

    await pool.query("UPDATE vacations SET status = 'ready' WHERE id = $1", [vacationId]);
  } catch (err) {
    console.error(`[processVacation] vacation ${vacationId} failed:`, err);
    await pool.query("UPDATE vacations SET status = 'failed' WHERE id = $1", [vacationId]);
  }
}
