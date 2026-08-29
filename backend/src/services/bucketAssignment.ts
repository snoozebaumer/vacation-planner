import { pool } from "../db/pool";
import { classifyBuckets } from "./bucketClassifier";

// Classifies and persists buckets for whichever of a vacation's researched
// places don't have one yet. Safe to call repeatedly and from multiple
// places (end of processVacation, and lazily from any read path) — once a
// place has a bucket_id it's left alone, so re-running never reshuffles a
// place someone has already duelled/voted on.
export async function ensureBucketsForVacation(vacationId: string): Promise<void> {
  const { rows: places } = await pool.query<{ id: string; name: string; description: string | null }>(
    `SELECT id, name, description FROM places
     WHERE vacation_id = $1 AND research_status = 'done' AND bucket_id IS NULL`,
    [vacationId]
  );
  if (places.length === 0) return;

  const { buckets, assignments } = await classifyBuckets(places);
  if (buckets.length === 0) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const keyToId = new Map<string, string>();
    for (const b of buckets) {
      const { rows } = await client.query(
        `INSERT INTO buckets (vacation_id, key, name_en, name_de, is_generated)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (vacation_id, key) DO UPDATE SET name_en = EXCLUDED.name_en, name_de = EXCLUDED.name_de
         RETURNING id, key`,
        [vacationId, b.key, b.nameEn, b.nameDe, b.isGenerated]
      );
      keyToId.set(rows[0].key, rows[0].id);
    }

    for (const a of assignments) {
      const bucketId = keyToId.get(a.bucketKey);
      if (!bucketId) continue;
      await client.query(`UPDATE places SET bucket_id = $1 WHERE id = $2`, [bucketId, a.placeId]);
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export interface ActiveBucket {
  id: string;
  key: string;
  name_en: string;
  name_de: string;
  is_generated: boolean;
}

// Buckets that currently have at least one researched place assigned to
// them. A vacation's `buckets` table accumulates rows over time — a
// reclassification (rules changed, or a place's own classification shifts)
// can leave a bucket with zero places still sitting in the table — so any
// place that lists or validates against "this vacation's buckets" should
// go through here rather than querying the table directly, or a fully
// emptied-out bucket keeps showing up as something to rank/weight.
export async function getActiveBuckets(vacationId: string): Promise<ActiveBucket[]> {
  const { rows } = await pool.query<ActiveBucket>(
    `SELECT b.id, b.key, b.name_en, b.name_de, b.is_generated
     FROM buckets b
     WHERE b.vacation_id = $1
       AND EXISTS (
         SELECT 1 FROM places p
         WHERE p.bucket_id = b.id AND p.research_status = 'done'
       )
     ORDER BY b.name_en`,
    [vacationId]
  );
  return rows;
}
