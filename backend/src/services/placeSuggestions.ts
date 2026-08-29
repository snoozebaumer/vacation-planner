import { ChatMessage, ollamaChat } from "./ollama";
import { webSearch, SearchHit } from "./searx";

// A single short completion, not a batch job like bucket classification —
// this is meant to resolve while the user is still filling in the rest of
// the creation form, so every knob here is tuned for latency over recall:
// a short output cap, a small search-result count, and (see below) no
// per-title language detection anymore.
const SUGGEST_TIMEOUT_MS = 15 * 1000;
const SUGGESTION_COUNT = 3;
const SEARCH_RESULT_COUNT = 3;

// Bounds generation length — without it the model can ramble well past
// what 3 short suggestions need, and on CPU-bound inference decode time is
// the dominant cost, so this is the single biggest lever for response time.
// ~200 tokens comfortably covers the JSON shape below with room to spare.
const MAX_OUTPUT_TOKENS = 220;

// Years in the title ("Salzburg 2027") help the LLM reason about upcoming
// seasonal events but just add search noise (matching pages about "2027"
// as a topic) — stripped for the search query only, kept in the prompt.
function searchQueryFor(title: string): string {
  return `${title.replace(/\b(19|20)\d{2}\b/g, "").trim()} top attractions things to do`;
}

// Always English — was previously matched to the title's own language (or
// the user's UI language as a fallback), but that added a whole reasoning
// dimension the model had to get right on every call for a payoff that
// turned out not to be worth it: German output was consistently weaker
// (thinner destination knowledge, occasional language-mixing) than just
// asking in English throughout.
function buildPrompt(title: string, hits: SearchHit[]): string {
  const snippets = hits.length
    ? hits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.content}`).join("\n")
    : "(no search results found)";

  return (
    `A user is creating a vacation itinerary and has typed this working title for it so far (it may name ` +
    `a destination and/or a time of year, and may be informal or abbreviated):\n\n"${title}"\n\n` +
    `Only if the title clearly names or strongly implies a real, identifiable travel destination, infer ` +
    `that destination and, if present, the time of year/season implied by the title. If the title is ` +
    `meaningless, empty, generic, or doesn't clearly point to a real place, do NOT invent or guess one.\n\n` +
    `If (and only if) you found a real destination, suggest exactly ${SUGGESTION_COUNT} specific, real, ` +
    `individually-named places or activities there — a named landmark, museum, dish, market, trail, or ` +
    `event, never a bare city/region/country name and never one of the words from the title itself. ` +
    `Where a season is evident, prefer suggestions tailored to it over generic year-round landmarks.\n\n` +
    `Web search results for this destination, which may include lesser-known places you wouldn't otherwise ` +
    `know about:\n${snippets}\n\n` +
    `Prefer real, specific places actually named in the search results above, especially for a ` +
    `destination you're not highly confident about. If the results are empty or unhelpful, fall back to ` +
    `your own general travel knowledge instead.\n\n` +
    `Respond in English. Respond with ONLY a JSON object, no other text, in exactly this shape: ` +
    `{"destination": "<the real destination you found, or an empty string if none>", ` +
    `"suggestions": ["<place or activity 1>", "<place or activity 2>", ...]} ` +
    `— "suggestions" must be an empty array whenever "destination" is an empty string.`
  );
}

// Real place names overwhelmingly use plain Latin letters — anything
// outside that range showing up here means the model drifted off-language
// (observed with an earlier version of this prompt on a 7B model), which
// is a clear enough signal to distrust that entry.
const UNEXPECTED_SCRIPT = /[^\p{Script=Latin}\p{Script=Common}\p{P}\p{N}\s]/u;

function tryParse(content: string): string[] {
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
    const destination = typeof parsed.destination === "string" ? parsed.destination.trim() : "";
    if (destination.length === 0) return [];
    if (!Array.isArray(parsed.suggestions)) return [];

    return parsed.suggestions
      .filter((s: any) => typeof s === "string" && s.trim().length > 0 && !UNEXPECTED_SCRIPT.test(s))
      .map((s: string) => s.trim())
      .slice(0, SUGGESTION_COUNT);
  } catch {
    return [];
  }
}

// Best-effort only: an empty array (network/timeout/parse failure, no
// confident destination, or a suspicious response getting filtered out) is
// a normal, expected outcome — the caller falls back to its own generic
// placeholder text.
export async function suggestPlaces(title: string): Promise<string[]> {
  const trimmed = title.trim();
  if (trimmed.length === 0) return [];

  let hits: SearchHit[] = [];
  try {
    hits = await webSearch(searchQueryFor(trimmed), SEARCH_RESULT_COUNT);
  } catch (err) {
    console.warn("[placeSuggestions] web search failed:", (err as Error).message);
  }

  const messages: ChatMessage[] = [{ role: "user", content: buildPrompt(trimmed, hits) }];
  try {
    const result = await ollamaChat(messages, SUGGEST_TIMEOUT_MS, { num_predict: MAX_OUTPUT_TOKENS });
    return tryParse(result.message.content);
  } catch (err) {
    console.warn("[placeSuggestions] suggestion generation failed:", (err as Error).message);
    return [];
  }
}
