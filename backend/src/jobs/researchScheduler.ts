import { pool } from "../db/pool";
import { runResearchBatch } from "./processVacation";

// How long to wait after the last place was added before actually running a
// research batch — lets someone paste a burst of places (or several people
// add within moments of each other) settle into one batch instead of
// researching things that might get deleted 10 seconds later.
const DEBOUNCE_MS = Number(process.env.RESEARCH_BATCH_DEBOUNCE_MS ?? 60_000);

// In-memory, per-process — deliberately no persistence. If the backend
// restarts mid-debounce the timer is simply lost, but nothing is silently
// dropped: any place still sitting at research_status='pending' gets swept
// up by the next trigger for that vacation (another add, or start-ranking's
// unconditional triggerFinalBatch), just possibly a bit later than planned.
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const running = new Set<string>();
const rerunNeeded = new Set<string>();

// Called after a place is added during the draft phase. (Re)starts this
// vacation's quiet-period timer — a new add always pushes it back out.
export function scheduleBatch(vacationId: string): void {
  const existing = timers.get(vacationId);
  if (existing) clearTimeout(existing);
  timers.set(
    vacationId,
    setTimeout(() => {
      timers.delete(vacationId);
      void runBatchNow(vacationId);
    }, DEBOUNCE_MS)
  );
}

// Called by start-ranking: don't make the user wait out the debounce window
// once they've explicitly said "go" — run whatever's still pending right now.
export async function triggerFinalBatch(vacationId: string): Promise<void> {
  const existing = timers.get(vacationId);
  if (existing) {
    clearTimeout(existing);
    timers.delete(vacationId);
  }
  await runBatchNow(vacationId);
}

// At most one batch in flight per vacation at a time — if one's already
// running when this fires, it just marks that another pass is needed once
// the current one finishes (rather than overlapping two batches, or losing
// whatever arrived mid-run).
async function runBatchNow(vacationId: string): Promise<void> {
  if (running.has(vacationId)) {
    rerunNeeded.add(vacationId);
    return;
  }
  running.add(vacationId);
  try {
    await runResearchBatch(vacationId);

    // Only ever flips to ready once ranking has actually started (status
    // left 'draft') AND there's nothing left pending — a mid-draft batch
    // finishing never marks the vacation ready on its own.
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM vacations
       WHERE id = $1 AND status = 'creating'
       AND NOT EXISTS (SELECT 1 FROM places WHERE vacation_id = $1 AND research_status = 'pending')`,
      [vacationId]
    );
    if (rows.length > 0) {
      await pool.query("UPDATE vacations SET status = 'ready' WHERE id = $1", [vacationId]);
    }
  } catch (err) {
    console.error(`[researchScheduler] batch failed for ${vacationId}:`, err);
    await pool.query("UPDATE vacations SET status = 'failed' WHERE id = $1 AND status = 'creating'", [vacationId]).catch(() => {});
  } finally {
    running.delete(vacationId);
    if (rerunNeeded.delete(vacationId)) {
      void runBatchNow(vacationId);
    }
  }
}
