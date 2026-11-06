import { pool } from "../db/pool";
import { computeUserRankings, FavoriteBadge, UserRanking } from "./userRankings";
import { ensureBucketsForVacation, getActiveBuckets } from "./bucketAssignment";
import { median } from "../util/stats";

export interface VetoInfo {
  userId: string;
  userName: string;
}

export interface RankedPlaceRow {
  id: string;
  name: string;
  description: string | null;
  elo_rating: string;
  estimated_hours: string | null;
  photo_url: string | null;
  photo_status: string;
  research_status: string;
  rank: number;
  fitsInBudget: boolean | null;
  cumulativeHoursAfter: number;
  favoritesOf: FavoriteBadge[];
  vetoedBy: VetoInfo[];
}

// One line of the hover breakdown: this bucket gave/received `hours` of
// budget to/from `otherBucketId`. Negative hours = given away, positive =
// received — see redistributeSurplus.
export interface BudgetAdjustment {
  otherBucketId: string;
  otherBucketNameEn: string;
  otherBucketNameDe: string;
  hours: number;
}

export interface BucketRanking {
  bucketId: string;
  bucketKey: string;
  nameEn: string;
  nameDe: string;
  budgetHours: number;
  cutoffIndex: number | null;
  places: RankedPlaceRow[];
  budgetAdjustments: BudgetAdjustment[];
}

export interface UserBucketWeights {
  userId: string;
  userName: string;
  weights: { bucketId: string; weightPct: number }[];
}

export interface RankingResult {
  vacation: {
    id: string;
    name: string;
    locationContext: string | null;
    durationDays: number;
    activeHoursPerDay: number;
    avgTravelTimeHours: number;
    budgetHours: number;
  };
  buckets: BucketRanking[];
  userRankings: UserRanking[];
  userWeights: UserBucketWeights[];
  myVeto: { placeId: string } | null;
}


// A bucket's time budget is the MEDIAN weight percentage among users who
// have actually submitted their priority sliders for this vacation, applied
// to the trip's total time budget. Buckets nobody has weighed in on yet
// (including every bucket, before anyone has submitted at all) fall back to
// an equal split, so there's always a usable budget to rank against.
async function computeBucketBudgets(
  vacationId: string,
  buckets: { id: string }[],
  totalBudgetHours: number
): Promise<Map<string, number>> {
  const { rows } = await pool.query<{ bucket_id: string; weight_pct: string }>(
    "SELECT bucket_id, weight_pct FROM bucket_weights WHERE vacation_id = $1",
    [vacationId]
  );
  const byBucket = new Map<string, number[]>();
  for (const r of rows) {
    const list = byBucket.get(r.bucket_id) ?? [];
    list.push(Number(r.weight_pct));
    byBucket.set(r.bucket_id, list);
  }

  const equalShare = 100 / Math.max(1, buckets.length);
  const budgets = new Map<string, number>();
  for (const b of buckets) {
    const values = byBucket.get(b.id);
    const pct = values && values.length > 0 ? median(values) : equalShare;
    budgets.set(b.id, totalBudgetHours * (pct / 100));
  }
  return budgets;
}

// A bucket can end up with more weight-derived budget than it has content to
// spend (e.g. it only has 5 hours of places but got assigned 8) — that
// leftover would otherwise just sit unused instead of helping a DIFFERENT
// bucket whose next-in-line place doesn't quite fit. This reclaims it: cap
// every over-provisioned bucket's usable budget at what it can actually
// spend, pool the difference, then hand that pool out.
//
// Deterministic and cheap to recompute on every call (like the rest of this
// module), so a user changing their weights just changes the inputs — there
// is no separate "stale redistribution" state to invalidate.
//
// The unit of allocation is ONE PLACE, not a bucket's whole remaining gap —
// a place either fits or it doesn't, so funding 80% of the hours needed to
// unlock the next one doesn't actually let anyone visit it; it just inflates
// a displayed number. So this repeatedly finds, across every recipient
// bucket at once, whichever bucket's very next not-yet-fitting place is
// currently the best value — weight ÷ cost-to-unlock-it — among those the
// remaining pool can actually afford, and fully funds just that one place.
// That bucket's "next place" then moves on and re-competes on equal footing
// next round; a bucket that keeps winning keeps winning because its next
// unlock keeps scoring highest, not because it "went first" once. Any
// remainder that can't complete a single further place anywhere is left
// unspent rather than dribbled out as an inert partial credit.
//
// Bounded by the total number of shortfall places (each round permanently
// completes one), so still fast enough to redo from scratch on every call.
//
// Tracks not just the resulting effective budgets but exactly which donor
// bucket(s) funded which unlock, so the UI can show a real breakdown instead
// of an opaque final number. Donors are drawn largest-surplus-first so a
// single unlock is covered by as few donors as possible (fewer, clearer
// line items) — when a cost spans more than one donor the specific pairing
// is somewhat arbitrary (any pairing yields the same effective totals).
function redistributeSurplus(
  originalBudgets: Map<string, number>,
  knownCumulativeByBucket: Map<string, number[]>
): { effective: Map<string, number>; transfers: { fromBucketId: string; toBucketId: string; hours: number }[] } {
  interface Recipient {
    id: string;
    knownCumulative: number[];
    nextIndex: number;
    effective: number;
    weight: number;
  }

  const effective = new Map<string, number>();
  const donors: { id: string; remaining: number }[] = [];
  const recipients: Recipient[] = [];

  for (const [id, budget] of originalBudgets) {
    const knownCumulative = knownCumulativeByBucket.get(id) ?? [];
    const demand = knownCumulative.length > 0 ? knownCumulative[knownCumulative.length - 1] : 0;
    if (demand <= budget) {
      effective.set(id, demand);
      const surplus = budget - demand;
      if (surplus > 1e-9) donors.push({ id, remaining: surplus });
    } else {
      effective.set(id, budget);
      const nextIndex = knownCumulative.findIndex((c) => c > budget);
      recipients.push({ id, knownCumulative, nextIndex, effective: budget, weight: budget });
    }
  }

  donors.sort((a, b) => b.remaining - a.remaining || a.id.localeCompare(b.id));

  const transfers: { fromBucketId: string; toBucketId: string; hours: number }[] = [];
  let donorIndex = 0;
  let reservoir = donors.reduce((sum, d) => sum + d.remaining, 0);

  while (reservoir > 1e-9) {
    let best: Recipient | null = null;
    let bestCost = 0;
    let bestScore = -1;
    for (const r of recipients) {
      if (r.nextIndex >= r.knownCumulative.length) continue; // this bucket has nothing left to unlock
      const cost = r.knownCumulative[r.nextIndex] - r.effective;
      if (cost > reservoir + 1e-9) continue; // can't afford this unlock right now
      const score = r.weight / Math.max(cost, 1e-9);
      if (score > bestScore || (score === bestScore && (!best || r.id.localeCompare(best.id) < 0))) {
        best = r;
        bestCost = cost;
        bestScore = score;
      }
    }
    if (!best) break; // nothing left is affordable with what remains

    let need = bestCost;
    while (need > 1e-9 && donorIndex < donors.length) {
      const donor = donors[donorIndex];
      const amount = Math.min(need, donor.remaining);
      transfers.push({ fromBucketId: donor.id, toBucketId: best.id, hours: amount });
      donor.remaining -= amount;
      need -= amount;
      reservoir -= amount;
      if (donor.remaining <= 1e-9) donorIndex++;
    }

    best.effective += bestCost;
    best.nextIndex += 1;
    effective.set(best.id, best.effective);
  }

  return { effective, transfers };
}

export async function computeRanking(vacationId: string, forUserId?: string | null): Promise<RankingResult | null> {
  await ensureBucketsForVacation(vacationId);

  const { rows: vacationRows } = await pool.query("SELECT * FROM vacations WHERE id = $1", [vacationId]);
  if (vacationRows.length === 0) return null;
  const vacation = vacationRows[0];

  const bucketRows = await getActiveBuckets(vacationId);

  const { rows: places } = await pool.query(
    `SELECT id, name, description, bucket_id, elo_rating, estimated_hours, photo_url, photo_status, research_status
     FROM places WHERE vacation_id = $1 AND research_status = 'done' ORDER BY elo_rating DESC, name ASC`,
    [vacationId]
  );

  const { rows: vetoRows } = await pool.query<{ place_id: string; user_id: string; user_name: string }>(
    `SELECT v.place_id, v.user_id, u.name AS user_name
     FROM vetoes v JOIN users u ON u.id = v.user_id
     WHERE v.vacation_id = $1
     ORDER BY v.created_at ASC`,
    [vacationId]
  );
  const vetoesByPlace = new Map<string, VetoInfo[]>();
  for (const v of vetoRows) {
    const list = vetoesByPlace.get(v.place_id) ?? [];
    list.push({ userId: v.user_id, userName: v.user_name });
    vetoesByPlace.set(v.place_id, list);
  }
  const vetoedIds = new Set(vetoesByPlace.keys());
  const myVetoRow = forUserId ? vetoRows.find((v) => v.user_id === forUserId) : undefined;

  const { userRankings, favoritesByPlace } = await computeUserRankings(vacationId);

  // Raw per-user weights, for the "everyone's priorities" chart — separate
  // from computeBucketBudgets' own query above, which only ever needed the
  // values themselves (for the median), never who submitted which one.
  const { rows: weightRows } = await pool.query<{
    user_id: string;
    user_name: string;
    bucket_id: string;
    weight_pct: string;
  }>(
    `SELECT bw.user_id, u.name AS user_name, bw.bucket_id, bw.weight_pct
     FROM bucket_weights bw JOIN users u ON u.id = bw.user_id
     WHERE bw.vacation_id = $1
     ORDER BY u.created_at ASC`,
    [vacationId]
  );
  const userWeightsMap = new Map<string, UserBucketWeights>();
  for (const r of weightRows) {
    let entry = userWeightsMap.get(r.user_id);
    if (!entry) {
      entry = { userId: r.user_id, userName: r.user_name, weights: [] };
      userWeightsMap.set(r.user_id, entry);
    }
    entry.weights.push({ bucketId: r.bucket_id, weightPct: Number(r.weight_pct) });
  }
  const userWeights = [...userWeightsMap.values()];

  const totalBudgetHours = Number(vacation.duration_days) * (Number(vacation.active_hours_per_day) - 1);
  const travelHours = Number(vacation.avg_travel_time_hours);
  const bucketBudgets = await computeBucketBudgets(vacationId, bucketRows, totalBudgetHours);

  const placesByBucket = new Map<string, typeof places>();
  for (const p of places) {
    if (!p.bucket_id) continue; // transient: classification hasn't landed for this place yet
    const list = placesByBucket.get(p.bucket_id) ?? [];
    list.push(p);
    placesByBucket.set(p.bucket_id, list);
  }

  // Ranking + veto-displacement ordering, computed once per bucket up front
  // so both the redistribution algorithm (needs each bucket's per-place
  // cumulative-cost curve) and the final display walk below use the exact
  // same order rather than risking the two drifting apart.
  const orderingByBucket = new Map<
    string,
    { orderedPlaces: (typeof places)[number][]; cumulativeAfter: number[]; knownCumulative: number[] }
  >();
  for (const [bucketId, bucketPlaces] of placesByBucket) {
    let rank = 0;
    let prevRating: number | null = null;
    const ranked = bucketPlaces.map((p) => {
      const rating = Math.round(Number(p.elo_rating));
      if (prevRating === null || rating !== prevRating) {
        rank += 1;
        prevRating = rating;
      }
      return { ...p, rank };
    });

    // Vetoed places jump this bucket's elo queue entirely (placed first, by
    // elo among themselves) so they get first claim on THIS bucket's budget;
    // everything else follows in normal elo order. The budget itself is
    // never bypassed — a vetoed place still spends its hours out of the
    // bucket's total, it just spends them before higher-elo bucket-mates do.
    const orderedPlaces = [
      ...ranked.filter((p) => vetoedIds.has(p.id)),
      ...ranked.filter((p) => !vetoedIds.has(p.id)),
    ];

    const cumulativeAfter: number[] = [];
    const knownCumulative: number[] = [];
    let running = 0;
    for (const p of orderedPlaces) {
      if (p.estimated_hours != null) {
        running += Number(p.estimated_hours);
        knownCumulative.push(running);
      }
      cumulativeAfter.push(running);
    }
    orderingByBucket.set(bucketId, { orderedPlaces, cumulativeAfter, knownCumulative });
  }

  const knownCumulativeByBucket = new Map(
    [...orderingByBucket.entries()].map(([id, o]) => [id, o.knownCumulative])
  );
  const { effective: effectiveBudgets, transfers } = redistributeSurplus(bucketBudgets, knownCumulativeByBucket);

  const bucketNames = new Map(bucketRows.map((b) => [b.id, { nameEn: b.name_en, nameDe: b.name_de }]));

  // The per-place greedy above can fund the same recipient from the same
  // donor across several separate rounds (its next place keeps winning,
  // then the one after that) — collapse those into one line per donor/
  // recipient pair before building the hover breakdown. An end user doesn't
  // care that it happened in two installments, just the total.
  const mergedTransfers = new Map<string, number>();
  for (const t of transfers) {
    const key = `${t.fromBucketId}|${t.toBucketId}`;
    mergedTransfers.set(key, (mergedTransfers.get(key) ?? 0) + t.hours);
  }

  // Below this, the line would render as "+0.0h"/"-0.0h" once rounded to
  // the one decimal place the tooltip actually displays — a real (if tiny)
  // top-up isn't wrong to have happened, but showing it this way just reads
  // as a bug rather than a fraction of an hour nobody would notice anyway.
  // The underlying effective budgets/fitsInBudget above are untouched by
  // this — it only hides line items too small for the display to represent.
  const DISPLAY_ROUNDING_THRESHOLD = 0.05;

  const adjustmentsByBucket = new Map<string, BudgetAdjustment[]>();
  for (const [key, hours] of mergedTransfers) {
    if (hours < DISPLAY_ROUNDING_THRESHOLD) continue;
    const [fromBucketId, toBucketId] = key.split("|");
    const fromName = bucketNames.get(fromBucketId);
    const toName = bucketNames.get(toBucketId);
    if (!fromName || !toName) continue; // shouldn't happen, but never surface a half-formed row

    const fromList = adjustmentsByBucket.get(fromBucketId) ?? [];
    fromList.push({ otherBucketId: toBucketId, otherBucketNameEn: toName.nameEn, otherBucketNameDe: toName.nameDe, hours: -hours });
    adjustmentsByBucket.set(fromBucketId, fromList);

    const toList = adjustmentsByBucket.get(toBucketId) ?? [];
    toList.push({ otherBucketId: fromBucketId, otherBucketNameEn: fromName.nameEn, otherBucketNameDe: fromName.nameDe, hours });
    adjustmentsByBucket.set(toBucketId, toList);
  }

  const buckets: BucketRanking[] = bucketRows
    .filter((b) => (placesByBucket.get(b.id)?.length ?? 0) > 0)
    .map((b) => {
      const { orderedPlaces, cumulativeAfter } = orderingByBucket.get(b.id)!;
      const budgetHours = effectiveBudgets.get(b.id) ?? 0;

      // No travel padding here: places within a bucket aren't necessarily
      // visited back-to-back in the real itinerary (a lunch stop sits
      // between two attractions, not between two other lunches), so this
      // is purely "do this bucket's chosen places' own hours fit its slice
      // of the trip budget" — travel overhead is already folded into the
      // trip-level budget shown at the top of the page.
      let cutoffIndex: number | null = null;
      const withBudget: RankedPlaceRow[] = orderedPlaces.map((p, i) => {
        const favoritesOf = favoritesByPlace.get(p.id) ?? [];
        const vetoedBy = vetoesByPlace.get(p.id) ?? [];
        const cumulativeHoursAfter = cumulativeAfter[i];

        if (p.estimated_hours == null) {
          return { ...p, fitsInBudget: null, cumulativeHoursAfter, favoritesOf, vetoedBy };
        }
        const fits = cumulativeHoursAfter <= budgetHours;
        if (!fits && cutoffIndex === null) cutoffIndex = i;
        return { ...p, fitsInBudget: fits, cumulativeHoursAfter, favoritesOf, vetoedBy };
      });

      return {
        bucketId: b.id,
        bucketKey: b.key,
        nameEn: b.name_en,
        nameDe: b.name_de,
        budgetHours,
        cutoffIndex,
        places: withBudget,
        budgetAdjustments: adjustmentsByBucket.get(b.id) ?? [],
      };
    })
    .sort((a, b) => a.nameEn.localeCompare(b.nameEn));

  return {
    vacation: {
      id: vacation.id,
      name: vacation.name,
      locationContext: vacation.location_context,
      durationDays: Number(vacation.duration_days),
      activeHoursPerDay: Number(vacation.active_hours_per_day),
      avgTravelTimeHours: travelHours,
      budgetHours: totalBudgetHours,
    },
    buckets,
    userRankings,
    userWeights,
    myVeto: myVetoRow ? { placeId: myVetoRow.place_id } : null,
  };
}
