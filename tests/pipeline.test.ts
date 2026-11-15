/**
 * End-to-end test of the LIVE code path (Tavily client + Bifrost client + verification)
 * against local stand-in servers, so no real keys are needed.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { briefingToMarkdown } from "../shared/briefing/markdown";
import { getConfig } from "../server/lib/briefing/config";
import { generateBriefing, researchTarget } from "../server/lib/briefing/pipeline";
import { extractFigures, ground } from "../server/lib/briefing/verify";
import { canonicalUrl, rootDomain, selectForPrompt } from "../server/lib/briefing/sources";
import { parsePageDate, pickSitePages } from "../server/lib/briefing/site";

const MEETING = "2026-11-20T18:00:00.000Z";
const day = (n: number) => new Date(Date.parse(MEETING) - n * 86_400_000).toUTCString();
let tavily: Server;
let bifrost: Server;
let tavilyUrl = "";
let bifrostUrl = "";
const seen: { tavilyBodies: any[]; bifrostBodies: any[] } = { tavilyBodies: [], bifrostBodies: [] };

function listen(handler: (body: any, path: string) => unknown): Promise<[Server, string]> {
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const out = handler(raw ? JSON.parse(raw) : {}, req.url ?? "/");
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(out));
      });
    });
    srv.listen(0, "127.0.0.1", () => resolve([srv, `http://127.0.0.1:${(srv.address() as AddressInfo).port}`]));
  });
}

beforeAll(async () => {
  [tavily, tavilyUrl] = await listen((body, path) => {
    seen.tavilyBodies.push({ path, body });
    if (path === "/extract")
      return {
        results: body.urls.map((u: string) => ({
          url: u,
          raw_content: u.includes("berlin")
            ? `Home Products Newsroom Acme opens Berlin office November 12, 2026 Acme today opened an office in Berlin.`
            : u.includes("picnic")
              ? `Acme annual picnic June 3, 2019 Fun was had.`
              : `Full text for ${u}. Acme raised $50 million.`,
        })),
        usage: { credits: 1 },
      };
    if (path === "/map")
      return {
        results: [
          "https://acme.com/newsroom",
          "https://acme.com/newsroom/acme-opens-berlin-office",
          "https://acme.com/newsroom/acme-2019-annual-picnic",
          "https://acme.com/pricing",
          "https://acme.com/newsroom/page",
        ],
        usage: { credits: 1 },
      };
    if (!body.start_date)
      return { results: [{ title: "About Acme", url: "https://wiki.example/acme", content: "Acme makes widgets for factories.", score: 0.5, published_date: day(400) }], usage: { credits: 1 } };
    if (body.include_domains?.length)
      return { results: [{ title: "Acme press release", url: "https://acme.com/newsroom/acme-series-b", content: "Acme raised $50 million.", score: 0.7, published_date: day(3) }], usage: { credits: 1 } };
    return {
      usage: { credits: 2 },
      results: [
        { title: "Acme raises $50M Series B", url: "https://techwire.com/acme-b?utm_source=x", content: "Acme raised $50 million led by Foo Capital.", score: 0.9, published_date: day(3) },
        { title: "Acme lands $50 million Series B", url: "https://bizdaily.com/acme", content: "Acme closed a $50 million Series B.", score: 0.8, published_date: day(4) },
        { title: "Acme old award", url: "https://old.com/acme", content: "Old", score: 0.7, published_date: day(80) },
        { title: "Acme names Jo Lee CTO", url: "https://hr.com/acme-cto", content: "Acme named Jo Lee as CTO.", score: 0.6, published_date: day(10) },
      ],
    };
  });
  [bifrost, bifrostUrl] = await listen((body) => {
    seen.bifrostBodies.push(body);
    const content = JSON.stringify({
      tldr: [{ text: "Acme raised a $50M Series B.", sourceIds: ["S1", "S2"] }],
      claims: [
        { text: "Acme raised $50 million in a Series B.", category: "funding", sourceIds: ["S1", "S2"] },
        { text: "Acme named Jo Lee as CTO.", category: "people", sourceIds: ["S3"] },
        { text: "Acme has 900 employees.", category: "news", sourceIds: ["S1"] },
        { text: "Acme will IPO.", category: "funding", sourceIds: ["S42"] },
      ],
      talkingPoints: [{ text: "Ask about Series B priorities.", sourceIds: ["S1"] }],
      openQuestions: [{ text: "Who owns the roadmap now?", why: "new CTO", sourceIds: ["S3"] }],
    });
    return { choices: [{ message: { content: "```json\n" + content + "\n```" } }] };
  });
});

afterAll(() => {
  tavily?.close();
  bifrost?.close();
});

const req = { target: "Acme", targetType: "company" as const, meetingAt: MEETING, purpose: "sales" as const };

describe("live path with stand-in Tavily + Bifrost", () => {
  it("researches with a hard date window and dedupes", async () => {
    const cfg = { ...getConfig({}), tavilyKey: "test", tavilyBaseUrl: tavilyUrl, tavilyExtractTop: 2 };
    const r = await researchTarget(req, cfg);
    const search = seen.tavilyBodies.find((b) => b.path === "/search")!.body;
    expect(search.topic).toBeDefined();
    expect(search.include_answer).toBe(false);
    expect(search.start_date).toBe("2026-10-21");
    expect(search.end_date).toBe("2026-11-20");
    expect(r.stats.outOfWindow).toBeGreaterThan(0);
    expect(r.sources.map((s) => s.url)).not.toContain("https://old.com/acme");
    expect(r.sources.filter((s) => s.origin === "search").length).toBe(3); // same 3 URLs from every news query -> deduped
    expect(r.stats.extracted).toBe(2);
    // background query: general topic, no date filter, cheap; its old result is kept as context only
    const bg = seen.tavilyBodies.find((b) => b.path === "/search" && !b.body.start_date)!.body;
    expect(bg.topic).toBe("general");
    expect(bg.search_depth).toBe("basic");
    const bgSrc = r.sources.find((s) => s.url === "https://wiki.example/acme");
    expect(bgSrc?.origin).toBe("background");
    expect(r.stats.tavilyCredits).toBeGreaterThan(0);
  });

  it("maps the official newsroom and extracts the newest pages when a domain is given", async () => {
    seen.tavilyBodies.length = 0;
    const cfg = { ...getConfig({}), tavilyKey: "test", tavilyBaseUrl: tavilyUrl, tavilyExtractTop: 2, tavilySitePages: 2 };
    const r = await researchTarget({ ...req, officialDomain: "acme.com" }, cfg);
    const official = seen.tavilyBodies.find((b) => b.body.include_domains)!.body;
    expect(official.include_domains).toEqual(["acme.com"]);
    expect(official.start_date).toBe("2026-10-21");
    const map = seen.tavilyBodies.find((b) => b.path === "/map")!.body;
    expect(map.url).toBe("https://acme.com/newsroom"); // discovered from the official search hit
    expect(map.max_depth).toBe(1);
    expect(seen.tavilyBodies.filter((b) => b.path === "/extract")).toHaveLength(1); // one batched extract
    const site = r.sources.find((s) => s.origin === "site")!;
    expect(site.url).toBe("https://acme.com/newsroom/acme-opens-berlin-office");
    expect(site.publishedAt?.slice(0, 10)).toBe("2026-11-12");
    expect(site.isPrimary).toBe(true);
    expect(site.content?.startsWith("Acme opens Berlin office")).toBe(true); // nav trimmed
    expect(r.stats.sitePages).toBe(1); // the 2019 picnic page is out of window
    expect(r.stats.newsroomUrl).toBe("https://acme.com/newsroom");
  });

  it("synthesises via Bifrost and enforces verification in code", async () => {
    const cfg = { ...getConfig({}), tavilyKey: "test", tavilyBaseUrl: tavilyUrl, tavilyExtractTop: 0, bifrostUrl, bifrostModel: "openai/gpt-4o-mini" };
    const b = await generateBriefing(req, { cfg });
    expect(seen.bifrostBodies[0].model).toBe("openai/gpt-4o-mini");
    expect(b.engine.llm).toBe("bifrost");
    expect(b.keyDevelopments.map((c) => c.text)).toContain("Acme raised $50 million in a Series B.");
    const uncertain = b.uncertain.map((c) => c.text);
    expect(uncertain).toContain("Acme named Jo Lee as CTO."); // single secondary source
    expect(uncertain).toContain("Acme has 900 employees."); // invented figure
    expect(b.stats.claimsDropped).toBe(1); // bogus S42 citation
    expect(briefingToMarkdown(b)).toContain("## Uncertain / unverified");
  });

  it("falls back to the extractive drafter when no LLM is reachable", async () => {
    const cfg = { ...getConfig({}), tavilyKey: "test", tavilyBaseUrl: tavilyUrl, tavilyExtractTop: 0, bifrostUrl: "http://127.0.0.1:9/v1", llmTimeoutMs: 2000 };
    const b = await generateBriefing(req, { cfg });
    expect(b.engine.llm).toBe("heuristic");
    expect(b.warnings.some((w) => w.includes("Bifrost call failed"))).toBe(true);
    expect(b.keyDevelopments.length + b.uncertain.length).toBeGreaterThan(0);
  });

  it("refuses to run live without a Tavily key", async () => {
    await expect(researchTarget(req, { ...getConfig({}) })).rejects.toThrow(/TAVILY_API_KEY/);
  });
});

describe("verification primitives", () => {
  it("extracts figures and checks them against sources", () => {
    expect(extractFigures("raised $120M at $1.4B, 30% growth in 2026")).toEqual(["120", "1.4", "30", "2026"]);
    const src = [{ id: "S1", url: "u", title: "t", domain: "d", publishedAt: null, snippet: "raised $120 million", queryIds: [], categories: [], score: 0, isPrimary: false }];
    expect(ground("raised $120M", src as any).missingFigures).toEqual([]);
    expect(ground("raised $300M", src as any).missingFigures).toEqual(["300"]);
  });
  it("parses page dates and picks newest newsroom pages", () => {
    expect(parsePageDate("https://x.com/blog/2026/11/04/foo", "")).toBe("2026-11-04");
    expect(parsePageDate("https://x.com/news/foo", "Posted Nov 4, 2026 by team")).toBe("2026-11-04");
    expect(parsePageDate("https://x.com/news/foo", "no date here")).toBeNull();
    const picked = pickSitePages(
      ["https://x.com/news", "https://x.com/news/old-2019-thing", "https://x.com/news/new-launch-2026", "https://x.com/news/plain-story-here", "https://x.com/about"],
      "https://x.com/news",
      new Set(),
      2026,
      2,
    );
    expect(picked).toEqual(["https://x.com/news/new-launch-2026", "https://x.com/news/plain-story-here"]);
  });
  it("reserves prompt slots for first-party sources", () => {
    const mk = (id: string, isPrimary = false, origin: "search" | "background" | "site" = "search") =>
      ({ id, isPrimary, origin }) as any;
    const all = [mk("S1"), mk("S2"), mk("S3", false, "background"), mk("S4", false, "background"), mk("S5"), mk("S6", true, "site")];
    expect(selectForPrompt(all, 3).map((s) => s.id)).toEqual(["S1", "S2", "S6"]);
    expect(selectForPrompt(all, 5).map((s) => s.id)).toEqual(["S1", "S2", "S3", "S5", "S6"]);
  });
  it("canonicalises urls and domains", () => {
    expect(canonicalUrl("https://www.x.com/a/?utm_source=z#top")).toBe("https://x.com/a");
    expect(rootDomain("news.bbc.co.uk")).toBe("bbc.co.uk");
  });
});
