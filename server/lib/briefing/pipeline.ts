/**
 * End-to-end pipeline, independent of the web framework so it can be called from
 * actions, CLI scripts, and tests:
 *   plan queries -> Tavily fan-out (date-windowed) -> dedupe/filter -> extract
 *   -> LLM draft via Bifrost (or fallback) -> code-enforced verification -> briefing
 */
import { randomUUID } from "node:crypto";

import {
  briefingRequestSchema,
  type Briefing,
  type BriefingRequest,
  type BriefingRequestInput,
  type ResearchResult,
} from "../../../shared/briefing/schema";
import { describeConfig, getConfig, type BriefingConfig } from "./config";
import { estimateTavilyUsage, fixtureOrg, mockSearch } from "./fixtures";
import { completeJson, parseJsonLoose } from "./llm";
import { computeWindow, planQueries } from "./planner";
import { bareDomain, guessNewsroomUrls, newsroomCandidates, parsePageDate, pickSitePages, titleFromPage, trimToArticle } from "./site";
import { canonicalUrl, normalizeHits, selectForPrompt, type RawHit } from "./sources";
import { assemble, buildMessages, heuristicDraft, mockDraft, type Draft } from "./synthesize";
import { llmSupportCheck } from "./support-check";
import { newUsage, tavilyExtract, tavilyMap, tavilySearch, type TavilyClient } from "./tavily";
import { targetRef } from "./verify";

export class BriefingError extends Error {
  constructor(
    message: string,
    public code: "missing_search_key" | "invalid_request" | "search_failed",
  ) {
    super(message);
  }
}

export function normalizeRequest(input: BriefingRequestInput, cfg: BriefingConfig): BriefingRequest {
  const parsed = briefingRequestSchema.safeParse(input);
  if (!parsed.success) throw new BriefingError(parsed.error.issues.map((i) => i.message).join("; "), "invalid_request");
  const req = parsed.data;
  if (Number.isNaN(new Date(req.meetingAt).getTime()))
    throw new BriefingError(`meetingAt is not a valid date: ${req.meetingAt}`, "invalid_request");
  if (cfg.mock && req.targetType === "person" && !req.organization) req.organization = fixtureOrg(req);
  return req;
}

export async function researchTarget(
  input: BriefingRequestInput,
  cfg: BriefingConfig = getConfig(),
): Promise<ResearchResult> {
  const t0 = Date.now();
  const req = normalizeRequest(input, cfg);
  const window = computeWindow(req);
  const queries = planQueries(req);
  const warnings: string[] = [];
  let hits: RawHit[] = [];
  let failed = 0;
  const client: TavilyClient | null =
    !cfg.mock && cfg.tavilyKey ? { key: cfg.tavilyKey, baseUrl: cfg.tavilyBaseUrl, usage: newUsage() } : null;

  if (cfg.mock) {
    hits = mockSearch(req, queries, window);
  } else {
    if (!client)
      throw new BriefingError("TAVILY_API_KEY is not set. Add it to .env, or run with MOCK=1 for the demo.", "missing_search_key");
    const settled = await Promise.allSettled(queries.map((q) => tavilySearch(client, q, window)));
    settled.forEach((s, i) => {
      if (s.status === "fulfilled") hits.push(...s.value);
      else {
        failed++;
        warnings.push(`Search "${queries[i]?.query}" failed: ${(s.reason as Error).message}`);
      }
    });
    if (failed === queries.length) throw new BriefingError(warnings.join(" | "), "search_failed");
  }

  // First-party coverage: Tavily Map on the official newsroom/blog index -> newest article URLs.
  let siteUrls: string[] = [];
  let mappedUrls = 0;
  let newsroomUrl: string | undefined;
  if (client && req.officialDomain && cfg.tavilySitePages > 0) {
    const od = bareDomain(req.officialDomain);
    const known = new Set(hits.map((h) => canonicalUrl(h.url)));
    const candidates = [...newsroomCandidates(hits.map((h) => h.url), od), ...guessNewsroomUrls(od)];
    for (const idx of [...new Set(candidates)].slice(0, 3)) {
      try {
        const mapped = await tavilyMap(client, idx);
        const picked = pickSitePages(mapped, idx, known, new Date(window.start).getUTCFullYear(), cfg.tavilySitePages);
        if (picked.length) {
          newsroomUrl = idx;
          mappedUrls = mapped.length;
          siteUrls = picked;
          break;
        }
      } catch (e) {
        warnings.push(`Tavily Map on ${idx} failed: ${(e as Error).message}`);
      }
    }
    if (!siteUrls.length) warnings.push(`No newsroom pages found on ${od} with Tavily Map.`);
  }

  // One Extract call: top search results + the mapped newsroom pages (5 URLs = 1 credit).
  let extracted = 0;
  let sitePages = 0;
  const pre = normalizeHits(hits, queries, window, req);
  const topUrls = cfg.tavilyExtractTop > 0 ? pre.sources.filter((s) => s.origin !== "background").slice(0, cfg.tavilyExtractTop).map((s) => s.url) : [];
  let texts = new Map<string, string>();
  if (client && (topUrls.length || siteUrls.length)) {
    try {
      const raw = await tavilyExtract(client, [...topUrls, ...siteUrls]);
      texts = new Map([...raw].map(([u, t]) => [canonicalUrl(u), t]));
    } catch (e) {
      warnings.push(`Extract step skipped: ${(e as Error).message}`);
    }
  }
  for (const u of siteUrls) {
    const full = texts.get(canonicalUrl(u));
    if (!full) continue;
    const t = trimToArticle(u, full);
    texts.set(canonicalUrl(u), t);
    // Site pages carry no date from Map; take it from the URL or the page text, else leave undated.
    hits.push({ queryId: "SITE", url: u, title: titleFromPage(u), content: t, publishedDate: parsePageDate(u, t), score: 0.6, origin: "site" });
  }
  const { sources, stats } = siteUrls.length ? normalizeHits(hits, queries, window, req) : pre;
  for (const s of sources) {
    const t = texts.get(s.url);
    if (t) {
      s.content = t;
      s.extracted = true;
      extracted++;
      if (s.origin === "site") sitePages++;
    }
  }
  if (!sources.length) warnings.push("No sources found inside the research window.");

  // Demo mode: no Tavily calls; estimate what the same plan costs live, and count fixture newsroom pages.
  let mockUsage: { calls: number; credits: number } | null = null;
  if (cfg.mock) {
    for (const s of sources) if (s.origin === "site") sitePages++;
    const extractN = Math.min(cfg.tavilyExtractTop, sources.filter((s) => s.origin !== "background").length) + (req.officialDomain ? cfg.tavilySitePages : 0);
    mockUsage = estimateTavilyUsage(queries, extractN, Boolean(req.officialDomain && cfg.tavilySitePages > 0));
    warnings.push(`Demo mode: no Tavily calls were made. A live run of this plan makes ${mockUsage.calls} calls (~${mockUsage.credits} credits).`);
  }

  return {
    request: req,
    window,
    queries,
    sources,
    stats: {
      queries: queries.length,
      failedQueries: failed,
      extracted,
      ...stats,
      ...(client
        ? { mappedUrls, sitePages, tavilyCalls: client.usage!.calls, tavilyCredits: client.usage!.credits, ...(newsroomUrl ? { newsroomUrl } : {}) }
        : {}),
      ...(mockUsage ? { sitePages, tavilyCalls: mockUsage.calls, tavilyCredits: mockUsage.credits, tavilyEstimated: true } : {}),
    },
    searchMode: cfg.mock ? "mock" : "tavily",
    warnings,
    durationMs: Date.now() - t0,
  };
}

export async function generateBriefing(
  input: BriefingRequestInput,
  opts: { research?: ResearchResult | undefined; cfg?: BriefingConfig | undefined } = {},
): Promise<Briefing> {
  const cfg = opts.cfg ?? getConfig();
  const t0 = Date.now();
  const research = opts.research ?? (await researchTarget(input, cfg));
  const req = research.request;
  const warnings = [...research.warnings];
  const sources = research.sources;

  let draft: Draft;
  let engine: Briefing["engine"] = { search: research.searchMode, llm: "heuristic" };
  if (cfg.mock) {
    draft = mockDraft(req, sources);
    engine = { search: research.searchMode, llm: "mock", model: "deterministic-mock" };
  } else if (!sources.length) {
    draft = { tldr: [], claims: [], talkingPoints: [], openQuestions: [] };
  } else {
    const llm = await completeJson(cfg, buildMessages(req, research.window, selectForPrompt(sources, cfg.llmMaxSources), cfg.llmSourceChars), warnings);
    if (llm) {
      try {
        draft = parseJsonLoose(llm.text) as Draft;
        engine = { search: research.searchMode, llm: llm.provider, model: llm.model };
      } catch (e) {
        warnings.push(`Model output unparseable (${(e as Error).message}); used extractive fallback.`);
        draft = heuristicDraft(req, sources);
      }
    } else {
      warnings.push(
        describeConfig(cfg).llmChain.length > 1
          ? "All configured models failed (see warnings above) — used extractive fallback."
          : "No LLM configured (set BIFROST_URL or a provider key) — used extractive fallback.",
      );
      draft = heuristicDraft(req, sources);
    }
  }

  // Optional semantic check (VERIFY_LLM=1): one batched call; failures fall back to the lexical guard.
  const judged = cfg.mock ? null : await llmSupportCheck(cfg, draft, sources, warnings);
  const a = assemble(draft, sources, { target: targetRef(req), llmUnsupported: judged?.unsupported });
  if (a.dropped.length) warnings.push(...a.dropped.map((d) => `Dropped unsupported statement — ${d}`));
  warnings.push(
    `Citation check: rejected ${a.citationsRemoved} off-topic/unsupported citation(s)` +
      (judged ? ` (LLM support check by ${judged.model} on ${judged.checked} statements)` : " (lexical + entity check)") +
      ".",
  );
  if (a.citationNotes.length) warnings.push(...a.citationNotes.slice(0, 8).map((n) => `Citation removed — ${n}`));
  const cited = sources.filter((s) => a.citedIds.has(s.id));

  return {
    id: randomUUID(),
    title: `Pre-meeting brief: ${req.target}`,
    request: req,
    window: research.window,
    generatedAt: new Date().toISOString(),
    engine,
    tldr: a.tldr,
    keyDevelopments: a.keyDevelopments,
    peopleChanges: a.peopleChanges,
    uncertain: a.uncertain,
    talkingPoints: a.talkingPoints,
    openQuestions: a.openQuestions,
    sources: cited,
    stats: {
      sourcesReviewed: sources.length,
      sourcesCited: cited.length,
      claimsVerified: a.keyDevelopments.length + a.peopleChanges.length,
      claimsUncertain: a.uncertain.length,
      claimsDropped: a.dropped.length,
      citationsRemoved: a.citationsRemoved,
      ...(research.stats.sitePages !== undefined ? { sitePages: research.stats.sitePages } : {}),
      ...(research.stats.tavilyCalls !== undefined ? { tavilyCalls: research.stats.tavilyCalls, tavilyCredits: research.stats.tavilyCredits, ...(research.stats.tavilyEstimated ? { tavilyEstimated: true } : {}) } : {}),
      durationMs: (opts.research ? research.durationMs : 0) + (Date.now() - t0),
    },
    warnings,
    demoData: research.searchMode === "mock",
  };
}
