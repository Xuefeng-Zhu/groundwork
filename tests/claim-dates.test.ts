import { describe, expect, it } from "vitest";

import type { Source } from "../shared/briefing/schema";
import { verifyClaim } from "../server/lib/briefing/verify";

const source = (overrides: Partial<Source> = {}): Source => ({
  id: "S1",
  url: "https://acme.example/news",
  title: "Acme launches new service",
  domain: "acme.example",
  publishedAt: "2026-11-14T00:00:00.000Z",
  snippet: "Acme launched its new service.",
  queryIds: [],
  categories: ["product"],
  score: 1,
  isPrimary: true,
  origin: "search",
  ...overrides,
});
const claim = (sources: Source[], date?: string | null, text = "Acme launched its new service.") =>
  verifyClaim({ text, date, sourceIds: sources.map((s) => s.id) }, 0, new Map(sources.map((s) => [s.id, s]))).claim;

describe("claim date validation", () => {
  it("does not infer an event date from the publication date", () => {
    const c = claim([source()]);
    expect(c?.date).toBeNull();
    expect(c?.confidence).toBe("verified");
  });

  it("withholds and downgrades a model-proposed date absent from source text, including the publication date", () => {
    const c = claim([source()], "2026-11-14");
    expect(c?.date).toBeNull();
    expect(c?.confidence).toBe("uncertain");
    expect(c?.confidenceReason).toContain("claim date 2026-11-14 is not found");
  });

  it("accepts a complete date explicitly mentioned in the cited text", () => {
    const c = claim([source({ snippet: "Acme launched its new service on November 14, 2026." })], "2026-11-14");
    expect(c?.date).toBe("2026-11-14T00:00:00.000Z");
    expect(c?.confidence).toBe("verified");
  });

  it("uses the timestamp's own calendar date rather than shifting it to UTC", () => {
    const c = claim([source({ snippet: "Acme launched its new service on 14 November 2026." })], "2026-11-14T23:30:00-08:00");
    expect(c?.date).toBe("2026-11-14T00:00:00.000Z");
  });

  it("rejects impossible dates and unrelated year, month and day occurrences", () => {
    const invalid = claim([source()], "2026-02-30");
    expect(invalid?.date).toBeNull();
    expect(invalid?.confidenceReason).toContain("claim date is invalid");
    const s = source({ snippet: "Acme launched its new service on November 15, 2026, after an earlier October 14 announcement." });
    expect(claim([s], "2026-11-14")?.confidence).toBe("uncertain");
  });

  it("checks complete dates in claim text even when the date field is absent", () => {
    const c = claim([source({ snippet: "Acme launched its new service on November 15, 2026." })], null, "Acme launched its new service on November 14, 2026.");
    expect(c?.confidence).toBe("uncertain");
    expect(c?.confidenceReason).toContain("date 2026-11-14 in claim text is not found");
  });
});

describe("dated non-background citations for verification", () => {
  it("does not let an undated primary or second domain upgrade one dated secondary report", () => {
    const secondary = source({ isPrimary: false });
    const undated = source({ id: "S2", domain: "other.example", publishedAt: null, isPrimary: true });
    const c = claim([secondary, undated]);
    expect(c?.confidence).toBe("uncertain");
    expect(c?.confidenceReason).toContain("single secondary source");
  });

  it("does not let an older background primary or second domain upgrade a recent secondary report", () => {
    const secondary = source({ isPrimary: false });
    const background = source({ id: "S2", domain: "other.example", publishedAt: "2026-01-01T00:00:00Z", isPrimary: true, origin: "background" });
    expect(claim([secondary, background])?.confidence).toBe("uncertain");
  });

  it("still verifies against two dated, non-background domains", () => {
    const a = source({ isPrimary: false });
    const b = source({ id: "S2", domain: "other.example", isPrimary: false });
    expect(claim([a, b])?.confidence).toBe("verified");
  });
});
