// Best-effort, key-free image search backed by DuckDuckGo's unofficial image
// search endpoint. This is inherently a bit fragile (DDG can change its
// markup), so every step degrades gracefully: on any failure we simply leave
// the place without a photo and the frontend shows a placeholder.

// The card aspect ratio (width / height) all photos get cropped to on the
// frontend. Cards are tall "phone screen" style cards shown side by side, so
// portrait wins. Kept in sync with frontend/src/app/shared/photo-card.scss.
export const CARD_ASPECT_RATIO = 3 / 4;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

interface DdgImageResult {
  image: string;
  width?: number;
  height?: number;
  title?: string;
}

async function fetchWithTimeout(url: string, opts: RequestInit = {}, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function getVqdToken(query: string): Promise<string> {
  const url = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`;
  const res = await fetchWithTimeout(url, { headers: { "User-Agent": USER_AGENT } });
  const html = await res.text();
  const match = html.match(/vqd=(?:['"])([^'"&]+)(?:['"])/) ?? html.match(/vqd=([\d-]+)/);
  if (!match) throw new Error("Could not extract vqd token from DuckDuckGo response");
  return match[1];
}

async function searchDdgImages(query: string): Promise<DdgImageResult[]> {
  const vqd = await getVqdToken(query);
  const url = `https://duckduckgo.com/i.js?q=${encodeURIComponent(query)}&o=json&vqd=${encodeURIComponent(vqd)}&f=,,,&p=1`;
  const res = await fetchWithTimeout(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Referer: "https://duckduckgo.com/",
    },
  });
  if (!res.ok) throw new Error(`DuckDuckGo image search failed with status ${res.status}`);
  const data: any = await res.json();
  const results: DdgImageResult[] = (data.results ?? []).map((r: any) => ({
    image: r.image,
    width: r.width,
    height: r.height,
    title: r.title,
  }));
  return results;
}

// A handful of hosts known to be durable (stable HTTPS, unlikely to vanish
// or let a certificate lapse) get a preference bump over the vast long tail
// of personal blogs and aggregator sites DDG image search otherwise returns.
// This is a soft nudge, not a filter — an otherwise-unreachable candidate is
// still rejected by the reachability check regardless of host.
function isTrustedHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.endsWith("wikipedia.org") || host.endsWith("wikimedia.org");
  } catch {
    return false;
  }
}

function scoreCandidate(index: number, width: number | undefined, height: number | undefined, url: string): number {
  // Relevance dominates (DDG already ranks by relevance); aspect ratio only
  // nudges the choice among similarly-relevant results, per idea.md.
  const relevance = 1 - index * 0.03;
  const ratio = width && height ? width / height : CARD_ASPECT_RATIO;
  const aspectPenalty = Math.abs(Math.log(ratio / CARD_ASPECT_RATIO)) * 0.15;
  const trustBonus = isTrustedHost(url) ? 0.3 : 0;
  return relevance - aspectPenalty + trustBonus;
}

// DDG's ranking says nothing about whether a link still resolves — hosts
// disappear, links rot, and (as observed live) certificates lapse. A HEAD
// request is enough to catch all of that (including TLS failures, which
// fetch() rejects on by default) before we ever persist the URL. Some hosts
// reject HEAD outright, so a 403/405 gets one retry via a 1-byte ranged GET
// rather than being written off immediately.
async function isUrlReachable(url: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(url, { method: "HEAD", headers: { "User-Agent": USER_AGENT } }, 4000);
    if (res.ok) return true;
    if (res.status === 403 || res.status === 405) {
      const getRes = await fetchWithTimeout(
        url,
        { method: "GET", headers: { "User-Agent": USER_AGENT, Range: "bytes=0-0" } },
        4000
      );
      return getRes.ok;
    }
    return false;
  } catch {
    return false;
  }
}

export interface PhotoResult {
  url: string;
  aspectRatio: number | null;
}

// Bounds how many candidates we're willing to reachability-check per place —
// the first one or two almost always pass, this just caps the worst case
// (every top candidate dead) rather than working through all 15.
const MAX_REACHABILITY_CHECKS = 6;

export async function findBestPhoto(placeName: string, locationContext?: string | null): Promise<PhotoResult | null> {
  const query = locationContext ? `${placeName} ${locationContext}` : placeName;
  try {
    const results = await searchDdgImages(query);
    const candidates = results.slice(0, 15).filter((r) => !!r.image);
    if (candidates.length === 0) return null;

    const ranked = candidates
      .map((c, i) => ({ candidate: c, score: scoreCandidate(i, c.width, c.height, c.image) }))
      .sort((a, b) => b.score - a.score);

    // Walk the ranking best-first, but skip anything that doesn't actually
    // load — a broken image is worse than a slightly-less-ideal one.
    for (const { candidate } of ranked.slice(0, MAX_REACHABILITY_CHECKS)) {
      if (await isUrlReachable(candidate.image)) {
        return {
          url: candidate.image,
          aspectRatio: candidate.width && candidate.height ? candidate.width / candidate.height : null,
        };
      }
    }
    return null;
  } catch (err) {
    console.warn(`[photoSearch] failed for "${placeName}":`, (err as Error).message);
    return null;
  }
}
