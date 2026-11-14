/**
 * Citation-drift guard: a cited source must be about the target AND share the claim's
 * key names/figures. Regression for the real Snowflake run where a TL;DR about Snowflake's
 * revenue cited an unrelated "AI developer IPO roadshow" article.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Source } from "../shared/briefing/schema";
import { getConfig } from "../server/lib/briefing/config";
import { assemble } from "../server/lib/briefing/synthesize";
import { llmSupportCheck } from "../server/lib/briefing/support-check";
import { checkCitation, claimEntities, isAboutTarget, verifyClaim } from "../server/lib/briefing/verify";

const src = (id: string, o: Partial<Source>): Source => ({
  id,
  url: `https://example.com/${id}`,
  title: "",
  domain: "example.com",
  publishedAt: "2026-11-11T00:00:00.000Z",
  snippet: "",
  queryIds: ["Q1"],
  categories: ["news"],
  score: 0.5,
  isPrimary: false,
  ...o,
});

const T = { target: "Snowflake", targetType: "company" as const, officialDomain: "snowflake.com" };

const S = [
  src("S1", {
    url: "https://fool.com/snowflake-vs-adobe",
    domain: "fool.com",
    title: "Adobe vs. Snowflake: which stock is a better buy?",
    snippet: "Snowflake fiscal 2026 revenue was $4.7 billion, up 29.2%, with a net loss of $1.3 billion.",
  }),
  src("S2", {
    url: "https://tradingview.com/news/ai-developer-ipo-roadshow",
    domain: "tradingview.com",
    title: "An AI Developer Starts Its IPO Roadshow, and Its Filing Names Chip and Cloud Partners",
    snippet: "The AI developer set a price range for its IPO and named Nvidia and Microsoft as partners.",
  }),
  src("S3", {
    url: "https://snowflake.com/en/news/press-releases/expedition-2026",
    domain: "snowflake.com",
    isPrimary: true,
    title: "Snowflake launches Cortex AI Gateway",
    snippet: "Snowflake today launched Cortex AI Gateway and Business Ontology at Expedition 2026.",
  }),
  src("S4", {
    url: "https://marketbeat.com/snow-shares",
    domain: "marketbeat.com",
    title: "Snowflake Inc. shares sold by Allspring",
    snippet: "Allspring Global Investments sold Snowflake shares. Insiders sold $370 million of stock in 90 days.",
  }),
];
const byId = new Map(S.map((s) => [s.id, s]));

describe("citation-drift guard", () => {
  it("detects whether a source is about the target", () => {
    expect(isAboutTarget(S[0]!, T)).toBe(true);
    expect(isAboutTarget(S[1]!, T)).toBe(false); // the off-topic IPO article
    expect(isAboutTarget(src("X", { domain: "docs.snowflake.com", title: "Docs" }), T)).toBe(true); // official domain
    expect(isAboutTarget(src("Y", { title: "Snowflakes fall in Denver" }), T)).toBe(false); // word boundary
  });

  it("extracts entities without the target's own name", () => {
    expect(claimEntities("Snowflake and SAP announced a zero-copy integration with Oracle OCI.", T)).toEqual(["sap", "oracle", "oci"]);
  });

  it("rejects an on-topic source that shares none of the claim's figures", () => {
    const c = checkCitation("Snowflake fiscal 2026 revenue was $4.7 billion, up 29.2%.", S[3]!, T);
    expect(c.about).toBe(true);
    expect(c.supports).toBe(false);
    expect(checkCitation("Snowflake fiscal 2026 revenue was $4.7 billion, up 29.2%.", S[0]!, T).supports).toBe(true);
  });

  it("removes an off-topic citation but keeps the claim on its real source", () => {
    const r = verifyClaim(
      { text: "Snowflake fiscal 2026 revenue was $4.7 billion, up 29.2%, with a $1.3 billion net loss.", category: "financials", sourceIds: ["S1", "S2"] },
      0,
      byId,
      T,
    );
    expect(r.claim?.sourceIds).toEqual(["S1"]);
    expect(r.removedCitations?.map((c) => c.id)).toEqual(["S2"]);
    expect(r.claim?.confidence).toBe("uncertain"); // single secondary source after S2 is gone
  });

  it("drops a claim whose only citation is off-topic", () => {
    const r = verifyClaim({ text: "Snowflake priced its IPO and named Nvidia as a partner.", sourceIds: ["S2"] }, 0, byId, T);
    expect(r.claim).toBeNull();
    expect(r.droppedReason).toMatch(/off-topic/);
  });

  it("marks uncertain when on-topic sources do not support the claim", () => {
    const r = verifyClaim({ text: "Snowflake acquired Databricks for $90 billion.", sourceIds: ["S3"] }, 0, byId, T);
    expect(r.claim?.confidence).toBe("uncertain");
    expect(r.claim?.confidenceReason).toMatch(/no cited source clearly supports/);
  });

  it("strips the drifted citation from the TL;DR and counts it (regression)", () => {
    const a = assemble(
      {
        tldr: [
          { text: "Snowflake fiscal 2026 revenue hit $4.7 billion (+29.2%) with a $1.3 billion net loss.", sourceIds: ["S1", "S2", "S4"] },
          { text: "An AI developer started its IPO roadshow naming Nvidia and Microsoft.", sourceIds: ["S2"] },
        ],
        claims: [{ text: "Snowflake launched Cortex AI Gateway at Expedition 2026.", category: "product", sourceIds: ["S3", "S2"] }],
        talkingPoints: [{ text: "Ask about the new AI Gateway.", sourceIds: ["S3", "S2"] }],
        openQuestions: [],
      },
      S,
      { target: T },
    );
    expect(a.tldr).toHaveLength(1);
    expect(a.tldr[0]!.sourceIds).toEqual(["S1"]);
    expect(a.keyDevelopments[0]!.sourceIds).toEqual(["S3"]);
    expect(a.keyDevelopments[0]!.confidence).toBe("verified"); // primary source
    expect(a.talkingPoints[0]!.sourceIds).toEqual(["S3"]);
    expect(a.citedIds.has("S2")).toBe(false);
    expect(a.citationsRemoved).toBe(5); // S2+S4 from TL;DR 1, S2 from TL;DR 2, S2 from claim, S2 from talking point
    expect(a.dropped.some((d) => d.includes("IPO roadshow"))).toBe(true);
  });

  it("applies LLM verdicts on top of the lexical guard", () => {
    const a = assemble(
      { tldr: [], claims: [{ text: "Snowflake launched Cortex AI Gateway at Expedition 2026.", sourceIds: ["S3"] }], talkingPoints: [], openQuestions: [] },
      S,
      { target: T, llmUnsupported: new Map([["claim:0", new Set(["S3"])]]) },
    );
    expect(a.uncertain[0]!.confidenceReason).toMatch(/LLM support check/);
    expect(a.citationsRemoved).toBe(1); // rejected, kept only as reference on the downgraded claim
  });
});

describe("LLM support check (VERIFY_LLM=1)", () => {
  let srv: Server;
  let url = "";
  let mode: "ok" | "fail" = "ok";
  const bodies: any[] = [];
  beforeAll(async () => {
    srv = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        bodies.push(JSON.parse(raw));
        if (mode === "fail") {
          res.statusCode = 503;
          return res.end("down");
        }
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ results: [{ key: "claim:0", supported: [] }, { key: "tldr:0", supported: ["S1"] }] }) } }] }));
      });
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/v1`;
  });
  afterAll(() => srv?.close());

  const draft = {
    tldr: [{ text: "Snowflake revenue hit $4.7 billion.", sourceIds: ["S1", "S4"] }],
    claims: [{ text: "Snowflake launched Cortex AI Gateway.", sourceIds: ["S3"] }],
    talkingPoints: [],
    openQuestions: [],
  };

  it("batches every statement into one call to the cheap model", async () => {
    const cfg = { ...getConfig({ VERIFY_LLM: "1" }), bifrostUrl: url };
    const w: string[] = [];
    const r = await llmSupportCheck(cfg, draft, S, w);
    expect(bodies).toHaveLength(1);
    expect(bodies[0].model).toBe("groq/openai/gpt-oss-120b");
    expect(r?.checked).toBe(2);
    expect([...r!.unsupported.get("claim:0")!]).toEqual(["S3"]);
    expect([...r!.unsupported.get("tldr:0")!]).toEqual(["S4"]);
  });

  it("falls back gracefully when the judge fails", async () => {
    mode = "fail";
    const cfg = { ...getConfig({ VERIFY_LLM: "1" }), bifrostUrl: url };
    const w: string[] = [];
    expect(await llmSupportCheck(cfg, draft, S, w)).toBeNull();
    expect(w[0]).toMatch(/LLM support check skipped/);
  });

  it("is off unless VERIFY_LLM is set", async () => {
    expect(await llmSupportCheck({ ...getConfig({}), bifrostUrl: url }, draft, S, [])).toBeNull();
  });
});
