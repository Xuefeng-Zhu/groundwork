import { describe, expect, it } from "vitest";

import { normalizeHits, type RawHit } from "../server/lib/briefing/sources";
import { parsePageDate } from "../server/lib/briefing/site";
import { briefingRequestSchema } from "../shared/briefing/schema";

const req = briefingRequestSchema.parse({
  target: "Acme",
  meetingAt: "2026-11-20T18:00:00Z",
});
const window = { start: "2026-10-21T18:00:00Z", end: "2026-11-20T18:00:00Z" };
const hit = (id: string, publishedDate: string | null, origin: RawHit["origin"] = "search"): RawHit => ({
  queryId: "Q1", url: `https://${id}.example/acme`, title: `Acme ${id} announcement`, content: "Acme news", publishedDate, origin,
});

describe("source date boundaries", () => {
  it("includes precise endpoints and excludes earlier and later instants, including future background", () => {
    const result = normalizeHits([
      hit("before", "2026-10-21T17:59:59.999Z"),
      hit("start", "2026-10-21T18:00:00Z"),
      hit("end", "2026-11-20T18:00:00Z"),
      hit("after", "2026-11-20T18:00:00.001Z"),
      hit("afterbg", "2026-11-20T18:01:00Z", "background"),
      hit("oldbg", "2026-10-20T12:00:00Z", "background"),
    ], [], window, req);
    expect(result.sources.map((s) => s.url).sort()).toEqual([
      "https://end.example/acme", "https://oldbg.example/acme", "https://start.example/acme",
    ]);
    expect(result.sources.find((s) => s.url.includes("oldbg"))?.origin).toBe("background");
    expect(result.stats.outOfWindow).toBe(3);
  });

  it("requires all possible instants on a date-only day to fit the window", () => {
    const result = normalizeHits([
      hit("startday", "2026-10-21"),
      hit("startoverlap", "2026-10-22"),
      hit("firstfull", "2026-10-23"),
      hit("lastfull", "2026-11-19"),
      hit("meetingday", "2026-11-20"),
      hit("backgroundmeetingday", "2026-11-20", "background"),
      hit("backgroundstartday", "2026-10-21", "background"),
    ], [], window, req);
    expect(result.sources.map((s) => s.url).sort()).toEqual([
      "https://backgroundstartday.example/acme", "https://firstfull.example/acme", "https://lastfull.example/acme",
    ]);
    expect(result.sources.find((s) => s.url.includes("firstfull"))?.publishedAt).toBe("2026-10-23");
    expect(result.sources.find((s) => s.url.includes("backgroundstartday"))?.origin).toBe("background");
    expect(result.stats.outOfWindow).toBe(4);
  });

  it("retains undated, invalid, and timezone-free timestamps as undated sources", () => {
    const result = normalizeHits([
      hit("undated", null),
      hit("invalid", "2026-02-30"),
      hit("invalidiso", "2026-02-30T12:00:00Z"),
      hit("local", "2026-11-20T19:00:00"),
      hit("ambiguous-format", "November 20, 2026"),
    ], [], window, req);
    expect(result.sources).toHaveLength(5);
    expect(result.sources.every((source) => source.publishedAt === null)).toBe(true);
    expect(result.stats.undated).toBe(5);
  });

  it("preserves date precision when extracting newsroom dates", () => {
    expect(parsePageDate("https://acme.com/news/2026/11/20/launch", "")).toBe("2026-11-20");
    expect(parsePageDate("https://acme.com/news/2026/02/30/launch", "")).toBeNull();
  });
});
