/**
 * Query planner: turns (target, type, purpose) into a focused set of Tavily
 * searches, one per signal a pre-meeting brief needs. Deterministic on purpose:
 * cheap, reproducible, and easy to audit in the UI.
 */
import type { BriefingRequest, DateWindow, PlannedQuery } from "../../../shared/briefing/schema";

const DAY_MS = 86_400_000;

export function computeWindow(req: BriefingRequest): DateWindow {
  const end = new Date(req.meetingAt);
  if (Number.isNaN(end.getTime())) throw new Error(`Invalid meetingAt: ${req.meetingAt}`);
  const start = new Date(end.getTime() - req.windowDays * DAY_MS);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function planQueries(req: BriefingRequest): PlannedQuery[] {
  const t = `"${req.target.trim()}"`;
  const q: Array<Omit<PlannedQuery, "id">> = [];
  if (req.targetType === "company") {
    q.push({ category: "news", topic: "news", query: `${t} latest news` });
    q.push({ category: "product", topic: "news", query: `${t} product launch or new feature announcement` });
    q.push({ category: "people", topic: "news", query: `${t} executive hire, appointment or leadership change` });
    q.push({ category: "funding", topic: "news", query: `${t} funding round, acquisition or valuation` });
    q.push({ category: "partnerships", topic: "news", query: `${t} new partnership or major customer deal` });
    q.push({ category: "news", topic: "general", query: `${t} press release announcement` });
    if (req.purpose === "investor")
      q.push({ category: "financials", topic: "news", query: `${t} revenue, earnings or growth figures` });
    if (req.purpose === "sales" || req.purpose === "bd")
      q.push({ category: "risk", topic: "news", query: `${t} layoffs, lawsuit, outage or restructuring` });
  } else {
    const org = req.organization ? ` "${req.organization.trim()}"` : "";
    q.push({ category: "person", topic: "news", query: `${t}${org}` });
    q.push({ category: "people", topic: "news", query: `${t}${org} new role, appointment or promotion` });
    q.push({ category: "person", topic: "news", query: `${t}${org} interview, keynote, podcast or public comments` });
    q.push({ category: "person", topic: "general", query: `${t}${org} announcement` });
    if (req.organization) {
      const o = `"${req.organization.trim()}"`;
      q.push({ category: "news", topic: "news", query: `${o} latest news` });
      q.push({ category: "funding", topic: "news", query: `${o} funding, acquisition or product launch` });
    }
  }
  return q.map((x, i) => ({ ...x, id: `Q${i + 1}` }));
}
