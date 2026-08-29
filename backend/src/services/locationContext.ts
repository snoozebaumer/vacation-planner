import { ChatMessage, ollamaChat } from "./ollama";

function buildPrompt(placeNames: string[]): string {
  const list = placeNames.map((n) => `- ${n}`).join("\n");
  return `You are given a list of place/activity names that are all part of the same single vacation ` +
    `itinerary. Determine the smallest geographic location name that plausibly covers ALL of them ` +
    `together. This will be appended to each place's name in an image search, so it must be just ` +
    `specific enough to disambiguate (e.g. so "Parliament Building" resolves to the right country's ` +
    `parliament instead of a different one) — no larger than necessary.

Prefer, in this order, the smallest that still plausibly covers every place: a specific city > a
region/state/province > a country. If the places don't share any confident common location, respond
with an empty string.

Places:
${list}

Respond with ONLY a JSON object, no other text: {"location": "<smallest common location, or "" if unsure>"}`;
}

function tryParse(content: string): string | null {
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
    const location = String(parsed.location ?? "").trim();
    return location.length > 0 ? location : null;
  } catch {
    return null;
  }
}

export async function inferSharedLocationContext(placeNames: string[]): Promise<string | null> {
  if (placeNames.length === 0) return null;

  const messages: ChatMessage[] = [{ role: "user", content: buildPrompt(placeNames) }];
  try {
    const result = await ollamaChat(messages);
    return tryParse(result.message.content);
  } catch (err) {
    console.warn("[locationContext] inference failed:", (err as Error).message);
    return null;
  }
}
