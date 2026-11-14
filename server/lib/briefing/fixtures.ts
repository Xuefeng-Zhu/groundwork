/**
 * Deterministic demo fixtures for MOCK=1. Everything here is FICTIONAL: outlets use
 * the reserved `.example` TLD and the UI shows a "demo data" banner. The fixtures
 * deliberately include edge cases the pipeline must handle: syndicated duplicates,
 * a tracking-param duplicate URL, an out-of-window article, an undated page,
 * single-source rumours, a primary-source press release, a first-party newsroom page
 * (as Tavily Map would find it) and an off-topic article about a different company that
 * the mock model wrongly cites (the per-citation verifier must remove it).
 */
import type { BriefingRequest, Category, DateWindow, PlannedQuery } from "../../../shared/briefing/schema";
import type { RawHit } from "./sources";

interface Fixture {
  key: string;
  cat: Category;
  daysBefore: number | null; // null = undated
  domain: string; // "{slug}" is replaced with the target slug
  path: string;
  title: string;
  content: string;
  score: number;
  origin?: "search" | "site";
}

const COMPANY: Fixture[] = [
  { key: "fund-1", cat: "funding", daysBefore: 6, domain: "techwire.example", path: "/2026/{slug}-series-c", score: 0.91,
    title: "{T} raises $120M Series C led by Meridian Ventures",
    content: "{T} has raised $120 million in a Series C round led by Meridian Ventures, valuing the company at $1.4 billion. The company said the money will fund expansion into Europe and a larger engineering team." },
  { key: "fund-2", cat: "funding", daysBefore: 5, domain: "businessdaily.example", path: "/markets/{slug}-funding", score: 0.86,
    title: "{T} lands $120 million to take its warehouse robots to Europe",
    content: "Warehouse automation firm {T} closed a $120 million Series C. Meridian Ventures led the round; existing investors participated. The valuation was reported at $1.4 billion." },
  { key: "fund-pr", cat: "funding", daysBefore: 6, domain: "{slug}.example", path: "/newsroom/series-c", score: 0.8,
    title: "{T} announces $120M Series C to accelerate European expansion",
    content: "Press release. {T} today announced a $120 million Series C financing led by Meridian Ventures. Proceeds will support European expansion, new hiring and the Atlas platform roadmap." },
  { key: "fund-dup", cat: "news", daysBefore: 6, domain: "techwire.example", path: "/2026/{slug}-series-c?utm_source=newsletter&utm_medium=email", score: 0.7,
    title: "{T} raises $120M Series C led by Meridian Ventures",
    content: "{T} has raised $120 million in a Series C round led by Meridian Ventures." },
  { key: "prod-pr", cat: "product", daysBefore: 12, domain: "{slug}.example", path: "/newsroom/atlas-2", score: 0.84,
    title: "{T} launches Atlas 2, an AI fleet orchestration platform",
    content: "{T} launched Atlas 2, an AI-powered fleet orchestration platform that coordinates mixed robot fleets across warehouses. Atlas 2 is generally available today with usage-based pricing." },
  { key: "prod-2", cat: "product", daysBefore: 11, domain: "techwire.example", path: "/2026/{slug}-atlas-2-review", score: 0.78,
    title: "Hands-on: {T}'s Atlas 2 wants to run every robot in the warehouse",
    content: "Atlas 2, the new fleet orchestration platform from {T}, coordinates robots from multiple vendors. {T} says Atlas 2 is generally available now with usage-based pricing." },
  { key: "hire-1", cat: "people", daysBefore: 15, domain: "businessdaily.example", path: "/people/{slug}-cro", score: 0.8,
    title: "{T} appoints Priya Raman as Chief Revenue Officer",
    content: "{T} has appointed Priya Raman as Chief Revenue Officer. Raman previously led global sales at CloudCo and will build out the enterprise sales team." },
  { key: "hire-2", cat: "people", daysBefore: 14, domain: "hrdive.example", path: "/news/{slug}-names-cro", score: 0.74,
    title: "{T} names Priya Raman CRO as it builds enterprise sales",
    content: "Priya Raman joins {T} as Chief Revenue Officer, according to the company. Raman will focus on enterprise sales." },
  { key: "cfo", cat: "people", daysBefore: 9, domain: "marketpulse.example", path: "/{slug}-cfo-exit", score: 0.66,
    title: "{T} CFO Mark Ellison expected to step down at year end",
    content: "Mark Ellison, chief financial officer of {T}, is expected to step down at year end, according to a person familiar with the matter. The company declined to comment." },
  { key: "part-1", cat: "partnerships", daysBefore: 20, domain: "logisticsweekly.example", path: "/{slug}-helios", score: 0.77,
    title: "Helios Logistics partners with {T} to deploy 500 robots",
    content: "Helios Logistics will deploy 500 {T} robots across 12 distribution centers under a new multi-year partnership." },
  { key: "part-2", cat: "partnerships", daysBefore: 19, domain: "techwire.example", path: "/2026/helios-{slug}-deal", score: 0.72,
    title: "{T} signs multi-year deal with Helios Logistics",
    content: "{T} and Helios Logistics signed a multi-year partnership covering 500 robots in 12 distribution centers." },
  { key: "rumor", cat: "funding", daysBefore: 3, domain: "rumormill.example", path: "/{slug}-kestrel", score: 0.58,
    title: "Is {T} eyeing a Kestrel AI acquisition?",
    content: "Industry chatter suggests {T} is exploring an acquisition of smaller rival Kestrel AI. Neither company commented and no deal terms have been reported." },
  { key: "risk", cat: "risk", daysBefore: 2, domain: "opsforum.example", path: "/threads/atlas-outage", score: 0.52,
    title: "Users report Atlas dashboard outage at {T}",
    content: "Several users reported that the Atlas cloud dashboard from {T} was unavailable for about three hours. {T} has not published an incident report." },
  { key: "site-berlin", cat: "news", daysBefore: 8, domain: "{slug}.example", path: "/newsroom/berlin-engineering-hub", score: 0.6, origin: "site",
    title: "{T} opens Berlin engineering hub",
    content: "Newsroom. {T} today opened an engineering hub in Berlin, its first office in Europe, with 40 engineers working on the Atlas platform." },
  { key: "offtopic", cat: "partnerships", daysBefore: 8, domain: "dronetimes.example", path: "/2026/southwind-drones-retail-deal", score: 0.7,
    title: "Southwind Drones signs multi-year deal with a national retailer",
    content: "Southwind Drones will supply 300 inventory drones to a national retailer under a multi-year agreement announced this week." },
  { key: "jobs", cat: "news", daysBefore: null, domain: "{slug}.example", path: "/careers", score: 0.4,
    title: "Careers at {T}",
    content: "{T} is hiring across engineering, sales and field operations in Boston, Berlin and Austin." },
  { key: "old", cat: "news", daysBefore: 45, domain: "businessdaily.example", path: "/lists/top-robotics-startups", score: 0.6,
    title: "{T} named to list of top robotics startups",
    content: "{T} was named one of the top robotics startups of the year." },
];

const PERSON: Fixture[] = [
  { key: "role-pr", cat: "people", daysBefore: 10, domain: "{oslug}.example", path: "/newsroom/new-cpo", score: 0.85,
    title: "{O} promotes {T} to Chief Product Officer",
    content: "{O} today announced that {T} has been promoted to Chief Product Officer. {T} previously served as VP of Product and led the Atlas platform." },
  { key: "role-2", cat: "people", daysBefore: 9, domain: "businessdaily.example", path: "/people/{slug}-cpo", score: 0.8,
    title: "{T} becomes Chief Product Officer at {O}",
    content: "{T}, who led the Atlas platform as VP of Product, is now Chief Product Officer at {O}." },
  { key: "talk-1", cat: "person", daysBefore: 16, domain: "techwire.example", path: "/events/roboworld-{slug}", score: 0.76,
    title: "At RoboWorld Summit, {T} calls for open robotics interoperability standards",
    content: "Speaking at RoboWorld Summit, {T} of {O} called for open interoperability standards so robots from different vendors can share maps and tasks." },
  { key: "talk-2", cat: "person", daysBefore: 16, domain: "automationnews.example", path: "/roboworld-keynote", score: 0.7,
    title: "{O}'s {T} pushes for open standards in RoboWorld keynote",
    content: "In a RoboWorld Summit keynote, {T} argued for open interoperability standards across robot vendors." },
  { key: "pod", cat: "person", daysBefore: 7, domain: "podcasts.example", path: "/second-wave/{slug}", score: 0.62,
    title: "Podcast: {T} on the 'second wave' of warehouse automation",
    content: "{T} says warehouse automation is entering a second wave focused on software orchestration rather than hardware." },
  { key: "org-fund", cat: "funding", daysBefore: 6, domain: "techwire.example", path: "/2026/{oslug}-series-c", score: 0.82,
    title: "{O} raises $120M Series C led by Meridian Ventures",
    content: "{O} has raised $120 million in a Series C round led by Meridian Ventures to expand into Europe." },
  { key: "org-fund-2", cat: "funding", daysBefore: 5, domain: "businessdaily.example", path: "/markets/{oslug}-funding", score: 0.78,
    title: "{O} lands $120 million Series C",
    content: "{O} closed a $120 million Series C led by Meridian Ventures." },
  { key: "board", cat: "person", daysBefore: 4, domain: "rumormill.example", path: "/{slug}-board", score: 0.5,
    title: "{T} reportedly weighing a board seat at a stealth startup",
    content: "{T} is reportedly considering joining the board of a stealth-mode robotics startup, according to one person familiar. {T} did not respond to a request for comment." },
  { key: "old", cat: "person", daysBefore: 60, domain: "techwire.example", path: "/old/{slug}", score: 0.6,
    title: "{T} speaks at last year's automation expo",
    content: "{T} spoke at an automation expo." },
];

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 30) || "target";
}

export function fixtureOrg(req: BriefingRequest): string {
  return req.organization?.trim() || "Northwind Robotics";
}

function fill(s: string, req: BriefingRequest): string {
  const org = fixtureOrg(req);
  return s
    .split("{T}").join(req.target.trim())
    .split("{O}").join(org)
    .split("{oslug}").join(slugify(org))
    .split("{slug}").join(slugify(req.target));
}

/** Map fixtures onto planned queries so the result looks like a real fan-out. */
export function mockSearch(req: BriefingRequest, queries: PlannedQuery[], window: DateWindow): RawHit[] {
  const end = new Date(window.end).getTime();
  const set = req.targetType === "person" ? PERSON : COMPANY;
  const hits: RawHit[] = [];
  for (const f of set) {
    if (f.origin === "site" && !req.officialDomain) continue; // Map only runs with an official domain
    const q = queries.find((x) => x.category === f.cat) ?? queries[0]!;
    const url = `https://${fill(f.domain, req)}${fill(f.path, req)}${f.path.includes("?") ? "&" : "?"}fx=${f.key}`;
    hits.push({
      queryId: q.id,
      url,
      title: fill(f.title, req),
      content: fill(f.content, req),
      publishedDate:
        f.daysBefore === null ? null : new Date(end - f.daysBefore * 86_400_000 - 3_600_000).toUTCString(),
      score: f.score,
      ...(f.origin ? { origin: f.origin } : {}),
    });
  }
  return hits;
}

/** Fixture key embedded in a mock URL (survives canonicalisation). */
export function fixtureKey(url: string): string | null {
  try {
    return new URL(url).searchParams.get("fx");
  } catch {
    return null;
  }
}

/**
 * MOCK=1 makes no Tavily calls. To still show what a live run of the same plan costs, estimate it
 * from the planned queries: advanced news search = 2 credits, basic (official/background) = 1,
 * Map on the newsroom ~2, one batched Extract = 1 credit per 5 URLs.
 */
export function estimateTavilyUsage(queries: PlannedQuery[], extractUrls: number, mapped: boolean): { calls: number; credits: number } {
  let calls = 0;
  let credits = 0;
  for (const q of queries) {
    calls++;
    credits += (q.kind ?? "news") === "news" ? 2 : 1;
  }
  if (mapped) {
    calls++;
    credits += 2;
  }
  if (extractUrls > 0) {
    calls++;
    credits += Math.ceil(extractUrls / 5);
  }
  return { calls, credits };
}
