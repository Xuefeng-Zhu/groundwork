/** The MOCK=1 demo fixture must exercise the verifier and report a Tavily budget estimate. */
import { describe, expect, it } from "vitest";

import { getConfig } from "../server/lib/briefing/config";
import { generateBriefing, researchTarget } from "../server/lib/briefing/pipeline";

describe("mock demo brief", () => {
  it("removes the off-topic citation, keeps the newsroom page and estimates Tavily usage", async () => {
    const b = await generateBriefing(
      { target: "Northwind Robotics", targetType: "company", officialDomain: "northwindrobotics.com", purpose: "sales", meetingAt: "2026-11-20T18:00:00Z" } as any,
      { cfg: { ...getConfig(), mock: true } },
    );
    expect(b.demoData).toBe(true);
    expect(b.stats.citationsRemoved).toBeGreaterThanOrEqual(2);
    expect(b.warnings.some((w) => w.includes("source is not about the target"))).toBe(true);
    expect(b.sources.some((s) => s.domain === "dronetimes.example")).toBe(false);
    expect(b.keyDevelopments.some((c) => c.text.includes("Helios"))).toBe(true);
    expect(b.sources.some((s) => s.origin === "site")).toBe(true);
    expect(b.stats.sitePages).toBe(1);
    expect(b.stats.tavilyEstimated).toBe(true);
    expect(b.stats.tavilyCredits).toBeGreaterThanOrEqual(10);
  });
  it("rechecks reused research against the actual meeting rather than its supplied window", async () => {
    const request = { target: "Northwind Robotics", targetType: "company" as const, meetingAt: "2026-11-20T18:00:00Z" };
    const cfg = { ...getConfig(), mock: true };
    const research = await researchTarget(request, cfg);
    const originalCount = research.sources.length;
    research.sources[0]!.publishedAt = "2026-11-20T18:00:01.000Z";
    research.window.end = "2026-11-21T18:00:00.000Z";
    const brief = await generateBriefing(request, { cfg, research });
    expect(brief.window.end).toBe("2026-11-20T18:00:00.000Z");
    expect(brief.stats.sourcesReviewed).toBe(originalCount - 1);
    expect(brief.warnings.some((w) => w.includes("Excluded 1 source(s) outside"))).toBe(true);
  });

  it("rejects ambiguous or impossible meeting timestamps", async () => {
    const cfg = { ...getConfig(), mock: true };
    for (const meetingAt of ["2026-11-20T18:00:00", "2026-02-30T18:00:00Z", "2026-11-20"]) {
      await expect(researchTarget({ target: "Acme", meetingAt }, cfg)).rejects.toThrow(/valid ISO timestamp with timezone/);
    }
  });

});
