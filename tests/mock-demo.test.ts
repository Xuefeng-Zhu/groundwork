/** The MOCK=1 demo fixture must exercise the verifier and report a Tavily budget estimate. */
import { describe, expect, it } from "vitest";

import { getConfig } from "../server/lib/briefing/config";
import { generateBriefing } from "../server/lib/briefing/pipeline";

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
});
