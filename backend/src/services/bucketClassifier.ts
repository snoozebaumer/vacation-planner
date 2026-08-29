import { ollamaChat } from "./ollama";

export interface BucketPoolEntry {
  key: string;
  nameEn: string;
  nameDe: string;
  rule: string;
}

// A curated, translatable pool the classifier assigns places into. Kept
// deliberately narrow-scoped per entry so nearby concepts (a guided outdoor
// tour vs. a self-directed hike; a food-stall market vs. a general goods
// market) have an explicit tie-breaker instead of relying on vibes. A pool
// bucket only ends up visible to a given vacation if at least one place was
// actually assigned to it (see classifyBuckets/ensureBucketsForVacation).
export const BUCKET_POOL: BucketPoolEntry[] = [
  {
    key: "tourist_attractions",
    nameEn: "Tourist Attractions & Landmarks",
    nameDe: "Sehenswürdigkeiten & Wahrzeichen",
    rule: "Outdoor or freely-viewed landmarks, monuments, plazas, viewpoints, cathedrals seen from the outside; general sightseeing. NOT a ticketed indoor museum/gallery visit — use museums_culture for that.",
  },
  {
    key: "museums_culture",
    nameEn: "Museums & Culture",
    nameDe: "Museen & Kultur",
    rule: "Ticketed indoor cultural institutions you pay entry for: museums, galleries, historic house-museums, theaters/live performances. Does NOT include bookstores/bookshops, even atmospheric or historic ones — those are shopping_markets (or libraries_quiet if it's an actual lending library, not a shop).",
  },
  {
    key: "outdoor_adventure",
    nameEn: "Outdoor & Adventure",
    nameDe: "Natur & Abenteuer",
    rule: "Self-directed nature/outdoor activity: hiking, parks, active beach use, independently-done adrenaline sports. If it's led by a guide/instructor or booked as a class/excursion, use local_experiences instead, even if it happens outdoors.",
  },
  {
    key: "local_experiences",
    nameEn: "Local Experiences & Tours",
    nameDe: "Lokale Erlebnisse & Touren",
    rule: "Anything guided or instructed by a host: guided tours, cooking classes, workshops, excursions — regardless of setting.",
  },
  {
    key: "eating_drinking",
    nameEn: "Eating & Drinking",
    nameDe: "Essen & Trinken",
    rule: "Primary purpose is consuming food or drinks: restaurants, cafés, bakeries, bars, rooftop/terrace bars, wine bars, and food halls/gastronomic markets where visitors come primarily to eat or drink from stalls (e.g. a mercado dominated by food stands). A hotel rooftop/terrace belongs here if a food/drink offering is its OWN core identity (e.g. 'rooftop restaurant', 'terrace bar') — being scenic or hotel-based doesn't exclude it. But don't blanket-apply this to every 'rooftop'/'terrace', and don't apply it to a spa/wellness hotel just because it also happens to have a restaurant — see relaxation_wellness for both of those cases.",
  },
  {
    key: "nightlife_bars",
    nameEn: "Nightlife & Bars",
    nameDe: "Nachtleben & Bars",
    rule: "Primary purpose is dancing, clubbing, or live entertainment late at night — nightclubs, dance clubs, live-music venues with a party atmosphere. A bar, pub, cocktail lounge, or rooftop/terrace bar whose main draw is simply having a drink belongs in eating_drinking instead, even if it stays open late.",
  },
  {
    key: "shopping_markets",
    nameEn: "Shopping & Markets",
    nameDe: "Shopping & Märkte",
    rule: "Primary purpose is browsing/buying general goods: shopping streets, malls, boutiques, flea/artisan markets, and bookstores/bookshops (browsing and buying books is a shopping activity, not a cultural-institution visit). NOT a market dominated by food stalls meant for eating on-site — use eating_drinking for that.",
  },
  {
    key: "relaxation_wellness",
    nameEn: "Relaxation & Wellness",
    nameDe: "Entspannung & Wellness",
    rule: "Spas, hot springs, wellness/massage centers, pools, and beaches/parks used specifically for lounging rather than active use. A place whose OWN core identity is a spa/wellness facility (e.g. named or described as a 'spa hotel', 'wellness resort', 'spa & wellness center', built around massages/treatments/pools) belongs here even if it also happens to mention a restaurant or bar somewhere — the spa is the point, an incidental restaurant doesn't change that. A hotel rooftop/terrace with no spa/wellness identity can still belong here IF its description is only about the view, lounging, or relaxing atmosphere with no food/drink service mentioned. But a rooftop/terrace whose OWN core identity is a bar or restaurant (not a spa) belongs in eating_drinking instead, even if it's scenic, hotel-based, or marketed as 'relaxing'.",
  },
  {
    key: "libraries_quiet",
    nameEn: "Libraries & Quiet Spaces",
    nameDe: "Bibliotheken & Ruheorte",
    rule: "Actual public/lending libraries and quiet reading/study rooms — places to sit and read, not to buy books. NOT a commercial bookstore/bookshop, even a beautiful or historic one — that's shopping_markets, since its core function is selling. If a library has a café visitors would primarily go for, use eating_drinking instead.",
  },
];

const POOL_KEYS = new Set(BUCKET_POOL.map((b) => b.key));

export interface ClassifiablePlace {
  id: string;
  name: string;
  description: string | null;
}

export interface ClassifiedBucket {
  key: string;
  nameEn: string;
  nameDe: string;
  isGenerated: boolean;
}

export interface BucketClassification {
  buckets: ClassifiedBucket[];
  assignments: { placeId: string; bucketKey: string }[];
}

// A single classification call covers every place in the vacation at once
// (needed for good bucket boundaries) and can run to dozens of places with
// full descriptions in the prompt — on CPU-bound inference that's a lot
// slower than the small single-place research calls, so it gets a much
// longer budget. This only ever blocks the first read after a vacation
// finishes processing; every read after that is instant.
const CLASSIFY_TIMEOUT_MS = 5 * 60 * 1000;

// Exported so callers can identify/retry places that landed here specifically
// (as opposed to a legitimate LLM-invented bucket) — see bucketWeights.ts's
// retry endpoint and the ranking UI's "retry categorization" action.
export const UNCATEGORIZED_KEY = "uncategorized";

const FALLBACK_BUCKET: ClassifiedBucket = {
  key: UNCATEGORIZED_KEY,
  nameEn: "Uncategorized",
  nameDe: "Unsortiert",
  isGenerated: true,
};

function buildPrompt(places: ClassifiablePlace[]): string {
  const poolList = BUCKET_POOL.map((b, i) => `${i + 1}. ${b.key} — ${b.nameEn}: ${b.rule}`).join("\n");
  const placeList = places
    .map((p, i) => `${i}. ${p.name}${p.description ? ` — ${p.description}` : ""}`)
    .join("\n");

  return (
    `You are sorting a vacation's list of places/activities into a small set of category "buckets" so a ` +
    `traveler can rank places within the same kind of experience against each other, rather than comparing ` +
    `unrelated things (e.g. a casual bar against a major museum).\n\n` +
    `Assign every place below to exactly ONE of these category buckets, using the rule for each to break ` +
    `ties on overlapping cases:\n${poolList}\n\n` +
    `Classify strictly by what a visitor actually DOES there — the primary activity or service — never by ` +
    `general atmosphere, setting, or vibe. A hotel rooftop that serves food/drinks is eating_drinking, not ` +
    `relaxation_wellness, even if it's scenic or the hotel also happens to have a spa elsewhere; only the ` +
    `spa/pool itself is relaxation_wellness. A bookshop is shopping_markets even if it feels literary or ` +
    `historic — museums_culture is only for ticketed institutions, and libraries_quiet is only for actual ` +
    `lending libraries, not shops. When a place's name or description evokes a mood ("relaxing", "cultural", ` +
    `"chill") but its actual function (selling drinks, selling books, etc.) points to a different bucket, ` +
    `follow the function, not the mood.\n\n` +
    `Only if a place genuinely fits none of the 9 buckets above, AND at least one other place in the list ` +
    `shares that same genuinely-uncovered theme, you may invent a new bucket for them (short snake_case key, ` +
    `English name, German name). If only a single place doesn't fit any of the 9, force it into whichever of ` +
    `the 9 is the closest fit instead of inventing a bucket just for it.\n\n` +
    `Places (referenced by index):\n${placeList}\n\n` +
    `Respond with ONLY a JSON object, no other text, in exactly this shape:\n` +
    `{"assignments": [{"index": 0, "bucketKey": "tourist_attractions"}, ...], ` +
    `"newBuckets": [{"key": "<short_snake_case_key>", "nameEn": "<English name>", "nameDe": "<German name>"}]}\n\n` +
    `"newBuckets" must be an empty array unless you actually invented one or more new buckets. Every place ` +
    `index from 0 to ${places.length - 1} must appear exactly once in "assignments", and every bucketKey used ` +
    `there must be either one of the 9 pool keys above or a key defined in "newBuckets".`
  );
}

function tryParse(
  content: string,
  places: ClassifiablePlace[]
): { assignments: { index: number; bucketKey: string }[]; newBuckets: ClassifiedBucket[] } | null {
  let cleaned = content
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  if (!cleaned.startsWith("{")) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) cleaned = match[0];
  }

  try {
    const parsed = JSON.parse(cleaned);
    const newBuckets: ClassifiedBucket[] = Array.isArray(parsed.newBuckets)
      ? parsed.newBuckets
          .filter((b: any) => typeof b.key === "string" && typeof b.nameEn === "string" && typeof b.nameDe === "string")
          .map((b: any) => ({ key: b.key, nameEn: b.nameEn, nameDe: b.nameDe, isGenerated: true }))
      : [];
    const generatedKeys = new Set(newBuckets.map((b) => b.key));

    const assignments: { index: number; bucketKey: string }[] = Array.isArray(parsed.assignments)
      ? parsed.assignments
          .filter(
            (a: any) =>
              Number.isInteger(a.index) &&
              a.index >= 0 &&
              a.index < places.length &&
              typeof a.bucketKey === "string" &&
              (POOL_KEYS.has(a.bucketKey) || generatedKeys.has(a.bucketKey))
          )
          .map((a: any) => ({ index: a.index, bucketKey: a.bucketKey }))
      : [];

    return { assignments, newBuckets };
  } catch {
    return null;
  }
}

export async function classifyBuckets(places: ClassifiablePlace[]): Promise<BucketClassification> {
  if (places.length === 0) return { buckets: [], assignments: [] };

  let parsed: { assignments: { index: number; bucketKey: string }[]; newBuckets: ClassifiedBucket[] } | null = null;
  try {
    const result = await ollamaChat([{ role: "user", content: buildPrompt(places) }], CLASSIFY_TIMEOUT_MS);
    parsed = tryParse(result.message.content, places);
  } catch (err) {
    console.warn("[bucketClassifier] LLM call failed:", (err as Error).message);
  }

  const assignedIndices = new Set((parsed?.assignments ?? []).map((a) => a.index));
  const missing = places.map((_, i) => i).filter((i) => !assignedIndices.has(i));

  const assignments = places.map((p, i) => {
    const found = parsed?.assignments.find((a) => a.index === i);
    return { placeId: p.id, bucketKey: found ? found.bucketKey : FALLBACK_BUCKET.key };
  });

  const usedKeys = new Set(assignments.map((a) => a.bucketKey));
  const buckets: ClassifiedBucket[] = [
    ...BUCKET_POOL.filter((b) => usedKeys.has(b.key)).map((b) => ({
      key: b.key,
      nameEn: b.nameEn,
      nameDe: b.nameDe,
      isGenerated: false,
    })),
    ...(parsed?.newBuckets ?? []).filter((b) => usedKeys.has(b.key)),
  ];
  if (missing.length > 0 && usedKeys.has(FALLBACK_BUCKET.key)) {
    buckets.push(FALLBACK_BUCKET);
  }

  return { buckets, assignments };
}
