/**
 * Shared, framework-agnostic data contracts for the Pre-Meeting Briefing Agent.
 * Used by server actions (as input/output schemas), the UI, and the Markdown exporter.
 */
import { z } from "zod";

export const TARGET_TYPES = ["company", "person"] as const;
export const MEETING_PURPOSES = [
  "sales",
  "partnership",
  "investor",
  "bd",
  "hiring",
  "general",
] as const;
export const CATEGORIES = [
  "news",
  "product",
  "people",
  "funding",
  "partnerships",
  "financials",
  "person",
  "risk",
] as const;

export const targetTypeSchema = z.enum(TARGET_TYPES);
export const meetingPurposeSchema = z.enum(MEETING_PURPOSES);
export const categorySchema = z.enum(CATEGORIES);

export type TargetType = z.infer<typeof targetTypeSchema>;
export type MeetingPurpose = z.infer<typeof meetingPurposeSchema>;
export type Category = z.infer<typeof categorySchema>;

export const briefingRequestSchema = z.object({
  target: z
    .string()
    .min(2)
    .max(120)
    .describe('Company or person to research, e.g. "Stripe" or "Satya Nadella"'),
  targetType: targetTypeSchema
    .default("company")
    .describe('"company" or "person"; defaults to "company"'),
  meetingAt: z
    .string()
    .describe(
      "Meeting date/time as ISO 8601 (e.g. 2026-11-20T15:00:00-08:00). Research covers the N days before it.",
    ),
  purpose: meetingPurposeSchema
    .default("general")
    .describe(
      'Meeting type: "sales", "partnership", "investor", "bd", "hiring", or "general"; defaults to "general"',
    ),
  organization: z
    .string()
    .max(120)
    .optional()
    .describe("For a person: their current company, to disambiguate the name"),
  officialDomain: z
    .string()
    .max(120)
    .optional()
    .describe("Target's official website domain (e.g. stripe.com); press releases there count as primary sources"),
  context: z
    .string()
    .max(1000)
    .optional()
    .describe("Free-text notes about the meeting (your goals, what you sell, attendees)"),
  windowDays: z.coerce
    .number()
    .int()
    .min(1)
    .max(90)
    .default(30)
    .describe("How many days before the meeting to research; defaults to 30"),
});
export type BriefingRequest = z.infer<typeof briefingRequestSchema>;
export type BriefingRequestInput = z.input<typeof briefingRequestSchema>;

export const plannedQuerySchema = z.object({
  id: z.string(),
  category: categorySchema,
  query: z.string(),
  topic: z.enum(["news", "general"]),
  kind: z
    .enum(["news", "official", "background"])
    .optional()
    .describe("news = date-windowed news search; official = restricted to the official domain; background = undated context"),
  includeDomains: z.array(z.string()).optional(),
});
export type PlannedQuery = z.infer<typeof plannedQuerySchema>;

export const sourceSchema = z.object({
  id: z.string().describe("Stable citation id like S1"),
  url: z.string(),
  title: z.string(),
  domain: z.string(),
  publishedAt: z.string().nullable(),
  snippet: z.string(),
  content: z.string().optional(),
  queryIds: z.array(z.string()),
  categories: z.array(categorySchema),
  score: z.number(),
  isPrimary: z.boolean(),
  extracted: z.boolean().optional(),
  origin: z
    .enum(["search", "background", "site"])
    .optional()
    .describe("search = windowed Tavily search; background = context outside the window; site = official newsroom page found by Tavily Map"),
});
export type Source = z.infer<typeof sourceSchema>;

export const windowSchema = z.object({ start: z.string(), end: z.string() });
export type DateWindow = z.infer<typeof windowSchema>;

export const researchStatsSchema = z.object({
  queries: z.number(),
  rawResults: z.number(),
  duplicates: z.number(),
  outOfWindow: z.number(),
  undated: z.number(),
  kept: z.number(),
  failedQueries: z.number(),
  extracted: z.number(),
  background: z.number().optional(),
  mappedUrls: z.number().optional(),
  sitePages: z.number().optional(),
  newsroomUrl: z.string().optional(),
  tavilyCalls: z.number().optional(),
  tavilyCredits: z.number().optional(),
});

export const researchResultSchema = z.object({
  request: briefingRequestSchema,
  window: windowSchema,
  queries: z.array(plannedQuerySchema),
  sources: z.array(sourceSchema),
  stats: researchStatsSchema,
  searchMode: z.enum(["tavily", "mock"]),
  warnings: z.array(z.string()),
  durationMs: z.number(),
});
export type ResearchResult = z.infer<typeof researchResultSchema>;

export const confidenceSchema = z.enum(["verified", "uncertain"]);
export type Confidence = z.infer<typeof confidenceSchema>;

export const claimSchema = z.object({
  id: z.string(),
  text: z.string(),
  category: categorySchema,
  date: z.string().nullable(),
  sourceIds: z.array(z.string()),
  confidence: confidenceSchema,
  confidenceReason: z.string(),
  grounding: z.number().describe("0..1 share of the claim's key terms found in its cited sources"),
});
export type Claim = z.infer<typeof claimSchema>;

export const citedTextSchema = z.object({
  text: z.string(),
  sourceIds: z.array(z.string()),
});
export type CitedText = z.infer<typeof citedTextSchema>;

export const openQuestionSchema = z.object({
  text: z.string(),
  why: z.string().optional(),
  sourceIds: z.array(z.string()),
});

export const briefingSchema = z.object({
  id: z.string(),
  title: z.string(),
  request: briefingRequestSchema,
  window: windowSchema,
  generatedAt: z.string(),
  engine: z.object({
    search: z.enum(["tavily", "mock"]),
    llm: z.enum(["bifrost", "openai", "anthropic", "heuristic", "mock"]),
    model: z.string().optional(),
  }),
  tldr: z.array(citedTextSchema),
  keyDevelopments: z.array(claimSchema),
  peopleChanges: z.array(claimSchema),
  uncertain: z.array(claimSchema),
  talkingPoints: z.array(citedTextSchema),
  openQuestions: z.array(openQuestionSchema),
  sources: z.array(sourceSchema),
  stats: z.object({
    sourcesReviewed: z.number(),
    sourcesCited: z.number(),
    claimsVerified: z.number(),
    claimsUncertain: z.number(),
    claimsDropped: z.number(),
    citationsRemoved: z.number().optional().describe("Citations the verifier removed as off-topic or unsupported"),
    sitePages: z.number().optional().describe("Official newsroom pages found via Tavily Map and extracted"),
    tavilyCalls: z.number().optional(),
    tavilyCredits: z.number().optional(),
    durationMs: z.number(),
  }),
  warnings: z.array(z.string()),
  demoData: z.boolean(),
});
export type Briefing = z.infer<typeof briefingSchema>;

export const PURPOSE_LABELS: Record<MeetingPurpose, string> = {
  sales: "Sales call",
  partnership: "Partnership",
  investor: "Investor meeting",
  bd: "Business development",
  hiring: "Hiring / recruiting",
  general: "General meeting",
};

export const CATEGORY_LABELS: Record<Category, string> = {
  news: "News",
  product: "Product",
  people: "People",
  funding: "Funding",
  partnerships: "Partnerships",
  financials: "Financials",
  person: "Person",
  risk: "Risk",
};
