import { ChatMessage, ollamaChat } from "./ollama";
import { webSearch, SearchHit } from "./searx";

const FALLBACK_HOURS = 2;

// Restaurants/cafés/bars often get wildly overestimated durations from
// review-site chatter ("we spent all evening there"), which would otherwise
// dominate a whole itinerary's time budget. Cap them hard rather than trust
// the model's raw number.
const FOOD_VENUE_HOURS = 1;

export interface ResearchResult {
  hours: number;
  source: "official_site" | "reddit_forum" | "fallback";
  description: string;
}

function buildPrompt(placeName: string, locationContext: string | null, hits: SearchHit[]): string {
  const snippets = hits.length
    ? hits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.content}`).join("\n")
    : "(no search results found)";

  const subject = locationContext ? `"${placeName}" in ${locationContext}` : `"${placeName}"`;
  const locationNote = locationContext
    ? `\nThis place is part of a vacation itinerary in ${locationContext} — every other place on the ` +
      `same trip is there too. Make sure you're researching the "${placeName}" that is actually in ` +
      `${locationContext} specifically, NOT a same- or similar-named place, neighborhood, or landmark ` +
      `elsewhere in the world (e.g. a restaurant or small venue can easily share its name with an ` +
      `unrelated district or attraction in another country — prefer the interpretation that fits ` +
      `${locationContext}).\n`
    : "";

  return `You are a travel research assistant. For ${subject} (a place/attraction or activity on a ` +
    `vacation itinerary), use the web search results below to do three things:
${locationNote}
1. Estimate, in hours, how long a visitor should plan to spend there (or how long the activity
   typically takes).
2. Write a short, engaging one-sentence description of what it is, to help someone deciding whether
   to visit it (no more than ~20 words).
3. Indicate whether it is primarily a restaurant, café, bakery, or similar food/drink venue
   (isFoodVenue: true/false) — this is only used to sanity-check the duration estimate against
   review-site chatter that tends to wildly overstate how long a meal takes.

Web search results for ${subject}:
${snippets}

Prefer an official/tourism source for the duration if one of the results states a typical duration.
Otherwise estimate from forum/travel-blog mentions in the results, or your own general knowledge if
the results above are unhelpful or empty. Base the description on the search results if they're
informative; otherwise use your own general knowledge.

Respond with ONLY a JSON object (no markdown fences, no extra text) in exactly this shape:
{"hours": <number>, "source": "official_site" | "reddit_forum" | "fallback", "description": "<one sentence>", "isFoodVenue": true | false}

"hours" must be a positive number of hours (fractions allowed, e.g. 1.5). Do not include any other
text in your answer.`;
}

function tryParseFinalAnswer(content: string): ResearchResult | null {
  // Defensive: even non-reasoning models occasionally wrap the JSON in a
  // markdown fence or a sentence of prose despite instructions not to.
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
    let hours = Number(parsed.hours);
    if (!Number.isFinite(hours) || hours <= 0) return null;
    const source = ["official_site", "reddit_forum", "fallback"].includes(parsed.source)
      ? parsed.source
      : "fallback";
    const description = typeof parsed.description === "string" ? parsed.description.trim() : "";
    if (parsed.isFoodVenue === true) hours = FOOD_VENUE_HOURS;
    return { hours, source, description };
  } catch {
    return null;
  }
}

export async function researchPlaceDuration(
  placeName: string,
  locationContext: string | null = null
): Promise<ResearchResult> {
  const searchQuery = locationContext
    ? `${placeName} ${locationContext} how long to visit duration hours`
    : `${placeName} how long to visit duration hours`;

  let hits: SearchHit[] = [];
  try {
    hits = await webSearch(searchQuery);
  } catch (err) {
    console.warn(`[llmResearch] web search failed for "${placeName}":`, (err as Error).message);
  }

  const messages: ChatMessage[] = [{ role: "user", content: buildPrompt(placeName, locationContext, hits) }];

  try {
    const result = await ollamaChat(messages);
    const parsed = tryParseFinalAnswer(result.message.content);
    if (parsed) return parsed;
    console.warn(
      `[llmResearch] could not parse LLM answer for "${placeName}": ${result.message.content.slice(0, 200)}`
    );
  } catch (err) {
    console.warn(`[llmResearch] chat failed for "${placeName}":`, (err as Error).message);
  }

  return { hours: FALLBACK_HOURS, source: "fallback", description: "" };
}
