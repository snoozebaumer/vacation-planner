const SEARXNG_URL = process.env.SEARXNG_URL ?? "http://localhost:8080";

export interface SearchHit {
  title: string;
  url: string;
  content: string;
}

async function searchOnce(query: string, limit: number): Promise<SearchHit[]> {
  const url = `${SEARXNG_URL}/search?q=${encodeURIComponent(query)}&format=json&language=en`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`SearxNG search failed with status ${res.status}`);
  const data: any = await res.json();
  return (data.results ?? []).slice(0, limit).map((r: any) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    content: r.content ?? "",
  }));
}

export async function webSearch(query: string, limit = 5): Promise<SearchHit[]> {
  try {
    const results = await searchOnce(query, limit);
    if (results.length > 0) return results;
  } catch (err) {
    console.warn(`[searx] search failed for "${query}", retrying once:`, (err as Error).message);
  }

  // A single engine tripping a transient rate limit shouldn't sink one
  // place's research for the whole run — one short-backoff retry covers it.
  await new Promise((resolve) => setTimeout(resolve, 2000));
  return searchOnce(query, limit);
}
