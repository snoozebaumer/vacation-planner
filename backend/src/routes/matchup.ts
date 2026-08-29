import { Router, RequestHandler } from "express";
import { pool } from "../db/pool";
import { applyMatchResult } from "../services/elo";
import { ensureBucketsForVacation } from "../services/bucketAssignment";

export const matchupRouter = Router({ mergeParams: true });

type MatchupParams = { vacationId: string; userId: string };

interface MatchupPlaceRow {
  id: string;
  name: string;
  description: string | null;
  photo_url: string | null;
  photo_status: string;
  estimated_hours: number | null;
  bucket_id: string;
}

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

const getMatchup: RequestHandler<MatchupParams> = async (req, res) => {
  const { vacationId, userId } = req.params;

  await ensureBucketsForVacation(vacationId);

  const { rows: allPlaces } = await pool.query<MatchupPlaceRow>(
    `SELECT id, name, description, photo_url, photo_status, estimated_hours, bucket_id
     FROM places WHERE vacation_id = $1 AND research_status = 'done' AND bucket_id IS NOT NULL`,
    [vacationId]
  );

  // Places can only ever duel within their own bucket (comparing a bar to a
  // museum isn't a meaningful choice) — so a bucket with only one place in
  // it has nothing to duel against and is excluded from the pool entirely.
  const bucketCounts = new Map<string, number>();
  for (const p of allPlaces) bucketCounts.set(p.bucket_id, (bucketCounts.get(p.bucket_id) ?? 0) + 1);
  const duelablePlaces = allPlaces.filter((p) => (bucketCounts.get(p.bucket_id) ?? 0) >= 2);

  if (duelablePlaces.length < 2) {
    return void res.status(409).json({ error: "Not enough ready places for a matchup yet" });
  }

  const { rows: seenRows } = await pool.query(
    "SELECT place_id FROM user_round_seen WHERE user_id = $1",
    [userId]
  );
  const seenIds = new Set(seenRows.map((r) => r.place_id));
  let unseen = duelablePlaces.filter((p) => !seenIds.has(p.id));

  if (unseen.length === 0) {
    // Every duelable place has been seen at least once — previous round is
    // fully complete (this also covers the very first matchup, before
    // anything has been marked seen yet). Start a fresh round.
    await pool.query("DELETE FROM user_round_seen WHERE user_id = $1", [userId]);
    unseen = duelablePlaces;
  }

  const a = pickRandom(unseen);
  const bucketMates = duelablePlaces.filter((p) => p.bucket_id === a.bucket_id && p.id !== a.id);
  const unseenMates = bucketMates.filter((p) => !seenIds.has(p.id) && p.id !== a.id);
  // Prefer an unseen bucket-mate; if every other place in this bucket has
  // already been seen this round, pair with a random already-seen one so
  // the round can still progress rather than stalling.
  const b = unseenMates.length > 0 ? pickRandom(unseenMates) : pickRandom(bucketMates);

  const { rows: bucketRows } = await pool.query<{ name_en: string; name_de: string }>(
    "SELECT name_en, name_de FROM buckets WHERE id = $1",
    [a.bucket_id]
  );
  const bucket = bucketRows[0]
    ? { id: a.bucket_id, nameEn: bucketRows[0].name_en, nameDe: bucketRows[0].name_de }
    : null;

  res.json({ places: [a, b], bucket });
};

const postVote: RequestHandler<MatchupParams> = async (req, res) => {
  const { vacationId, userId } = req.params;
  const winnerId = String(req.body.winnerId ?? "");
  const loserId = String(req.body.loserId ?? "");
  if (!winnerId || !loserId || winnerId === loserId) {
    return void res.status(400).json({ error: "winnerId and loserId are required and must differ" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: places } = await client.query(
      "SELECT id, elo_rating FROM places WHERE id IN ($1, $2) AND vacation_id = $3 FOR UPDATE",
      [winnerId, loserId, vacationId]
    );
    const winner = places.find((p) => p.id === winnerId);
    const loser = places.find((p) => p.id === loserId);
    if (!winner || !loser) {
      await client.query("ROLLBACK");
      return void res.status(404).json({ error: "Place not found in this vacation" });
    }

    const { winnerRating, loserRating } = applyMatchResult(Number(winner.elo_rating), Number(loser.elo_rating));

    await client.query("UPDATE places SET elo_rating = $1 WHERE id = $2", [winnerRating, winnerId]);
    await client.query("UPDATE places SET elo_rating = $1 WHERE id = $2", [loserRating, loserId]);

    await client.query(
      `INSERT INTO matches (vacation_id, user_id, winner_place_id, loser_place_id, winner_elo_before, loser_elo_before)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [vacationId, userId, winnerId, loserId, winner.elo_rating, loser.elo_rating]
    );

    await client.query(
      `INSERT INTO user_round_seen (user_id, place_id) VALUES ($1, $2), ($1, $3)
       ON CONFLICT DO NOTHING`,
      [userId, winnerId, loserId]
    );

    // A round is complete once every duelable place in the vacation has
    // appeared in at least one matchup for this user.
    const { rows: countRows } = await client.query(
      `SELECT
         (SELECT count(*) FROM places p
            WHERE p.vacation_id = $1 AND p.research_status = 'done' AND p.bucket_id IS NOT NULL
              AND (SELECT count(*) FROM places p2 WHERE p2.vacation_id = $1 AND p2.bucket_id = p.bucket_id) >= 2
         ) AS total,
         (SELECT count(*) FROM user_round_seen urs
            JOIN places p ON p.id = urs.place_id
            WHERE urs.user_id = $2 AND p.vacation_id = $1) AS seen`,
      [vacationId, userId]
    );
    const total = Number(countRows[0].total);
    const seen = Number(countRows[0].seen);
    const roundCompleted = total > 0 && seen >= total;

    await client.query("COMMIT");
    res.json({ winnerElo: winnerRating, loserElo: loserRating, roundCompleted });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[matchup] vote failed:", err);
    res.status(500).json({ error: "Failed to record vote" });
  } finally {
    client.release();
  }
};

matchupRouter.get("/matchup", getMatchup);
matchupRouter.post("/vote", postVote);
