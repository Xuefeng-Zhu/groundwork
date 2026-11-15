import { describe, expect, it } from "vitest";
import type { Source } from "../shared/briefing/schema";
import { coverageCount } from "../server/lib/briefing/independent";
import { verifyClaim } from "../server/lib/briefing/verify";

const source = (domain: string, title: string, snippet = ""): Source => ({
  id: domain, url: `https://${domain}/story`, domain, title, snippet,
  publishedAt: "2026-11-10T12:00:00Z", queryIds: [], categories: ["news"], score: 1, isPrimary: false,
});

describe("distinct coverage", () => {
  it("does not count a copied wire headline on different sites twice", () => {
    const title = "Acme launches new product for European customers";
    expect(coverageCount([source("one.com", title), source("two.com", title)])).toBe(1);
  });
  it("does not count exact long syndicated copy twice despite different headlines", () => {
    const text = "Acme launched its product at a customer event today and announced that it will be available across Europe next month.";
    expect(coverageCount([source("one.com", "Acme launch", text), source("two.com", "New product", text)])).toBe(1);
  });
  it("does not verify a claim solely on duplicated articles across sites", () => {
    const title = "Acme launches new product for European customers";
    const sources = [source("one.com", title), source("two.com", title)];
    const result = verifyClaim({ text: title, sourceIds: ["one.com", "two.com"] }, 0, new Map(sources.map((s) => [s.id.toUpperCase(), s])));
    expect(result.claim?.confidence).toBe("uncertain");
  });
  it("counts distinct headlines on different domains but not the same root domain", () => {
    expect(coverageCount([source("news.one.com", "Acme launches new product"), source("one.com", "What the Acme launch means"), source("two.com", "Inside Acme's European expansion")])).toBe(2);
  });
});
