/**
 * Thin Tavily REST client (https://docs.tavily.com). Groundwork uses four endpoints:
 *  - /search  topic "news" with start_date/end_date = the meeting's lookback window (recent developments)
 *  - /search  topic "general", include_domains = official domain (the company's own announcements)
 *  - /search  topic "general", no date filter, basic depth (a little background context)
 *  - /map     on the official newsroom/blog index (discover the newest first-party pages)
 *  - /extract full text for the top search results + the mapped newsroom pages
 * Every call asks for `include_usage` so the brief can report the credits it spent.
 */
import type { DateWindow, PlannedQuery } from "../../../shared/briefing/schema";
import type { RawHit } from "./sources";

export interface TavilyClient {
  key: string;
  baseUrl: string;
  /** Running tally of calls and credits for this brief (filled in by every request). */
  usage?: TavilyUsage | undefined;
}

export interface TavilyUsage {
  calls: number;
  credits: number;
  byEndpoint: Record<string, { calls: number; credits: number }>;
}

export function newUsage(): TavilyUsage {
  return { calls: 0, credits: 0, byEndpoint: {} };
}

async function post<T extends { usage?: { credits?: number } }>(
  path: string,
  client: TavilyClient,
  body: Record<string, unknown>,
  timeoutMs = 30000,
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${client.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${client.key}` },
      body: JSON.stringify({ ...body, include_usage: true }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Tavily ${path} ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = (await res.json()) as T;
    if (client.usage) {
      const c = Number(data.usage?.credits ?? 0) || 0;
      const e = (client.usage.byEndpoint[path] ??= { calls: 0, credits: 0 });
      e.calls++;
      e.credits += c;
      client.usage.calls++;
      client.usage.credits += c;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

interface TavilySearchResponse {
  results: Array<{
    title: string;
    url: string;
    content: string;
    score?: number;
    published_date?: string | null;
  }>;
  usage?: { credits?: number };
}

/** Request body for one planned query. Exported so tests and docs can see exactly what is sent. */
export function searchBody(q: PlannedQuery, window: DateWindow, maxResults = 8): Record<string, unknown> {
  const kind = q.kind ?? "news";
  const base = {
    query: q.query,
    topic: q.topic,
    include_answer: false, // we synthesise ourselves, from sources we can cite
    include_raw_content: false,
    include_published_date: true,
  };
  if (kind === "background") {
    // Evergreen context: no date filter, cheap basic depth, few results.
    return { ...base, search_depth: "basic", max_results: 5 };
  }
  const windowed = {
    ...base,
    // Absolute dates anchored to the MEETING (time_range is relative to today, which is wrong for a future meeting).
    start_date: window.start.slice(0, 10),
    end_date: window.end.slice(0, 10),
  };
  if (kind === "official") {
    return { ...windowed, search_depth: "basic", max_results: 8, include_domains: q.includeDomains ?? [] };
  }
  return { ...windowed, search_depth: "advanced", chunks_per_source: 3, max_results: maxResults };
}

export async function tavilySearch(client: TavilyClient, q: PlannedQuery, window: DateWindow, maxResults = 8): Promise<RawHit[]> {
  const data = await post<TavilySearchResponse>("/search", client, searchBody(q, window, maxResults));
  return (data.results ?? []).map((r) => ({
    queryId: q.id,
    url: r.url,
    title: r.title,
    content: r.content ?? "",
    publishedDate: r.published_date ?? null,
    score: r.score ?? 0,
    origin: q.kind === "background" ? ("background" as const) : ("search" as const),
  }));
}

interface TavilyExtractResponse {
  results: Array<{ url: string; raw_content?: string }>;
  failed_results?: Array<{ url: string; error?: string }>;
  usage?: { credits?: number };
}

export async function tavilyExtract(client: TavilyClient, urls: string[], maxChars = 4000): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!urls.length) return out;
  const data = await post<TavilyExtractResponse>("/extract", client, { urls, extract_depth: "basic", format: "text" }, 45000);
  for (const r of data.results ?? []) {
    if (r.raw_content) out.set(r.url, r.raw_content.replace(/\s+/g, " ").slice(0, maxChars));
  }
  return out;
}

interface TavilyMapResponse {
  base_url?: string;
  results: string[];
  usage?: { credits?: number };
}

/**
 * Map one newsroom/blog index page. Depth 1 and a small limit keep it to ~2-3 credits
 * (1 credit per 10 pages, no `instructions`, which would double the price).
 */
export async function tavilyMap(client: TavilyClient, url: string, limit = 25): Promise<string[]> {
  const data = await post<TavilyMapResponse>(
    "/map",
    client,
    // A slow/blocked site should not hold the brief hostage: 15 s server-side cap.
    { url, max_depth: 1, max_breadth: limit, limit, allow_external: false, timeout: 15 },
    25000,
  );
  return data.results ?? [];
}
