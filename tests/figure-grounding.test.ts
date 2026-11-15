import { describe, expect, it } from "vitest";
import { extractFigures, ground } from "../server/lib/briefing/verify";

const source = (text: string) => ({ title: "Acme company update", snippet: text });

describe("figure grounding", () => {
  it("checks complete numeric tokens instead of digit substrings", () => {
    expect(ground("Acme increased revenue by 30%", [source("Acme increased revenue by 130%") as any]).missingFigures).toEqual(["30"]);
    expect(ground("Acme gained 1 customer", [source("Acme gained 1.4 million customers") as any]).missingFigures).toEqual(["1"]);
  });

  it("checks single digits, years, and date components", () => {
    expect(extractFigures("Acme opened 3 offices in 2026 on 2026-11-07")).toEqual(["3", "2026", "11", "7"]);
    expect(ground("Acme opened 3 offices in 2026", [source("Acme opened 4 offices in 2025") as any]).missingFigures).toEqual(["3", "2026"]);
  });

  it("recognizes equivalent comma, leading zero, and decimal formatting without losing precision", () => {
    expect(ground("Acme hired 1,200 people and grew 1.40%", [source("Acme hired 1200 people and grew 1.4%") as any]).missingFigures).toEqual([]);
    expect(ground("Acme reported 9007199254740993", [source("Acme reported 9007199254740992") as any]).missingFigures).toEqual(["9007199254740993"]);
  });
});
