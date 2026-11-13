/**
 * CLI smoke test for the pipeline, no server needed.
 *   MOCK=1 pnpm exec tsx scripts/demo-briefing.ts "Northwind Robotics" company 2026-11-20T15:00:00-08:00 sales
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { briefingToMarkdown } from "../shared/briefing/markdown";
import { generateBriefing } from "../server/lib/briefing/pipeline";

const [target = "Northwind Robotics", targetType = "company", meetingAt = new Date(Date.now() + 2 * 86400000).toISOString(), purpose = "sales"] =
  process.argv.slice(2);

const b = await generateBriefing({ target, targetType: targetType as "company" | "person", meetingAt, purpose: purpose as "sales" });
const md = briefingToMarkdown(b);
mkdirSync("out", { recursive: true });
writeFileSync("out/briefing.json", JSON.stringify(b, null, 2));
writeFileSync("out/briefing.md", md);
console.log(md);
console.error(`\n[stats] ${JSON.stringify(b.stats)} engine=${JSON.stringify(b.engine)}`);
