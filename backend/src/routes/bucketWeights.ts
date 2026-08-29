import { Router, RequestHandler } from "express";
import { pool } from "../db/pool";
import { ensureBucketsForVacation, getActiveBuckets, ActiveBucket } from "../services/bucketAssignment";
import { UNCATEGORIZED_KEY } from "../services/bucketClassifier";

// Mounted at /api/vacations/:vacationId — lists this vacation's buckets.
export const bucketsRouter = Router({ mergeParams: true });

// Mounted at /api/vacations/:vacationId/users/:userId — a user's own weights.
export const bucketWeightsRouter = Router({ mergeParams: true });

type VacationParams = { vacationId: string };
type UserParams = { vacationId: string; userId: string };

// The auto-generated "Uncategorized" fallback isn't a real category — it
// only exists because the classifier's one-shot LLM call missed a place.
// Letting someone assign it a priority weight wouldn't mean anything, so
// it's excluded here specifically (both listing and validation, so they
// stay consistent) while still showing up on the ranking page, where
// there's a "Retry categorization" action to actually fix it.
function excludeUncategorized(buckets: ActiveBucket[]): ActiveBucket[] {
  return buckets.filter((b) => b.key !== UNCATEGORIZED_KEY);
}

const getBuckets: RequestHandler<VacationParams> = async (req, res) => {
  const { vacationId } = req.params;
  await ensureBucketsForVacation(vacationId);

  const allActive = await getActiveBuckets(vacationId);
  const buckets = excludeUncategorized(allActive);
  const uncategorizedBucket = allActive.find((b) => b.key === UNCATEGORIZED_KEY);

  // Example image per bucket: the photo of whichever place currently ranks
  // highest (by elo) in that bucket, so the slider screen shows something
  // concretely tied to this trip rather than a generic stock photo.
  const { rows: photoRows } = await pool.query<{ bucket_id: string; photo_url: string }>(
    `SELECT DISTINCT ON (bucket_id) bucket_id, photo_url
     FROM places
     WHERE vacation_id = $1 AND bucket_id IS NOT NULL AND photo_url IS NOT NULL
     ORDER BY bucket_id, elo_rating DESC`,
    [vacationId]
  );
  const photoByBucket = new Map(photoRows.map((r) => [r.bucket_id, r.photo_url]));

  // The weighing screen is a new vacation's first stop — if something
  // landed in the "Uncategorized" fallback, this is where people should
  // find out about it and be able to fix it, not just the ranking page.
  // It never gets a slider of its own though (see excludeUncategorized).
  let uncategorizedCount = 0;
  if (uncategorizedBucket) {
    const { rows } = await pool.query<{ count: string }>(
      "SELECT count(*) FROM places WHERE bucket_id = $1",
      [uncategorizedBucket.id]
    );
    uncategorizedCount = Number(rows[0].count);
  }

  res.json({
    buckets: buckets.map((b) => ({
      id: b.id,
      key: b.key,
      nameEn: b.name_en,
      nameDe: b.name_de,
      isGenerated: b.is_generated,
      exampleImageUrl: photoByBucket.get(b.id) ?? null,
    })),
    uncategorizedCount,
  });
};

// Re-runs classification for whichever places are currently sitting in the
// "Uncategorized" fallback bucket — the fix for the same completion-gap
// case a raw SQL reset was used for once, now available from the UI.
const retryUncategorized: RequestHandler<VacationParams> = async (req, res) => {
  const { vacationId } = req.params;

  const { rows: stray } = await pool.query<{ id: string }>(
    `SELECT p.id FROM places p JOIN buckets b ON b.id = p.bucket_id
     WHERE p.vacation_id = $1 AND b.key = $2`,
    [vacationId, UNCATEGORIZED_KEY]
  );
  if (stray.length === 0) return void res.json({ retried: 0 });

  await pool.query(`UPDATE places SET bucket_id = NULL WHERE id = ANY($1::uuid[])`, [stray.map((p) => p.id)]);
  await ensureBucketsForVacation(vacationId);

  res.json({ retried: stray.length });
};

const getWeights: RequestHandler<UserParams> = async (req, res) => {
  const { vacationId, userId } = req.params;
  const { rows } = await pool.query<{ bucket_id: string; weight_pct: string }>(
    "SELECT bucket_id, weight_pct FROM bucket_weights WHERE vacation_id = $1 AND user_id = $2",
    [vacationId, userId]
  );
  res.json({ weights: rows.map((r) => ({ bucketId: r.bucket_id, weightPct: Number(r.weight_pct) })) });
};

const putWeights: RequestHandler<UserParams> = async (req, res) => {
  const { vacationId, userId } = req.params;
  const weights: { bucketId: unknown; weightPct: unknown }[] = Array.isArray(req.body.weights)
    ? req.body.weights
    : [];

  const activeBuckets = excludeUncategorized(await getActiveBuckets(vacationId));
  const validIds = new Set(activeBuckets.map((b) => b.id));

  const parsed = weights
    .filter(
      (w): w is { bucketId: string; weightPct: number } =>
        typeof w.bucketId === "string" && typeof w.weightPct === "number"
    )
    .filter((w) => validIds.has(w.bucketId) && Number.isFinite(w.weightPct) && w.weightPct >= 0 && w.weightPct <= 100);

  const providedIds = new Set(parsed.map((w) => w.bucketId));
  if (parsed.length !== weights.length || providedIds.size !== validIds.size || parsed.length !== validIds.size) {
    return void res.status(400).json({ error: "weights must include every bucket for this vacation exactly once, each between 0 and 100" });
  }

  const total = parsed.reduce((sum, w) => sum + w.weightPct, 0);
  if (Math.abs(total - 100) > 0.5) {
    return void res.status(400).json({ error: "weights must add up to 100" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const w of parsed) {
      await client.query(
        `INSERT INTO bucket_weights (vacation_id, user_id, bucket_id, weight_pct)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (vacation_id, user_id, bucket_id) DO UPDATE SET weight_pct = EXCLUDED.weight_pct, updated_at = now()`,
        [vacationId, userId, w.bucketId, w.weightPct]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[bucketWeights] failed to save weights:", err);
    return void res.status(500).json({ error: "Failed to save weights" });
  } finally {
    client.release();
  }

  res.json({ ok: true });
};

bucketsRouter.get("/buckets", getBuckets);
bucketsRouter.post("/buckets/retry-uncategorized", retryUncategorized);
bucketWeightsRouter.get("/weights", getWeights);
bucketWeightsRouter.put("/weights", putWeights);
