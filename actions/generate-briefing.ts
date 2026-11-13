import { defineAction, fail } from "@agent-native/core/action";

import { getConfig } from "../server/lib/briefing/config.js";
import { BriefingError, generateBriefing } from "../server/lib/briefing/pipeline.js";
import {
  briefingRequestSchema,
  briefingSchema,
  researchResultSchema,
} from "../shared/briefing/schema.js";

export default defineAction({
  description:
    "Generate a one-page pre-meeting briefing for a company or person: TL;DR, dated key developments, people/org changes, talking points, open questions, an 'uncertain / unverified' section, and a sources list. Every factual line cites source ids; claims are verified in code (2+ independent outlets or a primary source, figures must appear in source text). Pass `research` from research-target to reuse it, otherwise research runs first. LLM calls go through the Bifrost gateway.",
  schema: briefingRequestSchema.extend({
    research: researchResultSchema
      .optional()
      .describe("Optional result of research-target to synthesise from, skipping a second search"),
  }),
  outputSchema: briefingSchema,
  readOnly: true,
  searchHints: ["meeting brief", "pre-meeting", "prep doc", "account research", "dossier"],
  run: async ({ research, ...req }) => {
    try {
      return await generateBriefing(req, { research, cfg: getConfig() });
    } catch (e) {
      if (e instanceof BriefingError)
        fail(e.message, { errorCode: e.code, statusCode: e.code === "search_failed" ? 502 : 400 });
      throw e;
    }
  },
});

