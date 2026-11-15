/**
 * First-party coverage: find the company's newsroom/blog index on its official domain,
 * map it with Tavily Map, and pick the newest-looking article pages to Extract.
 * Pure helpers here; the network calls live in pipeline.ts / tavily.ts.
 */
import { canonicalUrl } from "./sources";

const NEWS_SEG = /^(newsroom|news|press|press-releases|pressroom|media|blog|blogs|announcements?|company-news|stories)$/i;

export function bareDomain(d: string): string {
  return d.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]!.toLowerCase();
}

function onDomain(url: string, domain: string): boolean {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return h === domain || h.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

/**
 * Newsroom index candidates, most specific first, derived from URLs we already found on the
 * official domain (e.g. ".../en/news/press-releases/foo" -> ".../en/news/press-releases").
 */
export function newsroomCandidates(officialUrls: string[], domain: string): string[] {
  const out: string[] = [];
  for (const raw of officialUrls) {
    if (!onDomain(raw, domain)) continue;
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      continue;
    }
    const segs = u.pathname.split("/").filter(Boolean);
    // deepest news-like segment that still has an article below it
    for (let i = segs.length - 2; i >= 0; i--) {
      if (NEWS_SEG.test(segs[i]!)) {
        out.push(`${u.protocol}//${u.host}/${segs.slice(0, i + 1).join("/")}`);
        break;
      }
    }
  }
  // most frequent first
  const freq = new Map<string, number>();
  for (const c of out) freq.set(c, (freq.get(c) ?? 0) + 1);
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

/** Fallback index guesses when no official URL was found by search. */
export function guessNewsroomUrls(domain: string): string[] {
  return [`https://${domain}/newsroom`, `https://${domain}/news`, `https://${domain}/blog`];
}

/**
 * Choose article pages from a Map result: under the index path, not the index itself,
 * not already a source, newest-looking first (a year >= the window's year in the path wins).
 */
export function pickSitePages(mapped: string[], indexUrl: string, exclude: Set<string>, windowStartYear: number, max = 4): string[] {
  let prefix = "";
  try {
    prefix = new URL(indexUrl).pathname.replace(/\/+$/, "");
  } catch {
    return [];
  }
  const idx = canonicalUrl(indexUrl);
  const scored: Array<{ url: string; s: number; i: number }> = [];
  mapped.forEach((u, i) => {
    let p: URL;
    try {
      p = new URL(u);
    } catch {
      return;
    }
    const path = p.pathname.replace(/\/+$/, "");
    const c = canonicalUrl(u);
    if (c === idx || exclude.has(c)) return;
    if (prefix && !path.startsWith(`${prefix}/`)) return;
    const rest = path.slice(prefix.length).split("/").filter(Boolean);
    if (!rest.length) return;
    const last = rest[rest.length - 1]!;
    if (NEWS_SEG.test(last) || /^(page|tag|tags|category|categories|author|topics?)$/i.test(rest[0]!) || /^\d+$/.test(last)) return;
    if (last.split("-").length < 2) return; // article slugs are multi-word
    let s = 0;
    const years = [...path.matchAll(/(20\d{2})/g)].map((m) => Number(m[1]));
    if (years.some((y) => y >= windowStartYear)) s += 2;
    if (years.length && years.every((y) => y < windowStartYear)) s -= 3;
    scored.push({ url: u, s, i });
  });
  return scored
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, max)
    .map((x) => x.url);
}

const MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";

/** Best-effort publication date for an extracted page: URL date, ISO date, or "November 4, 2026". */
export function parsePageDate(url: string, text: string): string | null {
  const u = url.match(/\/(20\d{2})[/-](\d{1,2})[/-](\d{1,2})(?:\/|-|$)/);
  if (u) return iso(+u[1]!, +u[2]!, +u[3]!);
  const head = text.slice(0, 1500);
  const a = head.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (a) return iso(+a[1]!, +a[2]!, +a[3]!);
  const b = head.match(new RegExp(`\\b(${MONTHS})\\.?\\s+(\\d{1,2}),?\\s+(20\\d{2})\\b`, "i"));
  if (b) return iso(+b[3]!, monthIdx(b[1]!), +b[2]!);
  const c = head.match(new RegExp(`\\b(\\d{1,2})\\s+(${MONTHS})\\.?\\s+(20\\d{2})\\b`, "i"));
  if (c) return iso(+c[3]!, monthIdx(c[2]!), +c[1]!);
  return null;
}

function monthIdx(m: string): number {
  return ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m.slice(0, 3).toLowerCase()) + 1;
}

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** Drop site navigation before the article: start at the first occurrence of the slug's words. */
export function trimToArticle(url: string, text: string): string {
  const words = titleFromPage(url).toLowerCase().split(/\s+/).filter((w) => w.length > 2).slice(0, 3);
  if (words.length < 2) return text;
  const re = new RegExp(words.map((w) => w.replace(/[^a-z0-9]/g, "")).join("[^a-z0-9]+(?:[a-z0-9]+[^a-z0-9]+)?"), "i");
  const m = text.slice(0, 2500).match(re);
  return m?.index ? text.slice(m.index) : text;
}

/** Title for a mapped page: its slug, title-cased (extracted text usually starts with site navigation). */
export function titleFromPage(url: string): string {
  try {
    const segs = new URL(url).pathname.split("/").filter(Boolean);
    const slug = (segs[segs.length - 1] ?? "").replace(/\.[a-z]+$/i, "").replace(/[-_]+/g, " ").trim();
    return slug ? slug.replace(/\b\w/g, (c) => c.toUpperCase()) : url;
  } catch {
    return url;
  }
}
