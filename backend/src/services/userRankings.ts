import { pool } from "../db/pool";
import { applyMatchResult } from "./elo";

const BASE_RATING = 400;
const TOP_PICK_ICON = "⭐";

export interface UserRankingPlace {
  id: string;
  name: string;
  photo_url: string | null;
  eloRating: number;
  rank: number;
}

export interface UserRankingBucket {
  bucketId: string;
  nameEn: string;
  nameDe: string;
  places: UserRankingPlace[];
}

export interface UserRanking {
  userId: string;
  userName: string;
  matchCount: number;
  buckets: UserRankingBucket[];
}

export interface FavoriteBadge {
  userId: string;
  userName: string;
  icon: string;
}

export interface UserRankingsResult {
  userRankings: UserRanking[];
  favoritesByPlace: Map<string, FavoriteBadge[]>;
}

// Each user's personal ranking is computed by replaying only that user's
// own votes through the same Elo formula, seeded fresh at the base rating —
// entirely independent of the shared/global places.elo_rating column, so
// one person's voting pattern can't be read off the group ranking. The
// resulting per-place ratings are then grouped and re-ranked per bucket,
// same as the main ranking, since a user's own elo across different buckets
// isn't any more comparable than the shared one is.
//
// Each user also gets a "top pick" sticker on whichever place holds rank 1
// within a given bucket — one sticker per user per bucket, never a
// cross-bucket top-3, since places in different buckets were never actually
// compared against each other in the first place. A bucket only earns a
// sticker once the user has cast at least one vote in it; otherwise every
// place there is still tied at the base rating and rank 1 would just be an
// arbitrary alphabetical tiebreak, not a real preference.
export async function computeUserRankings(vacationId: string): Promise<UserRankingsResult> {
  const { rows: users } = await pool.query<{ id: string; name: string }>(
    "SELECT id, name FROM users WHERE vacation_id = $1 ORDER BY created_at",
    [vacationId]
  );
  if (users.length === 0) return { userRankings: [], favoritesByPlace: new Map() };

  const { rows: places } = await pool.query<{
    id: string;
    name: string;
    photo_url: string | null;
    bucket_id: string | null;
  }>(
    "SELECT id, name, photo_url, bucket_id FROM places WHERE vacation_id = $1 AND research_status = 'done'",
    [vacationId]
  );
  if (places.length === 0) {
    return {
      userRankings: users.map((u) => ({ userId: u.id, userName: u.name, matchCount: 0, buckets: [] })),
      favoritesByPlace: new Map(),
    };
  }
  const placeBucket = new Map(places.map((p) => [p.id, p.bucket_id]));

  const { rows: buckets } = await pool.query<{ id: string; name_en: string; name_de: string }>(
    "SELECT id, name_en, name_de FROM buckets WHERE vacation_id = $1",
    [vacationId]
  );
  const bucketMeta = new Map(buckets.map((b) => [b.id, b]));

  const { rows: matches } = await pool.query<{ user_id: string; winner_place_id: string; loser_place_id: string }>(
    "SELECT user_id, winner_place_id, loser_place_id FROM matches WHERE vacation_id = $1 ORDER BY created_at ASC",
    [vacationId]
  );
  const matchesByUser = new Map<string, { winner: string; loser: string }[]>();
  for (const m of matches) {
    const list = matchesByUser.get(m.user_id) ?? [];
    list.push({ winner: m.winner_place_id, loser: m.loser_place_id });
    matchesByUser.set(m.user_id, list);
  }

  const favoritesByPlace = new Map<string, FavoriteBadge[]>();

  const userRankings = users.map((user) => {
    const userMatches = matchesByUser.get(user.id) ?? [];
    const ratings = new Map<string, number>(places.map((p) => [p.id, BASE_RATING]));
    const votesInBucket = new Map<string, number>();
    for (const m of userMatches) {
      const winnerRating = ratings.get(m.winner);
      const loserRating = ratings.get(m.loser);
      if (winnerRating === undefined || loserRating === undefined) continue;
      const result = applyMatchResult(winnerRating, loserRating);
      ratings.set(m.winner, result.winnerRating);
      ratings.set(m.loser, result.loserRating);

      const bucketId = placeBucket.get(m.winner);
      if (bucketId) votesInBucket.set(bucketId, (votesInBucket.get(bucketId) ?? 0) + 1);
    }

    const byBucket = new Map<string, UserRankingPlace[]>();
    for (const p of places) {
      if (!p.bucket_id) continue;
      const list = byBucket.get(p.bucket_id) ?? [];
      list.push({ id: p.id, name: p.name, photo_url: p.photo_url, eloRating: ratings.get(p.id)!, rank: 0 });
      byBucket.set(p.bucket_id, list);
    }

    const bucketResults: UserRankingBucket[] = [...byBucket.entries()]
      .map(([bucketId, bucketPlaces]) => {
        const sorted = [...bucketPlaces].sort(
          (a, b) => b.eloRating - a.eloRating || a.name.localeCompare(b.name)
        );
        let rank = 0;
        let prevRating: number | null = null;
        const ranked = sorted.map((p) => {
          const rounded = Math.round(p.eloRating);
          if (prevRating === null || rounded !== prevRating) {
            rank += 1;
            prevRating = rounded;
          }
          return { ...p, rank };
        });

        if ((votesInBucket.get(bucketId) ?? 0) > 0) {
          for (const p of ranked) {
            if (p.rank !== 1) continue;
            const list = favoritesByPlace.get(p.id) ?? [];
            list.push({ userId: user.id, userName: user.name, icon: TOP_PICK_ICON });
            favoritesByPlace.set(p.id, list);
          }
        }

        const meta = bucketMeta.get(bucketId);
        return { bucketId, nameEn: meta?.name_en ?? "", nameDe: meta?.name_de ?? "", places: ranked };
      })
      .sort((a, b) => a.nameEn.localeCompare(b.nameEn));

    return { userId: user.id, userName: user.name, matchCount: userMatches.length, buckets: bucketResults };
  });

  return { userRankings, favoritesByPlace };
}
