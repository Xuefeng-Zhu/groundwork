/**
 * Source hygiene: URL canonicalisation, de-duplication, date-window filtering,
 * and primary-source detection. All deterministic so the trust layer is auditable.
 */
import type {
  BriefingRequest,
  Category,
  DateWindow,
  PlannedQuery,
  Source,
} from "../../../shared/briefing/schema";

export interface RawHit {
  queryId: string;
  url: string;
  title: string;
  content: string;
  publishedDate?: string | null;
  score?: number;
  /** background = context query (kept even outside the window, ranked low); site = official newsroom page */
  origin?: "search" | "background" | "site" | undefined;
}

const PRESS_WIRES = [
  "prnewswire.com",
  "businesswire.com",
  "globenewswire.com",
  "accesswire.com",
  "sec.gov",
];

export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_|ref$|ref_)/i.test(k)) u.searchParams.delete(k);
    }
    u.hostname = u.hostname.replace(/^www\./, "").toLowerCase();
    let s = u.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return raw.trim();
  }
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "unknown";
  }
}

/** Registrable-ish root ("news.acme.com" -> "acme.com") used to count independent outlets. */
export function rootDomain(domain: string): string {
  const parts = domain.split(".");
  if (parts.length <= 2) return domain;
  const tld2 = parts.slice(-2).join(".");
  if (/^(co|com|org|net|ac|gov)\.[a-z]{2}$/.test(tld2)) return parts.slice(-3).join(".");
  return tld2;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isPrimarySource(domain: string, req: BriefingRequest): boolean {
  if (PRESS_WIRES.some((w) => domain === w || domain.endsWith(`.${w}`))) return true;
  if (req.officialDomain) {
    const od = req.officialDomain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]!.toLowerCase();
    if (domain === od || domain.endsWith(`.${od}`)) return true;
  }
  // Heuristic: the company's own site, e.g. "stripe.com" or "newsroom.stripe.com".
  const owner = req.targetType === "company" ? req.target : req.organization;
  if (owner) {
    const s = slug(owner);
    const root = slug(rootDomain(domain).split(".")[0] ?? "");
    if (s.length >= 4 && root === s) return true;
  }
  return false;
}

/**
 * Pick the sources that go into the model prompt: rank order, but reserve a few slots for
 * first-party (primary, in-window) pages so a small prompt budget does not crowd them out,
 * and allow at most one background source. Returned in original rank order.
 */
export function selectForPrompt(sources: Source[], max: number, reservePrimary = 3): Source[] {
  if (sources.length <= max) return sources;
  const chosen = new Set<string>();
  sources
    .filter((s) => s.isPrimary && s.origin !== "background")
    .slice(0, Math.min(reservePrimary, max))
    .forEach((s) => chosen.add(s.id));
  let bg = 0;
  for (const s of sources) {
    if (chosen.size >= max) break;
    if (s.origin === "background" && ++bg > 1) continue;
    chosen.add(s.id);
  }
  return sources.filter((s) => chosen.has(s.id));
}

export function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface NormalizeStats {
  rawResults: number;
  duplicates: number;
  outOfWindow: number;
  undated: number;
  kept: number;
  background: number;
}

const STOP = new Set("the a an and or of to in for on with by at from as is are was be its it this that new says".split(" "));
export function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9$%. ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

/**
 * Merge raw hits into numbered sources: dedupe by canonical URL (and near-identical
 * syndicated titles on the same domain), drop anything dated outside the window,
 * keep undated items (flagged later as lower confidence), rank by score + recency.
 */
export function normalizeHits(
  hits: RawHit[],
  queries: PlannedQuery[],
  window: DateWindow,
  req: BriefingRequest,
  maxSources = 40,
): { sources: Source[]; stats: NormalizeStats } {
  const start = new Date(window.start).getTime();
  // Allow a small grace after the meeting start for timezone skew in published dates.
  const end = new Date(window.end).getTime() + 6 * 3_600_000;
  const byUrl = new Map<string, Source & { _ts: number | null }>();
  const qCat = new Map(queries.map((q) => [q.id, q.category] as const));
  let duplicates = 0;
  let outOfWindow = 0;

  for (const h of hits) {
    if (!h.url || !h.title) continue;
    const url = canonicalUrl(h.url);
    const d = parseDate(h.publishedDate ?? null);
    const ts = d ? d.getTime() : null;
    const inWindow = ts === null || (ts >= start && ts <= end);
    const isBackground = h.origin === "background" && !(ts !== null && inWindow);
    if (!inWindow && !isBackground) {
      outOfWindow++;
      continue;
    }
    if (isBackground && ts !== null && ts > end) continue; // never "future" context
    const cat = qCat.get(h.queryId) ?? "news";
    const existing = byUrl.get(url);
    if (existing) {
      duplicates++;
      if (!existing.queryIds.includes(h.queryId)) existing.queryIds.push(h.queryId);
      if (!existing.categories.includes(cat)) existing.categories.push(cat as Category);
      existing.score = Math.max(existing.score, h.score ?? 0);
      if ((h.content?.length ?? 0) > existing.snippet.length) existing.snippet = h.content.slice(0, 1500);
      continue;
    }
    const domain = domainOf(url);
    // Syndicated duplicate: same domain + near-identical title.
    const tk = titleTokens(h.title);
    const syndicated = [...byUrl.values()].find((s) => {
      if (s.domain !== domain) return false;
      const sk = titleTokens(s.title);
      const inter = [...tk].filter((x) => sk.has(x)).length;
      return inter / Math.max(1, Math.min(tk.size, sk.size)) > 0.9;
    });
    if (syndicated) {
      duplicates++;
      continue;
    }
    byUrl.set(url, {
      id: "",
      url,
      title: h.title.trim(),
      domain,
      publishedAt: d ? d.toISOString() : null,
      snippet: (h.content ?? "").replace(/\s+/g, " ").trim().slice(0, 1500),
      queryIds: [h.queryId],
      categories: [cat as Category],
      score: h.score ?? 0,
      isPrimary: isPrimarySource(domain, req),
      origin: isBackground ? "background" : h.origin === "site" ? "site" : "search",
      _ts: ts,
    });
  }

  const all = [...byUrl.values()];
  const undated = all.filter((s) => s._ts === null).length;
  const span = Math.max(1, end - start);
  all.sort((a, b) => rank(b) - rank(a));
  function rank(s: Source & { _ts: number | null }) {
    if (s.origin === "background") return s.score - 0.4;
    const recency = s._ts === null ? 0.2 : (s._ts - start) / span;
    return s.score + 0.35 * recency + 0.15 * (s.queryIds.length - 1) + (s.isPrimary ? 0.2 : 0);
  }
  // Background is context only: cap it so it never crowds out recent coverage.
  let bg = 0;
  const capped = all.filter((s) => s.origin !== "background" || ++bg <= 3);
  const kept = capped.slice(0, maxSources).map(({ _ts, ...s }, i) => ({ ...s, id: `S${i + 1}` }));
  return {
    sources: kept,
    stats: {
      rawResults: hits.length,
      duplicates,
      outOfWindow,
      undated,
      kept: kept.length,
      background: kept.filter((s) => s.origin === "background").length,
    },
  };
}
