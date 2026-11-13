/**
 * The trust layer. The model PROPOSES claims with citations; this code DECIDES
 * what is verified. Nothing the model says is accepted on its word:
 *  - citations must point at sources we actually retrieved (else the claim is dropped)
 *  - every figure in a claim (amounts, %, counts) must appear in the cited source text
 *  - key terms must be grounded in the cited text (lexical support score)
 *  - "verified" needs 2+ independent outlets OR a primary source (official site / press wire)
 *  - undated sources, single-source reports and hedged language stay "uncertain"
 */
import type { Category, Claim, Source } from "../../../shared/briefing/schema";
import { CATEGORIES } from "../../../shared/briefing/schema";
import { rootDomain } from "./sources";

export interface ProposedClaim {
  text: string;
  category?: string | undefined;
  date?: string | null | undefined;
  sourceIds?: string[] | undefined;
  hedged?: boolean | undefined;
}

const STOP = new Set(
  "about after also among announced around because been before being between both company could during each from have having into itself just like made more most much must news only other over said says same should since some such than that their them then there these they this those through under until very week were what when where which while with would year years today report reported according".split(
    " ",
  ),
);

function norm(s: string): string {
  return s.toLowerCase().replace(/[’']/g, "'");
}

export function sourceText(srcs: Source[]): string {
  return norm(srcs.map((s) => `${s.title} ${s.snippet} ${s.content ?? ""}`).join(" \n "));
}

/** Figures like $120M, 1.4 billion, 500, 30% -> their digit core ("120", "1.4", "500", "30"). */
export function extractFigures(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const core = m[0].replace(/,/g, "");
    // Ignore years and day-of-month style numbers; dates are checked separately.
    if (/^(19|20)\d{2}$/.test(core)) continue;
    if (core.length <= 1 && !/%|\$|million|billion/i.test(text.slice(m.index ?? 0, (m.index ?? 0) + 12))) continue;
    out.add(core);
  }
  return [...out];
}

function figureInText(fig: string, text: string): boolean {
  if (text.includes(fig)) return true;
  const withCommas = Number(fig).toLocaleString("en-US");
  return text.includes(withCommas);
}

export function keyTerms(text: string): string[] {
  return [
    ...new Set(
      norm(text)
        .replace(/[^a-z0-9$%.' -]/g, " ")
        .split(/\s+/)
        .map((w) => w.replace(/^[.'-]+|[.'-]+$/g, ""))
        .filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d/.test(w)),
    ),
  ];
}

export interface Grounding {
  score: number;
  missingFigures: string[];
}

export function ground(text: string, cited: Source[]): Grounding {
  const st = sourceText(cited);
  const terms = keyTerms(text);
  const hit = terms.filter((t) => st.includes(t) || (t.endsWith("s") && st.includes(t.slice(0, -1)))).length;
  const score = terms.length ? hit / terms.length : 0;
  const missingFigures = extractFigures(text).filter((f) => !figureInText(f, st));
  return { score: Math.round(score * 100) / 100, missingFigures };
}

const HEDGES = /\b(reportedly|rumou?r|sources say|chatter|may be|might|could be|expected to|considering|exploring|weighing|unconfirmed|allegedly)\b/i;

function toCategory(c: string | undefined): Category {
  return (CATEGORIES as readonly string[]).includes(c ?? "") ? (c as Category) : "news";
}

export interface VerifyOutcome {
  claim: Claim | null;
  droppedReason?: string;
}

export function verifyClaim(p: ProposedClaim, idx: number, byId: Map<string, Source>): VerifyOutcome {
  const text = (p.text ?? "").trim();
  if (!text) return { claim: null, droppedReason: "empty claim" };
  const ids = [...new Set((p.sourceIds ?? []).map((s) => String(s).trim().toUpperCase()))].filter((id) => byId.has(id));
  if (!ids.length) return { claim: null, droppedReason: `no valid citation for: "${text.slice(0, 80)}"` };
  const cited = ids.map((id) => byId.get(id)!);
  const g = ground(text, cited);
  const outlets = new Set(cited.map((s) => rootDomain(s.domain))).size;
  const primary = cited.some((s) => s.isPrimary);
  const dated = cited.some((s) => !!s.publishedAt);
  const hedged = !!p.hedged || HEDGES.test(text) || cited.every((s) => HEDGES.test(`${s.title} ${s.snippet}`));

  const reasons: string[] = [];
  if (g.missingFigures.length) reasons.push(`figure(s) ${g.missingFigures.join(", ")} not found in cited sources`);
  if (g.score < 0.5) reasons.push(`weak support in source text (${Math.round(g.score * 100)}%)`);
  if (!dated) reasons.push("source has no publication date");
  if (hedged) reasons.push("reported as rumour / unconfirmed");
  if (outlets < 2 && !primary) reasons.push("single secondary source");

  const verified = reasons.length === 0;
  const date =
    (p.date && !Number.isNaN(new Date(p.date).getTime()) ? new Date(p.date).toISOString() : null) ??
    cited
      .map((s) => s.publishedAt)
      .filter((d): d is string => !!d)
      .sort()[0] ??
    null;

  return {
    claim: {
      id: `C${idx + 1}`,
      text,
      category: toCategory(p.category),
      date,
      sourceIds: ids,
      confidence: verified ? "verified" : "uncertain",
      confidenceReason: verified
        ? primary
          ? `primary source${outlets > 1 ? ` + ${outlets} outlets` : ""}`
          : `${outlets} independent outlets`
        : reasons.join("; "),
      grounding: g.score,
    },
  };
}
