/**
 * Thin Tavily REST client (https://docs.tavily.com): /search for discovery with
 * a hard published-date window, /extract to pull fuller text for top sources.
 */
import type { DateWindow, PlannedQuery } from "../../../shared/briefing/schema";
import type { RawHit } from "./sources";

export interface TavilyClient {
  key: string;
  baseUrl: string;
}

async function post<T>(path: string, client: TavilyClient, body: unknown, timeoutMs = 30000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${client.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${client.key}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Tavily ${path} ${res.status}: ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
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
}

export async function tavilySearch(
  client: TavilyClient,
  q: PlannedQuery,
  window: DateWindow,
  maxResults = 8,
): Promise<RawHit[]> {
  const body = {
    query: q.query,
    topic: q.topic,
    search_depth: "advanced",
    chunks_per_source: 3,
    max_results: maxResults,
    start_date: window.start.slice(0, 10),
    end_date: window.end.slice(0, 10),
    include_answer: false, // we synthesise ourselves, from sources we can cite
    include_raw_content: false,
    include_published_date: true,
  };
  const data = await post<TavilySearchResponse>("/search", client, body);
  return (data.results ?? []).map((r) => ({
    queryId: q.id,
    url: r.url,
    title: r.title,
    content: r.content ?? "",
    publishedDate: r.published_date ?? null,
    score: r.score ?? 0,
  }));
}

interface TavilyExtractResponse {
  results: Array<{ url: string; raw_content?: string }>;
  failed_results?: Array<{ url: string; error?: string }>;
}

export async function tavilyExtract(client: TavilyClient, urls: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!urls.length) return out;
  const data = await post<TavilyExtractResponse>(
    "/extract",
    client,
    { urls, extract_depth: "basic", format: "text" },
    45000,
  );
  for (const r of data.results ?? []) {
    if (r.raw_content) out.set(r.url, r.raw_content.replace(/\s+/g, " ").slice(0, 4000));
  }
  return out;
}
