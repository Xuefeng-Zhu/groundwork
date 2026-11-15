/**
 * Heuristic screening for model-proposed claims and citations. A verified label
 * indicates the checks passed; lexical overlap cannot prove semantic support.
 * Sources must be relevant, figures must match whole numeric tokens, and a
 * proposed event date must appear in cited text. Dated, non-background sources
 * must include a primary source or distinct coverage; obvious copied headlines
 * and snippets are not counted twice. Inspect sources before relying on claims.
 */
import type { BriefingRequest, Category, Claim, Source } from "../../../shared/briefing/schema";
import { CATEGORIES } from "../../../shared/briefing/schema";
import { coverageCount } from "./independent";

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

/** Normalize numeric formatting without converting to Number (and losing precision). */
function normalizeFigure(figure: string): string {
  const [integer = "0", fraction = ""] = figure.replace(/,/g, "").split(".");
  const whole = integer.replace(/^0+(?=\d)/, "");
  const decimal = fraction.replace(/0+$/, "");
  return decimal ? `${whole}.${decimal}` : whole;
}

/**
 * Extract complete numeric tokens, including single digits and years. Date components
 * are retained too: omitting them could let a claim introduce an unsupported date.
 * This is a lexical screen, not a semantic comparison of quantities or dates.
 */
export function extractFigures(text: string): string[] {
  return [...new Set([...text.matchAll(/\d+(?:,\d{3})*(?:\.\d+)?/g)].map((m) => normalizeFigure(m[0])))];
}

function figureInText(fig: string, text: string): boolean {
  return extractFigures(text).includes(normalizeFigure(fig));
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

/**
 * Extract the civil date the model supplied, without shifting it through UTC.
 * Reject invalid calendar dates (Date.parse otherwise normalizes e.g. Feb 30).
 */
function proposedDay(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(value.trim());
  if (!m) return null;
  const day = `${m[1]}-${m[2]}-${m[3]}`;
  const parsed = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) return null;
  // If a timestamp was provided, it must also be a valid ISO timestamp.
  if (value.trim().length > 10 && Number.isNaN(new Date(value).getTime())) return null;
  return day;
}

/** A publication timestamp by itself does not establish when the event happened. */
function sourceMentionsDay(day: string, cited: Source[]): boolean {
  const [year, month, date] = day.split("-");
  const monthName = ["jan(?:uary)?", "feb(?:ruary)?", "mar(?:ch)?", "apr(?:il)?", "may", "jun(?:e)?", "jul(?:y)?", "aug(?:ust)?", "sep(?:t(?:ember)?)?", "oct(?:ober)?", "nov(?:ember)?", "dec(?:ember)?"][Number(month) - 1]!;
  const d = `0?${Number(date)}(?:st|nd|rd|th)?`;
  const patterns = [
    new RegExp(`(?:^|[^0-9])${year}-0?${Number(month)}-0?${Number(date)}(?![0-9])`, "i"),
    new RegExp(`\\b${monthName}\\.?\\s+${d},?\\s+${year}(?![0-9])`, "i"),
    new RegExp(`(?:^|[^0-9])${d}\\s+${monthName}\\.?[,]?\\s+${year}(?![0-9])`, "i"),
  ];
  return cited.some((s) => patterns.some((pattern) => pattern.test(`${s.title} ${s.snippet} ${s.content ?? ""}`)));
}

/** Find complete, unambiguous dates written in the claim itself. */
function claimDays(text: string): Array<string | null> {
  const days: Array<string | null> = [];
  for (const m of text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)) days.push(proposedDay(m[0]));
  const months = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");
  const names = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
  const patterns = [
    new RegExp(`\\b(${names})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "gi"),
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${names})\\.?[,]?\\s+(\\d{4})\\b`, "gi"),
  ];
  for (const [index, pattern] of patterns.entries()) {
    for (const m of text.matchAll(pattern)) {
      const month = months.indexOf(m[index === 0 ? 1 : 2]!.slice(0, 3).toLowerCase()) + 1;
      const day = Number(m[index === 0 ? 2 : 1]);
      days.push(proposedDay(`${m[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`));
    }
  }
  return days;
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
  // Undated and out-of-window background references may provide context, but
  // cannot turn a single recent secondary report into a verified claim.
  const eligible = cited.filter((s) => s.origin !== "background" && !!s.publishedAt && !Number.isNaN(new Date(s.publishedAt).getTime()));
  const outlets = coverageCount(eligible);
  const primary = eligible.some((s) => s.isPrimary);
  const dated = cited.some((s) => !!s.publishedAt && !Number.isNaN(new Date(s.publishedAt).getTime()));
  const hedged = !!p.hedged || HEDGES.test(text) || cited.every((s) => HEDGES.test(`${s.title} ${s.snippet}`));
  // Model JSON is not trusted to respect the TypeScript type.
  const suppliedDate = typeof p.date === "string" ? p.date.trim() : p.date == null ? "" : "invalid";
  const day = suppliedDate ? proposedDay(suppliedDate) : null;
  const dateSupported = day ? sourceMentionsDay(day, cited) : false;

  const reasons: string[] = [];
  if (unsupported) reasons.push(`no cited source clearly supports this (${f.removed.map((r) => `${r.id}: ${r.reason}`).join("; ")})`);
  if (g.missingFigures.length) reasons.push(`figure(s) ${g.missingFigures.join(", ")} not found in cited sources`);
  if (g.score < 0.5) reasons.push(`weak support in source text (${Math.round(g.score * 100)}%)`);
  if (!dated) reasons.push("source has no publication date");
  if (suppliedDate && !day) reasons.push("claim date is invalid");
  else if (day && !dateSupported) reasons.push(`claim date ${day} is not found in cited source text`);
  for (const mentionedDay of new Set(claimDays(text))) {
    if (!mentionedDay) reasons.push("date in claim text is invalid");
    else if (!sourceMentionsDay(mentionedDay, cited) && !(mentionedDay === day && !dateSupported))
      reasons.push(`date ${mentionedDay} in claim text is not found in cited source text`);
  }
  if (cited.every((s) => s.origin === "background")) reasons.push("background source only (outside the research window)");
  if (hedged) reasons.push("reported as rumour / unconfirmed");
  if (outlets < 2 && !primary) reasons.push(outlets === 0 ? "no dated non-background source" : "single secondary source");

  const verified = reasons.length === 0;
  const date = day && dateSupported ? `${day}T00:00:00.000Z` : null;

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
          : `${outlets} distinct sources of coverage`
        : reasons.join("; "),
      grounding: g.score,
    },
    removedCitations: f.removed,
    downgraded: unsupported,
  };
}
