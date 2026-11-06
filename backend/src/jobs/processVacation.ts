import { pool } from "../db/pool";
import { researchPlaceDuration } from "../services/llmResearch";
import { inferSharedLocationContext } from "../services/locationContext";
import { ensureBucketsForVacation } from "../services/bucketAssignment";
import { mapWithConcurrency } from "../util/concurrency";
import { createSemaphore } from "../util/semaphore";

// LLM research calls all hit the same Ollama model instance, which —
// especially on CPU-only inference — gets slower per request the more of
// them run concurrently, so this stays tight. Photo lookups used to share
// this file (and its concurrency cap) but now happen eagerly per-place as
// soon as a place is added (see services/eagerPhoto.ts) — decoupled from
// Ollama entirely, so they get their own cap over there instead.
const LLM_CONCURRENCY = Number(process.env.LLM_CONCURRENCY ?? 1);
const RESEARCH_CONCURRENCY = Number(process.env.RESEARCH_CONCURRENCY ?? 2);

const llmSemaphore = createSemaphore(LLM_CONCURRENCY);

async function researchPlace(placeId: string, placeName: string, locationContext: string | null): Promise<void> {
  await pool.query("UPDATE places SET research_status = 'researching' WHERE id = $1", [placeId]);

  const research = await llmSemaphore
    .run(() => researchPlaceDuration(placeName, locationContext))
    .catch(() => ({ hours: 2, source: "fallback" as const, description: "" }));

  await pool.query(
    `UPDATE places SET
       estimated_hours = $1,
       research_status = 'done',
       research_source = $2,
       description = $3
     WHERE id = $4`,
    [research.hours, research.source, research.description || null, placeId]
  );
}

// Processes whatever's currently sitting at research_status='pending' for
// this vacation — NOT every place unconditionally, since this can now be
// called many times over a vacation's life (once per debounced batch during
// the draft phase, plus a final call once ranking starts) rather than the
// single one-shot call it used to be. Doesn't touch vacations.status itself
// — that's the caller's call (jobs/researchScheduler.ts), since only it
// knows whether this was a mid-draft batch or the final one.
export async function runResearchBatch(vacationId: string): Promise<void> {
  const { rows: pending } = await pool.query<{ id: string; name: string }>(
    "SELECT id, name FROM places WHERE vacation_id = $1 AND research_status = 'pending' ORDER BY created_at",
    [vacationId]
  );
  if (pending.length === 0) return;

  // Recomputed from every place in the vacation (not just this batch) each
  // time — cheap relative to per-place research, and stays accurate as the
  // list grows across multiple batches instead of being frozen from
  // whatever was known at the very first one.
  const { rows: allPlaces } = await pool.query<{ name: string }>(
    "SELECT name FROM places WHERE vacation_id = $1",
    [vacationId]
  );
  const locationContext = await inferSharedLocationContext(allPlaces.map((p) => p.name)).catch(() => null);
  if (locationContext) {
    console.log(`[processVacation] vacation ${vacationId}: inferred shared location "${locationContext}"`);
    await pool.query("UPDATE vacations SET location_context = $1 WHERE id = $2", [locationContext, vacationId]);
  }

  const startedAt = Date.now();
  let processedCount = 0;

  await mapWithConcurrency(pending, RESEARCH_CONCURRENCY, async (place) => {
    try {
      await researchPlace(place.id, place.name, locationContext);
    } catch (err) {
      console.error(`[processVacation] failed to research place "${place.name}":`, err);
      await pool.query(
        `UPDATE places SET research_status = 'failed', estimated_hours = 2 WHERE id = $1`,
        [place.id]
      );
    } finally {
      processedCount++;
      const elapsedSeconds = (Date.now() - startedAt) / 1000;
      const avgSeconds = elapsedSeconds / processedCount;
      await pool.query(
        `UPDATE vacations SET places_processed = places_processed + 1, avg_place_process_seconds = $1 WHERE id = $2`,
        [avgSeconds, vacationId]
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
}
