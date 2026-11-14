/**
 * Evaluation runner: real pipeline on one company per invocation (keeps each run short and
 * friendly to free-tier rate limits), appending a row to docs/eval/results.jsonl and saving
 * the full brief as docs/eval/<slug>[-tag].json/.md.
 *
 *   MOCK=0 ... pnpm exec tsx scripts/eval-briefs.ts "Stripe" stripe.com [tag]
 *   pnpm exec tsx scripts/eval-briefs.ts --table      # rebuild docs/eval/results.md from the jsonl
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { briefingToMarkdown } from "../shared/briefing/markdown";
import { generateBriefing } from "../server/lib/briefing/pipeline";

const DIR = "docs/eval";
const MEETING = process.env.EVAL_MEETING ?? "2026-11-20T15:00:00-08:00";
mkdirSync(DIR, { recursive: true });

interface Row {
  target: string;
  domain: string;
  tag: string;
  meetingAt: string;
  sourcesFound: number;
  cited: number;
  verified: number;
  uncertain: number;
  droppedClaims: number;
  citationsRemoved: number;
  sitePages: number;
  tavilyCredits: number;
  seconds: number;
  model: string;
  verifyLlm: boolean;
  runAt: string;
}

function table(rows: Row[]): string {
  const h =
    "| Company | Sources found | Cited | Verified | Uncertain | Dropped claims | Citations removed | Newsroom pages (Map) | Tavily credits | Seconds | Model that served |\n" +
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |\n";
  return (
    h +
    rows
      .map(
        (r) =>
          `| ${r.target}${r.tag ? ` (${r.tag})` : ""} | ${r.sourcesFound} | ${r.cited} | ${r.verified} | ${r.uncertain} | ${r.droppedClaims} | ${r.citationsRemoved} | ${r.sitePages} | ${r.tavilyCredits} | ${r.seconds} | ${r.model}${r.verifyLlm ? " + LLM check" : ""} |`,
      )
      .join("\n")
  );
}

const args = process.argv.slice(2);
if (args[0] === "--table") {
  const rows = existsSync(`${DIR}/results.jsonl`)
    ? readFileSync(`${DIR}/results.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Row)
    : [];
  const md = `# Groundwork evaluation\n\nMeeting: ${MEETING} (sales call), 30-day window. Raw briefs: \`docs/eval/<company>.json\` / \`.md\`.\n\n${table(rows)}\n`;
  writeFileSync(`${DIR}/results.md`, md);
  console.log(md);
} else {
  const [target, domain, tag = ""] = args;
  if (!target || !domain) throw new Error("usage: eval-briefs.ts <target> <domain> [tag]");
  const t0 = Date.now();
  const b = await generateBriefing({ target, targetType: "company", meetingAt: MEETING, purpose: "sales", officialDomain: domain });
  const seconds = Math.round((Date.now() - t0) / 100) / 10;
  const slug = `${target.toLowerCase().replace(/[^a-z0-9]+/g, "-")}${tag ? `-${tag}` : ""}`;
  writeFileSync(`${DIR}/${slug}.json`, JSON.stringify(b, null, 2));
  writeFileSync(`${DIR}/${slug}.md`, briefingToMarkdown(b));
  const row: Row = {
    target,
    domain,
    tag,
    meetingAt: MEETING,
    sourcesFound: b.stats.sourcesReviewed,
    cited: b.stats.sourcesCited,
    verified: b.stats.claimsVerified,
    uncertain: b.stats.claimsUncertain,
    droppedClaims: b.stats.claimsDropped,
    citationsRemoved: b.stats.citationsRemoved ?? 0,
    sitePages: b.stats.sitePages ?? 0,
    tavilyCredits: b.stats.tavilyCredits ?? 0,
    seconds,
    model: b.engine.model ?? b.engine.llm,
    verifyLlm: /LLM support check by/.test(b.warnings.join(" ")),
    runAt: new Date().toISOString(),
  };
  appendFileSync(`${DIR}/results.jsonl`, `${JSON.stringify(row)}\n`);
  console.log(JSON.stringify(row));
  for (const w of b.warnings) if (!w.startsWith("Dropped") && !w.startsWith("Citation removed")) console.log(`  note: ${w.slice(0, 200)}`);
}
