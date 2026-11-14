import { formatDay } from "./markdown";
import { CATEGORY_LABELS, PURPOSE_LABELS, type Briefing, type Claim } from "./schema";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Standalone, print-optimised HTML that fits a briefing on one Letter/A4 page. */
export function briefingToPrintHtml(b: Briefing): string {
  const urls = new Map(b.sources.map((s) => [s.id, s.url]));
  const cite = (ids: string[]) =>
    ids.map((id) => `<a class="c" href="${esc(urls.get(id) ?? "#")}">${id}</a>`).join("");
  const claim = (c: Claim, reason = false) =>
    `<li><span class="m">${c.confidence === "verified" ? "✓" : "⚠"} ${formatDay(c.date)} · ${CATEGORY_LABELS[c.category]}</span> ${esc(c.text)}${cite(c.sourceIds)}${reason ? `<div class="r">${esc(c.confidenceReason)}</div>` : ""}</li>`;
  const list = (items: string[], empty: string) => (items.length ? items.join("") : `<li class="e">${empty}</li>`);
  const r = b.request;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(b.title)}</title><style>
@page{size:auto;margin:9mm}
*{box-sizing:border-box}body{font:8.6pt/1.32 -apple-system,Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#111;margin:0}
h1{font-size:14pt;margin:0}.sub{color:#555;font-size:8pt;margin:2px 0 6px}
.demo{background:#fff4d6;border:1px solid #f0c36d;padding:2px 6px;border-radius:4px;font-size:7.6pt;margin-bottom:6px}
h2{font-size:7.4pt;letter-spacing:.08em;text-transform:uppercase;color:#666;margin:7px 0 3px;border-bottom:1px solid #e5e5e5;padding-bottom:1px}
ul,ol{margin:0;padding-left:13px}li{margin:1px 0}.tl li{font-weight:600}
.g{display:grid;grid-template-columns:1fr 1fr;column-gap:14px}
.m{font:7pt ui-monospace,Menlo,monospace;color:#666}.c{font-size:6.6pt;background:#eee;color:#333;border-radius:3px;padding:0 2px;margin-left:2px;text-decoration:none}
.r{font-style:italic;color:#8a5a00;font-size:7.2pt}.e{color:#888;list-style:none;margin-left:-13px}
.u{background:#fffbea;border:1px solid #f3dc96;border-radius:4px;padding:2px 6px 4px}
.src{columns:2;column-gap:14px;font-size:7pt;color:#333}.src li{break-inside:avoid}.src a{color:#111}
.f{color:#777;font-size:6.6pt;margin-top:5px}
</style></head><body>
<h1>${esc(r.target)} — pre-meeting brief</h1>
<div class="sub">${esc(PURPOSE_LABELS[r.purpose])} · ${esc(new Date(r.meetingAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }))} · window ${formatDay(b.window.start)} → ${formatDay(b.window.end)} · ${b.stats.sourcesReviewed} sources reviewed · ${b.stats.claimsVerified} verified / ${b.stats.claimsUncertain} uncertain · ${esc(b.engine.search)} + ${esc(b.engine.llm)}${b.engine.model ? ` (${esc(b.engine.model)})` : ""}</div>
${b.demoData ? `<div class="demo">DEMO MODE — fictional fixture data on .example domains, not real news about “${esc(r.target)}”.</div>` : ""}
<h2>TL;DR</h2><ul class="tl">${list(b.tldr.map((t) => `<li>${esc(t.text)}${cite(t.sourceIds)}</li>`), "No material, verifiable developments in the window.")}</ul>
<div class="g"><div><h2>Key developments · verified</h2><ul>${list(b.keyDevelopments.map((c) => claim(c)), "None verified.")}</ul></div>
<div><h2>People &amp; org changes</h2><ul>${list(b.peopleChanges.map((c) => claim(c)), "None verified in the window.")}</ul></div>
<div><h2>Talking points</h2><ul>${list(b.talkingPoints.map((t) => `<li>${esc(t.text)}${cite(t.sourceIds)}</li>`), "—")}</ul></div>
<div><h2>Open questions</h2><ul>${list(b.openQuestions.map((q) => `<li>${esc(q.text)}${q.why ? ` <span class="m">(${esc(q.why)})</span>` : ""}${cite(q.sourceIds)}</li>`), "—")}</ul></div></div>
<h2>Uncertain / unverified — confirm before relying on these</h2><div class="u"><ul>${list(b.uncertain.map((c) => claim(c, true)), "Nothing flagged.")}</ul></div>
<h2>Sources</h2><ol class="src">${b.sources.map((s) => `<li><b>[${s.id}]</b> <a href="${esc(s.url)}">${esc(s.title)}</a> — ${esc(s.domain)}, ${formatDay(s.publishedAt)}${s.isPrimary ? ", primary" : ""}</li>`).join("")}</ol>
<div class="f">✓ verified = 2+ independent outlets or a primary source, with every figure and key term found in the cited text. ⚠ = single secondary source, hedged, undated, or not fully supported. Generated ${esc(new Date(b.generatedAt).toLocaleString())} by Groundwork.</div>
</body></html>`;
}
