/**
 * Synthesis: sources -> draft (via LLM, mock, or heuristic) -> verified briefing sections.
 * All three drafters emit the same `Draft` shape so they share one verification path.
 */
import {
  PURPOSE_LABELS,
  type BriefingRequest,
  type Category,
  type Claim,
  type CitedText,
  type DateWindow,
  type Source,
} from "../../../shared/briefing/schema";
import { fixtureKey } from "./fixtures";
import { titleTokens } from "./sources";
import { ground, verifyClaim, type ProposedClaim } from "./verify";

export interface Draft {
  tldr: Array<{ text: string; sourceIds?: string[] | undefined }>;
  claims: ProposedClaim[];
  talkingPoints: Array<{ text: string; sourceIds?: string[] | undefined }>;
  openQuestions: Array<{ text: string; why?: string | undefined; sourceIds?: string[] | undefined }>;
}

// ---------------------------------------------------------------- LLM prompt

export function buildMessages(req: BriefingRequest, window: DateWindow, sources: Source[], sourceChars = 1400) {
  const sys = `You are a meticulous pre-meeting research analyst. You write one-page briefings that busy people read in 2 minutes.
HARD RULES:
- Use ONLY the numbered sources provided. Never use outside knowledge. Never invent names, numbers, dates or events.
- Every claim and TL;DR bullet MUST cite 1+ source ids like "S3" that directly support it.
- Copy figures (amounts, percentages, counts) exactly as they appear in the source text.
- Only include developments dated inside the research window. Skip evergreen/background pages.
- If a source uses hedged language (reportedly, sources say, expected to, exploring), set "hedged": true and keep the hedge in the text.
- Merge duplicate coverage of the same event into one claim citing all its sources.
- Keep each claim to one sentence (<= 30 words). Be specific: who, what, when.
- Talking points and open questions are suggestions tailored to the meeting purpose; cite the sources that motivate them.
Return ONLY a JSON object with this exact shape:
{"tldr":[{"text":string,"sourceIds":[string]}],
 "claims":[{"text":string,"category":"news"|"product"|"people"|"funding"|"partnerships"|"financials"|"person"|"risk","date":"YYYY-MM-DD"|null,"sourceIds":[string],"hedged":boolean}],
 "talkingPoints":[{"text":string,"sourceIds":[string]}],
 "openQuestions":[{"text":string,"why":string,"sourceIds":[string]}]}
Limits: tldr 3 bullets, claims <= 12, talkingPoints <= 5, openQuestions <= 5.`;

  const meta = [
    `Target: ${req.target} (${req.targetType}${req.organization ? `, at ${req.organization}` : ""})`,
    `Meeting: ${req.meetingAt} — ${PURPOSE_LABELS[req.purpose]}`,
    `Research window: ${window.start.slice(0, 10)} to ${window.end.slice(0, 10)}`,
    req.context ? `Meeting context from the user: ${req.context}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const src = sources
    .map(
      (s) =>
        `[${s.id}] ${s.title}\nURL: ${s.url}\nOutlet: ${s.domain}${s.isPrimary ? " (PRIMARY/official)" : ""}\nPublished: ${s.publishedAt?.slice(0, 10) ?? "unknown"}\nText: ${(s.content || s.snippet).slice(0, sourceChars)}`,
    )
    .join("\n\n");

  return [
    { role: "system" as const, content: sys },
    { role: "user" as const, content: `${meta}\n\nSOURCES:\n\n${src}\n\nWrite the JSON briefing now.` },
  ];
}

// --------------------------------------------------------- heuristic drafter

const CAT_RULES: Array<[RegExp, Category]> = [
  [/\b(raises?|raised|funding|series [a-z]|valuation|acquir|ipo|invest)/i, "funding"],
  [/\b(appoint|names?|named|hires?|hired|joins?|promot|steps? down|resign|depart|ceo|cfo|cto|coo|cro|chief)\b/i, "people"],
  [/\b(launch|unveil|releases?|introduc|debut|general availability|rolls? out)/i, "product"],
  [/\b(partner|deal with|signs?|alliance|collaborat)/i, "partnerships"],
  [/\b(revenue|earnings|profit|quarter|guidance)/i, "financials"],
  [/\b(lawsuit|outage|layoff|breach|probe|fine|recall|sued)/i, "risk"],
];

function classify(s: Source): Category {
  for (const [re, c] of CAT_RULES) if (re.test(s.title)) return c;
  return s.categories[0] ?? "news";
}

function cleanTitle(t: string): string {
  return t.replace(/\s+[-|–—]\s+[^-|–—]{2,40}$/, "").trim();
}

/** No-LLM fallback: cluster near-duplicate headlines into events, cite each cluster. */
export function heuristicDraft(req: BriefingRequest, sources: Source[]): Draft {
  const clusters: Source[][] = [];
  for (const s of sources) {
    if (!s.publishedAt && /careers|jobs|about/i.test(s.url)) continue;
    const tk = titleTokens(s.title);
    const cat = classify(s);
    const home = clusters.find((c) => {
      if (classify(c[0]!) !== cat) return false;
      const ck = titleTokens(c[0]!.title);
      const inter = [...tk].filter((x) => ck.has(x)).length;
      return inter / Math.max(1, Math.min(tk.size, ck.size)) >= 0.4;
    });
    if (home) home.push(s);
    else clusters.push([s]);
  }
  const claims: ProposedClaim[] = clusters.slice(0, 12).map((c) => ({
    text: cleanTitle(c[0]!.title),
    category: classify(c[0]!),
    date: c.map((s) => s.publishedAt).filter(Boolean).sort()[0] ?? null,
    sourceIds: c.map((s) => s.id),
  }));
  const strong = [...clusters].sort((a, b) => b.length - a.length).slice(0, 3);
  return {
    tldr: strong.map((c) => ({ text: cleanTitle(c[0]!.title), sourceIds: c.map((s) => s.id) })),
    claims,
    talkingPoints: templatedTalkingPoints(req, claims),
    openQuestions: templatedQuestions(req, claims),
  };
}

function templatedTalkingPoints(req: BriefingRequest, claims: ProposedClaim[]) {
  const pick = (cat: Category) => claims.find((c) => c.category === cat);
  const out: Draft["talkingPoints"] = [];
  const f = pick("funding");
  if (f) out.push({ text: `Acknowledge the recent funding news and ask which priorities it accelerates.`, sourceIds: f.sourceIds });
  const p = pick("product");
  if (p) out.push({ text: `Reference the latest product launch and connect it to the ${PURPOSE_LABELS[req.purpose].toLowerCase()} agenda.`, sourceIds: p.sourceIds });
  const h = pick("people");
  if (h) out.push({ text: `Note the leadership change — confirm who now owns the decision you need.`, sourceIds: h.sourceIds });
  const pa = pick("partnerships");
  if (pa) out.push({ text: `Use the new partnership as a reference point for how they evaluate partners.`, sourceIds: pa.sourceIds });
  if (!out.length) out.push({ text: `Few public developments in the window — open with their priorities for the next quarter.` });
  return out.slice(0, 5);
}

function templatedQuestions(req: BriefingRequest, claims: ProposedClaim[]) {
  const out: Draft["openQuestions"] = [];
  const r = claims.find((c) => c.category === "risk");
  if (r) out.push({ text: `How has the recent issue affected customers, and what changed since?`, why: "risk signal in coverage", sourceIds: r.sourceIds });
  const byPurpose: Record<string, string> = {
    sales: "What would make this a priority this quarter, and who signs off?",
    partnership: "What does a successful partnership look like for them in 6 months?",
    investor: "What metrics are they tracking against the plan for this year?",
    bd: "Which segments or regions are they prioritising next?",
    hiring: "What does the team most need in the next 90 days?",
    general: "What are their top priorities for the next quarter?",
  };
  out.push({ text: byPurpose[req.purpose] ?? byPurpose.general!, why: "purpose-driven" });
  return out;
}

// -------------------------------------------------------------- mock drafter

/**
 * Deterministic stand-in for the LLM in MOCK mode. It writes what a good model
 * would, PLUS two deliberate mistakes (an invented figure and a bogus citation)
 * so the demo shows the verification layer catching them.
 */
export function mockDraft(req: BriefingRequest, sources: Source[]): Draft {
  const ids = (...keys: string[]) =>
    sources.filter((s) => keys.includes(fixtureKey(s.url) ?? "")).map((s) => s.id);
  const T = req.target.trim();
  if (req.targetType === "person") {
    const O = req.organization?.trim() || "Northwind Robotics";
    return {
      tldr: [
        { text: `${T} was promoted to Chief Product Officer at ${O}.`, sourceIds: ids("role-pr", "role-2") },
        { text: `${O} raised a $120 million Series C led by Meridian Ventures.`, sourceIds: ids("org-fund", "org-fund-2") },
        { text: `${T} is publicly pushing for open robotics interoperability standards.`, sourceIds: ids("talk-1", "talk-2") },
      ],
      claims: [
        { text: `${O} promoted ${T} from VP of Product to Chief Product Officer.`, category: "people", sourceIds: ids("role-pr", "role-2") },
        { text: `At RoboWorld Summit, ${T} called for open interoperability standards across robot vendors.`, category: "person", sourceIds: ids("talk-1", "talk-2") },
        { text: `${O} closed a $120 million Series C led by Meridian Ventures.`, category: "funding", sourceIds: ids("org-fund", "org-fund-2") },
        { text: `On a podcast, ${T} said warehouse automation is entering a "second wave" focused on software orchestration.`, category: "person", sourceIds: ids("pod") },
        { text: `${T} is reportedly weighing a board seat at a stealth robotics startup.`, category: "person", hedged: true, sourceIds: ids("board") },
        { text: `${T} grew the product team to 250 people this year.`, category: "people", sourceIds: ids("role-2") },
        { text: `${T} will keynote CES next January.`, category: "person", sourceIds: ["S99"] },
      ],
      talkingPoints: [
        { text: `Congratulate ${T} on the CPO promotion; ask what changes in product priorities come with it.`, sourceIds: ids("role-pr") },
        { text: `Tie your proposal to the open-standards stance from the RoboWorld keynote.`, sourceIds: ids("talk-1") },
        { text: `The fresh Series C likely means budget for new initiatives — ask about European expansion plans.`, sourceIds: ids("org-fund") },
      ],
      openQuestions: [
        { text: `Who now owns platform decisions previously under ${T}'s VP role?`, why: "role change", sourceIds: ids("role-pr") },
        { text: `Is the board-seat report accurate? (do not raise unless they do)`, why: "single unconfirmed report", sourceIds: ids("board") },
      ],
    };
  }
  return {
    tldr: [
      { text: `${T} raised a $120M Series C led by Meridian Ventures at a reported $1.4B valuation, to fund European expansion.`, sourceIds: ids("fund-1", "fund-2", "fund-pr") },
      { text: `It launched Atlas 2, an AI fleet orchestration platform, now generally available.`, sourceIds: ids("prod-pr", "prod-2") },
      { text: `New CRO Priya Raman signals a push into enterprise sales.`, sourceIds: ids("hire-1", "hire-2") },
    ],
    claims: [
      { text: `${T} raised $120 million in a Series C led by Meridian Ventures, valuing it at $1.4 billion.`, category: "funding", sourceIds: ids("fund-1", "fund-2", "fund-pr") },
      { text: `${T} launched Atlas 2, an AI-powered fleet orchestration platform, generally available with usage-based pricing.`, category: "product", sourceIds: ids("prod-pr", "prod-2") },
      { text: `${T} appointed Priya Raman, formerly of CloudCo, as Chief Revenue Officer to build enterprise sales.`, category: "people", sourceIds: ids("hire-1", "hire-2") },
      { text: `Helios Logistics signed a multi-year partnership to deploy 500 ${T} robots across 12 distribution centers.`, category: "partnerships", sourceIds: ids("part-1", "part-2") },
      { text: `CFO Mark Ellison is expected to step down at year end, per one person familiar with the matter.`, category: "people", hedged: true, sourceIds: ids("cfo") },
      { text: `${T} is reportedly exploring an acquisition of rival Kestrel AI.`, category: "funding", hedged: true, sourceIds: ids("rumor") },
      { text: `Users reported a roughly three-hour outage of the Atlas cloud dashboard; no incident report published.`, category: "risk", sourceIds: ids("risk") },
      // Deliberate model mistakes, to be caught by verify.ts:
      { text: `${T} revenue grew 300% year over year.`, category: "financials", sourceIds: ids("fund-1") },
      { text: `${T} plans an IPO next year.`, category: "funding", sourceIds: ["S99"] },
    ],
    talkingPoints: [
      { text: `Open with the Series C: ask which of the European expansion priorities your offer supports.`, sourceIds: ids("fund-pr") },
      { text: `Atlas 2 orchestrates mixed robot fleets — position integrations around it.`, sourceIds: ids("prod-2") },
      { text: `Priya Raman is building enterprise sales; she is a likely new stakeholder for commercial terms.`, sourceIds: ids("hire-1") },
      { text: `The Helios deal (500 robots, 12 sites) is a ready-made reference for scale.`, sourceIds: ids("part-1") },
    ],
    openQuestions: [
      { text: `Who will own finance decisions if the CFO transition report is accurate?`, why: "single-source report", sourceIds: ids("cfo") },
      { text: `What caused the Atlas dashboard outage, and what SLAs do customers get now?`, why: "unconfirmed incident", sourceIds: ids("risk") },
      { text: `How does the new funding change their buying timeline for the next two quarters?`, why: "budget signal", sourceIds: ids("fund-1") },
    ],
  };
}

// --------------------------------------------------------- shared assembler

export interface Assembled {
  tldr: CitedText[];
  keyDevelopments: Claim[];
  peopleChanges: Claim[];
  uncertain: Claim[];
  talkingPoints: CitedText[];
  openQuestions: Array<{ text: string; why?: string | undefined; sourceIds: string[] }>;
  dropped: string[];
  citedIds: Set<string>;
}

const PEOPLE_CATS: Category[] = ["people"];

export function assemble(draft: Draft, sources: Source[]): Assembled {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const validIds = (ids?: string[]) =>
    [...new Set((ids ?? []).map((i) => String(i).toUpperCase()))].filter((i) => byId.has(i));
  const dropped: string[] = [];
  const claims: Claim[] = [];
  (draft.claims ?? []).forEach((p, i) => {
    const r = verifyClaim(p, i, byId);
    if (r.claim) claims.push(r.claim);
    else if (r.droppedReason) dropped.push(r.droppedReason);
  });
  const byDate = (a: Claim, b: Claim) => (b.date ?? "").localeCompare(a.date ?? "");
  const verified = claims.filter((c) => c.confidence === "verified").sort(byDate);
  const uncertain = claims.filter((c) => c.confidence === "uncertain").sort(byDate);

  // TL;DR bullets are factual too: they must cite, be grounded, and carry no unsupported figures.
  const tldr: CitedText[] = [];
  for (const t of draft.tldr ?? []) {
    const ids = validIds(t.sourceIds);
    if (!ids.length) {
      dropped.push(`TL;DR without valid citation: "${t.text.slice(0, 80)}"`);
      continue;
    }
    const g = ground(t.text, ids.map((i) => byId.get(i)!));
    if (g.missingFigures.length || g.score < 0.4) {
      dropped.push(`TL;DR not supported by its sources: "${t.text.slice(0, 80)}"`);
      continue;
    }
    tldr.push({ text: t.text.trim(), sourceIds: ids });
  }

  const talkingPoints = (draft.talkingPoints ?? [])
    .filter((t) => t.text?.trim())
    .slice(0, 5)
    .map((t) => ({ text: t.text.trim(), sourceIds: validIds(t.sourceIds) }));
  const openQuestions = (draft.openQuestions ?? [])
    .filter((q) => q.text?.trim())
    .slice(0, 5)
    .map((q) => {
      const why = q.why?.trim();
      return { text: q.text.trim(), ...(why ? { why } : {}), sourceIds: validIds(q.sourceIds) };
    });

  const keyDevelopments = verified.filter((c) => !PEOPLE_CATS.includes(c.category)).slice(0, 6);
  const peopleChanges = verified.filter((c) => PEOPLE_CATS.includes(c.category)).slice(0, 4);
  const uncertainCapped = uncertain.slice(0, 6);

  const citedIds = new Set<string>();
  for (const x of [...tldr, ...keyDevelopments, ...peopleChanges, ...uncertainCapped, ...talkingPoints, ...openQuestions])
    x.sourceIds.forEach((i) => citedIds.add(i));

  return {
    tldr: tldr.slice(0, 3),
    keyDevelopments,
    peopleChanges,
    uncertain: uncertainCapped,
    talkingPoints,
    openQuestions,
    dropped,
    citedIds,
  };
}
