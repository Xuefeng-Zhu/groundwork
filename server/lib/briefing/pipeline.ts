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
import { getConfig, type BriefingConfig } from "./config";
import { fixtureOrg, mockSearch } from "./fixtures";
import { completeJson, parseJsonLoose } from "./llm";
import { computeWindow, planQueries } from "./planner";
import { canonicalUrl, normalizeHits, type RawHit } from "./sources";
import { assemble, buildMessages, heuristicDraft, mockDraft, type Draft } from "./synthesize";
import { tavilyExtract, tavilySearch } from "./tavily";

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

  if (cfg.mock) {
    hits = mockSearch(req, queries, window);
  } else {
    if (!cfg.tavilyKey)
      throw new BriefingError("TAVILY_API_KEY is not set. Add it to .env, or run with MOCK=1 for the demo.", "missing_search_key");
    const settled = await Promise.allSettled(queries.map((q) => tavilySearch({ key: cfg.tavilyKey!, baseUrl: cfg.tavilyBaseUrl }, q, window)));
    settled.forEach((s, i) => {
      if (s.status === "fulfilled") hits.push(...s.value);
      else {
        failed++;
        warnings.push(`Search "${queries[i]?.query}" failed: ${(s.reason as Error).message}`);
      }
    });
    if (failed === queries.length) throw new BriefingError(warnings.join(" | "), "search_failed");
  }

  const { sources, stats } = normalizeHits(hits, queries, window, req);

  // Enrich the top sources with full text (Tavily Extract) so claims can be grounded.
  let extracted = 0;
  if (!cfg.mock && cfg.tavilyKey && cfg.tavilyExtractTop > 0) {
    const targets = sources.slice(0, cfg.tavilyExtractTop);
    try {
      const texts = await tavilyExtract({ key: cfg.tavilyKey, baseUrl: cfg.tavilyBaseUrl }, targets.map((s) => s.url));
      const byCanon = new Map([...texts].map(([u, t]) => [canonicalUrl(u), t]));
      for (const s of targets) {
        const t = byCanon.get(s.url);
        if (t) {
          s.content = t;
          s.extracted = true;
          extracted++;
        }
      }
    } catch (e) {
      warnings.push(`Extract step skipped: ${(e as Error).message}`);
    }
  }
  if (!sources.length) warnings.push("No sources found inside the research window.");

  return {
    request: req,
    window,
    queries,
    sources,
    stats: { queries: queries.length, failedQueries: failed, extracted, ...stats },
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
    const llm = await completeJson(cfg, buildMessages(req, research.window, sources.slice(0, 30)), warnings);
    if (llm) {
      try {
        draft = parseJsonLoose(llm.text) as Draft;
        engine = { search: research.searchMode, llm: llm.provider, model: llm.model };
      } catch (e) {
        warnings.push(`Model output unparseable (${(e as Error).message}); used extractive fallback.`);
        draft = heuristicDraft(req, sources);
      }
    } else {
      warnings.push("No LLM configured (set BIFROST_URL or a provider key) — used extractive fallback.");
      draft = heuristicDraft(req, sources);
    }
  }

  const a = assemble(draft, sources);
  if (a.dropped.length) warnings.push(...a.dropped.map((d) => `Dropped unsupported statement — ${d}`));
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
      durationMs: (opts.research ? research.durationMs : 0) + (Date.now() - t0),
    },
    warnings,
    demoData: research.searchMode === "mock",
  };
}
