/**
 * The trust layer. The model PROPOSES claims with citations; this code DECIDES
 * what is verified. Nothing the model says is accepted on its word:
 *  - citations must point at sources we actually retrieved (else the claim is dropped)
 *  - every figure in a claim (amounts, %, counts) must appear in the cited source text
 *  - key terms must be grounded in the cited text (lexical support score)
 *  - "verified" needs 2+ independent outlets OR a primary source (official site / press wire)
 *  - undated sources, single-source reports and hedged language stay "uncertain"
 *  - EACH citation is checked on its own (citation-drift guard): the source must be about
 *    the target AND share the claim's key entities/figures. Off-topic citations are removed;
 *    if nothing supporting remains the item is downgraded to uncertain (or dropped).
 */
import type { BriefingRequest, Category, Claim, Source } from "../../../shared/briefing/schema";
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
  // Dates (2026-11-07, Nov 7 2026) are checked separately against the source date, not as figures.
  text = text
    .replace(/\b(19|20)\d{2}-\d{1,2}-\d{1,2}\b/g, " ")
    .replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/gi, " ");
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

// ------------------------------------------------------ citation-drift guard

/** Who the brief is about, as the verifier needs it. */
export interface TargetRef {
  target: string;
  targetType?: "company" | "person" | undefined;
  organization?: string | undefined;
  officialDomain?: string | undefined;
}

export function targetRef(req: BriefingRequest): TargetRef {
  return { target: req.target, targetType: req.targetType, organization: req.organization, officialDomain: req.officialDomain };
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function bareDomain(d: string): string {
  return d.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]!.toLowerCase();
}

/** Names that identify the target in text (target, a person's surname, their organisation). */
export function targetNames(t: TargetRef): string[] {
  const names = new Set<string>();
  const add = (n?: string) => {
    const v = norm(n ?? "").trim();
    if (v.length >= 2) names.add(v);
  };
  add(t.target);
  // "Snowflake Inc." / "Stripe, Inc." -> also accept the bare brand
  add(t.target.replace(/[,.]?\s+(inc|corp|corporation|ltd|llc|plc|co|company|technologies|labs|ai)\.?$/i, ""));
  if (t.targetType === "person") {
    const parts = t.target.trim().split(/\s+/);
    if (parts.length > 1 && parts[parts.length - 1]!.length >= 4) add(parts[parts.length - 1]);
    add(t.organization);
  }
  return [...names];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^$|()[\]{}\\]/g, "\\$&");
}

/** Is this source actually about the target? (name in title/url/content, or the official domain) */
export function isAboutTarget(s: Source, t: TargetRef): boolean {
  const dom = s.domain.toLowerCase();
  if (t.officialDomain) {
    const od = bareDomain(t.officialDomain);
    if (od && (dom === od || dom.endsWith(`.${od}`))) return true;
  }
  const hay = norm(`${s.title} ${s.url} ${s.snippet} ${s.content ?? ""}`);
  const urlSlug = slug(s.url);
  for (const n of targetNames(t)) {
    const re = new RegExp(`(^|[^a-z0-9])${escapeRe(n)}($|[^a-z0-9])`);
    if (re.test(hay)) return true;
    const ns = slug(n);
    if (ns.length >= 4 && urlSlug.includes(ns)) return true;
  }
  return false;
}

const NOT_ENTITY = new Set(
  "the a an and or but on in at of for to by with from as its it this that these those new its their his her our we they he she is are was were will has have had per after before over under into about q1 q2 q3 q4 ai ceo cfo cto coo cro cpo vp us usd inc corp co ltd llc according monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec".split(
    " ",
  ),
);

/** Proper-noun-ish entities in a claim (capitalised words / acronyms), minus the target's own name. */
export function claimEntities(text: string, t?: TargetRef): string[] {
  const own = new Set((t ? targetNames(t) : []).flatMap((n) => n.split(/\s+/)));
  const out = new Set<string>();
  for (const m of text.matchAll(/\b[A-Z][A-Za-z0-9&'’.-]*[A-Za-z0-9]|\b[A-Z]\b/g)) {
    const w = norm(m[0]).replace(/'s$/, "");
    if (w.length < 2 || NOT_ENTITY.has(w) || own.has(w)) continue;
    out.add(w);
  }
  return [...out];
}

export interface CitationCheck {
  id: string;
  about: boolean;
  /** share of the claim's key terms found in THIS source alone */
  score: number;
  sharedEntities: string[];
  sharedFigures: string[];
  supports: boolean;
  reason?: string | undefined;
}

/** Judge one citation on its own: on-topic, and shares the claim's entities/figures. */
export function checkCitation(text: string, s: Source, t: TargetRef | undefined, minScore = 0.25): CitationCheck {
  const about = t ? isAboutTarget(s, t) : true;
  const st = sourceText([s]);
  const terms = keyTerms(text);
  const hit = terms.filter((w) => st.includes(w) || (w.endsWith("s") && st.includes(w.slice(0, -1)))).length;
  const score = terms.length ? hit / terms.length : 0;
  const ents = claimEntities(text, t);
  const figs = extractFigures(text);
  const sharedEntities = ents.filter((e) => st.includes(e));
  const sharedFigures = figs.filter((f) => figureInText(f, st));
  const hasSignals = ents.length + figs.length > 0;
  const signalOk = !hasSignals || sharedEntities.length + sharedFigures.length > 0;
  let reason: string | undefined;
  if (!about) reason = "source is not about the target";
  else if (!signalOk) reason = "source shares none of the claim's names or figures";
  else if (score < minScore) reason = `source barely overlaps the claim (${Math.round(score * 100)}%)`;
  return { id: s.id, about, score: Math.round(score * 100) / 100, sharedEntities, sharedFigures, supports: !reason, reason };
}

export interface CitationFilter {
  /** citations that survived */
  kept: string[];
  /** citations removed, with why */
  removed: Array<{ id: string; reason: string }>;
  /** ids of cited sources that are at least about the target */
  onTopic: string[];
}

/**
 * Per-citation filter. `llmUnsupported` holds ids an optional LLM judge said do not
 * support the text; they are removed too.
 */
export function filterCitations(
  text: string,
  ids: string[],
  byId: Map<string, Source>,
  t: TargetRef | undefined,
  llmUnsupported?: Set<string> | undefined,
): CitationFilter {
  const kept: string[] = [];
  const removed: CitationFilter["removed"] = [];
  const onTopic: string[] = [];
  for (const id of ids) {
    const s = byId.get(id);
    if (!s) continue;
    const c = checkCitation(text, s, t);
    if (c.about) onTopic.push(id);
    if (!c.supports) removed.push({ id, reason: c.reason ?? "unsupported" });
    else if (llmUnsupported?.has(id)) removed.push({ id, reason: "LLM support check: source does not support the claim" });
    else kept.push(id);
  }
  return { kept, removed, onTopic };
}

export interface VerifyOutcome {
  claim: Claim | null;
  droppedReason?: string;
  /** citations the drift guard rejected (removed, or kept only as reference on a downgraded claim) */
  removedCitations?: Array<{ id: string; reason: string }>;
  /** true when no citation supported the claim and it was downgraded to uncertain */
  downgraded?: boolean;
}

export function verifyClaim(
  p: ProposedClaim,
  idx: number,
  byId: Map<string, Source>,
  t?: TargetRef | undefined,
  llmUnsupported?: Set<string> | undefined,
): VerifyOutcome {
  const text = (p.text ?? "").trim();
  if (!text) return { claim: null, droppedReason: "empty claim" };
  const validIds = [...new Set((p.sourceIds ?? []).map((s) => String(s).trim().toUpperCase()))].filter((id) => byId.has(id));
  if (!validIds.length) return { claim: null, droppedReason: `no valid citation for: "${text.slice(0, 80)}"` };
  const f = filterCitations(text, validIds, byId, t, llmUnsupported);
  let ids = f.kept;
  let unsupported = false;
  if (!ids.length) {
    // Nothing actually supports it. Keep on-topic citations so the reader can check, but never verify.
    if (!f.onTopic.length)
      return {
        claim: null,
        droppedReason: `only off-topic citations (${validIds.join(", ")}) for: "${text.slice(0, 80)}"`,
        removedCitations: f.removed,
      };
    ids = f.onTopic;
    unsupported = true;
  }
  const cited = ids.map((id) => byId.get(id)!);
  const g = ground(text, cited);
  const outlets = new Set(cited.map((s) => rootDomain(s.domain))).size;
  const primary = cited.some((s) => s.isPrimary);
  const dated = cited.some((s) => !!s.publishedAt);
  const hedged = !!p.hedged || HEDGES.test(text) || cited.every((s) => HEDGES.test(`${s.title} ${s.snippet}`));

  const reasons: string[] = [];
  if (unsupported) reasons.push(`no cited source clearly supports this (${f.removed.map((r) => `${r.id}: ${r.reason}`).join("; ")})`);
  if (g.missingFigures.length) reasons.push(`figure(s) ${g.missingFigures.join(", ")} not found in cited sources`);
  if (g.score < 0.5) reasons.push(`weak support in source text (${Math.round(g.score * 100)}%)`);
  if (!dated) reasons.push("source has no publication date");
  if (cited.every((s) => s.origin === "background")) reasons.push("background source only (outside the research window)");
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
    removedCitations: f.removed,
    downgraded: unsupported,
  };
}
