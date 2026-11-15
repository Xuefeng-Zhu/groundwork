import { describe, expect, it } from "vitest";

import { verifyClaim } from "../server/lib/briefing/verify";
import { assemble } from "../server/lib/briefing/synthesize";
import type { Source } from "../shared/briefing/schema";

// Synthetic, manually labeled examples. These test quantity matching, not
// whether the rest of a natural-language statement is semantically entailed.
const primarySource = (snippet: string, overrides: Partial<Source> = {}): Source => ({
  id: "S1",
  url: "https://acme.example/revenue",
  title: "Acme reports revenue",
  domain: "acme.example",
  publishedAt: "2026-11-10T12:00:00Z",
  snippet,
  queryIds: [],
  categories: ["financials"],
  score: 1,
  isPrimary: true,
  origin: "search",
  ...overrides,
});

const evaluate = (text: string, sources: Source[]) =>
  verifyClaim(
    { text, sourceIds: sources.map((s) => s.id) },
    0,
    new Map(sources.map((s) => [s.id, s])),
    { target: "Acme", targetType: "company" },
  );

describe("manually labeled quantity regression cases", () => {
  const equivalent = [
    ["million abbreviation", "Acme reported revenue of $120 million.", "Acme reported revenue of $120M."],
    ["equivalent magnitude", "Acme reported revenue of $1.2 billion.", "Acme reported revenue of $1,200 million."],
    ["percentage spelling", "Acme reported revenue growth of 30%.", "Acme reported revenue growth of 30 percent."],
    ["negative values", "Acme reported revenue growth of -3%.", "Acme reported revenue growth of -3 percent."],
    ["currency alias", "Acme reported revenue of €12M.", "Acme reported revenue of 12 million EUR."],
    ["qualified dollar and currency code", "Acme reported revenue of USD 12M.", "Acme reported revenue of US$12 million."],
    ["Unicode minus and sign after currency", "Acme reported net income of −€12M.", "Acme reported net income of €-12 million."],
    ["positive sign and unsigned positive value", "Acme reported revenue growth of +3%.", "Acme reported revenue growth of 3 percent."],
  ] as const;

  it.each(equivalent)("accepts %s when the source supports it", (_label, claim, evidence) => {
    expect(evaluate(claim, [primarySource(evidence)]).claim?.confidence).toBe("verified");
  });

  const unsupported = [
    ["different magnitude", "Acme reported revenue of $12 billion.", "Acme reported revenue of $12 million."],
    ["different currency", "Acme reported revenue of $120 million.", "Acme reported revenue of €120 million."],
    ["different dollar currency", "Acme reported revenue of US$12 million.", "Acme reported revenue of CAD 12 million."],
    ["unspecified dollar currency", "Acme reported revenue of USD 12 million.", "Acme reported revenue of $12 million."],
    ["percent versus count", "Acme reported revenue growth of 30%.", "Acme reported revenue growth of 30 units."],
    ["percent versus percentage points", "Acme reported margin growth of 3%.", "Acme reported margin growth of 3 percentage points."],
    ["negative versus positive", "Acme reported revenue growth of -3%.", "Acme reported revenue growth of 3%."],
    ["positive versus negative", "Acme reported revenue growth of 3%.", "Acme reported revenue growth of -3%."],
  ] as const;

  it.each(unsupported)("does not verify %s when the source contradicts it", (_label, claim, evidence) => {
    const result = evaluate(claim, [primarySource(evidence)]);
    expect(result.claim?.confidence).toBe("uncertain");
    expect(result.claim?.confidenceReason).toContain("does not match cited source");
  });

  it("does not let a mismatched primary citation upgrade a matching secondary citation", () => {
    const primary = primarySource("Acme reported revenue of $120 million.");
    const secondary = primarySource("Acme reported revenue of $120 billion.", {
      id: "S2",
      domain: "business.example",
      url: "https://business.example/acme-revenue",
      title: "Acme revenue coverage",
      isPrimary: false,
    });
    const result = evaluate("Acme reported revenue of $120 billion.", [primary, secondary]);
    expect(result.claim?.confidence).toBe("uncertain");
    expect(result.claim?.sourceIds).toEqual(["S2"]);
  });

  it("omits a TL;DR bullet whose sign contradicts the cited evidence", () => {
    const draft = {
      tldr: [{ text: "Acme reported revenue growth of +3%.", sourceIds: ["S1"] }],
      claims: [],
      talkingPoints: [],
      openQuestions: [],
    };
    expect(assemble(draft, [primarySource("Acme reported revenue growth of -3%.")]).tldr).toEqual([]);
  });
});
