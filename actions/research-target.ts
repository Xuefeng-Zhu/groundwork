import { defineAction, fail } from "@agent-native/core/action";

import { getConfig } from "../server/lib/briefing/config.js";
import { BriefingError, researchTarget } from "../server/lib/briefing/pipeline.js";
import { briefingRequestSchema, researchResultSchema } from "../shared/briefing/schema.js";

export default defineAction({
  description:
    "Research a company or person for an upcoming meeting: plans targeted searches (news, launches, exec changes, funding, partnerships), runs them on Tavily restricted to the N days before the meeting, then de-duplicates and date-filters results into numbered sources (S1..Sn). Read-only. Use before generate-briefing, or to inspect raw evidence.",
  schema: briefingRequestSchema,
  outputSchema: researchResultSchema,
  readOnly: true,
  searchHints: ["meeting prep", "background research", "news search", "tavily"],
  run: async (args) => {
    try {
      return await researchTarget(args, getConfig());
    } catch (e) {
      if (e instanceof BriefingError)
        fail(e.message, { errorCode: e.code, statusCode: e.code === "search_failed" ? 502 : 400 });
      throw e;
    }
  },
});
