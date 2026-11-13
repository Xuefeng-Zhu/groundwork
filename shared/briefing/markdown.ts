import {
  CATEGORY_LABELS,
  PURPOSE_LABELS,
  type Briefing,
  type Claim,
} from "./schema";

function cite(ids: string[], briefing: Briefing): string {
  if (!ids.length) return "";
  const parts = ids.map((id) => {
    const src = briefing.sources.find((s) => s.id === id);
    return src ? `[${id}](${src.url})` : `[${id}]`;
  });
  return ` ${parts.join(" ")}`;
}

export function formatDay(iso: string | null | undefined): string {
  if (!iso) return "undated";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "undated";
  return d.toISOString().slice(0, 10);
}

function claimLine(c: Claim, b: Briefing): string {
  const tag = c.confidence === "verified" ? "✅" : "⚠️";
  return `- ${tag} **${formatDay(c.date)}** · _${CATEGORY_LABELS[c.category]}_ — ${c.text}${cite(c.sourceIds, b)}`;
}

/** Render a briefing as portable one-page Markdown with inline citations. */
export function briefingToMarkdown(b: Briefing): string {
  const r = b.request;
  const lines: string[] = [];
  lines.push(`# ${b.title}`);
  lines.push("");
  lines.push(
    `**Meeting:** ${new Date(r.meetingAt).toUTCString()} · **Type:** ${PURPOSE_LABELS[r.purpose]} · **Target:** ${r.target} (${r.targetType}${r.organization ? `, ${r.organization}` : ""})`,
  );
  lines.push(
    `**Research window:** ${formatDay(b.window.start)} → ${formatDay(b.window.end)} · **Sources reviewed:** ${b.stats.sourcesReviewed} · **Engine:** ${b.engine.search} + ${b.engine.llm}${b.engine.model ? ` (${b.engine.model})` : ""}`,
  );
  if (b.demoData) {
    lines.push("");
    lines.push("> ⚠️ DEMO MODE — fictional fixture data, not real news about this target.");
  }
  lines.push("");
  lines.push("## TL;DR");
  if (!b.tldr.length) lines.push("- No material developments found in the window.");
  for (const t of b.tldr) lines.push(`- ${t.text}${cite(t.sourceIds, b)}`);
  lines.push("");
  lines.push("## Key developments (verified)");
  if (!b.keyDevelopments.length) lines.push("- None verified in the window.");
  for (const c of b.keyDevelopments) lines.push(claimLine(c, b));
  lines.push("");
  lines.push("## People & org changes");
  if (!b.peopleChanges.length) lines.push("- None found in the window.");
  for (const c of b.peopleChanges) lines.push(claimLine(c, b));
  lines.push("");
  lines.push("## Talking points");
  for (const t of b.talkingPoints) lines.push(`- ${t.text}${cite(t.sourceIds, b)}`);
  lines.push("");
  lines.push("## Open questions");
  for (const q of b.openQuestions)
    lines.push(`- ${q.text}${q.why ? ` _(${q.why})_` : ""}${cite(q.sourceIds, b)}`);
  lines.push("");
  lines.push("## Uncertain / unverified — confirm before relying on these");
  if (!b.uncertain.length) lines.push("- Nothing flagged.");
  for (const c of b.uncertain)
    lines.push(`${claimLine(c, b)} — _${c.confidenceReason}_`);
  lines.push("");
  lines.push("## Sources");
  for (const s of b.sources)
    lines.push(
      `- **[${s.id}]** [${s.title}](${s.url}) — ${s.domain}, ${formatDay(s.publishedAt)}${s.isPrimary ? " · primary source" : ""}`,
    );
  if (b.warnings.length) {
    lines.push("");
    lines.push("## Notes");
    for (const w of b.warnings) lines.push(`- ${w}`);
  }
  lines.push("");
  lines.push(
    `_Generated ${b.generatedAt} by Meeting Brief Agent. ✅ = verified (2+ independent sources or a primary source, key terms found in source text). ⚠️ = single secondary source, undated, or not fully supported by source text._`,
  );
  return lines.join("\n");
}
