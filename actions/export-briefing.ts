import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { briefingToMarkdown } from "../shared/briefing/markdown.js";
import { briefingSchema } from "../shared/briefing/schema.js";

export default defineAction({
  description:
    "Export a briefing (the object returned by generate-briefing) as portable Markdown with inline citation links, ready to paste into email, Notion, a CRM note or a doc.",
  schema: z.object({
    briefing: briefingSchema.describe("Briefing object returned by generate-briefing"),
  }),
  outputSchema: z.object({ filename: z.string(), markdown: z.string() }),
  readOnly: true,
  run: async ({ briefing }) => {
    const slug = briefing.request.target.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return {
      filename: `brief-${slug}-${briefing.request.meetingAt.slice(0, 10)}.md`,
      markdown: briefingToMarkdown(briefing),
    };
  },
});
