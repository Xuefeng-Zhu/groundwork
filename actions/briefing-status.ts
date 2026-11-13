import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { describeConfig, getConfig } from "../server/lib/briefing/config.js";

export default defineAction({
  description:
    "Report which research and model backends the briefing agent will use (mock mode, Tavily, Bifrost gateway / direct provider fallback). Never returns secrets.",
  schema: z.object({}),
  outputSchema: z.object({
    mock: z.boolean(),
    search: z.string(),
    llmChain: z.array(z.string()),
  }),
  http: { method: "GET" },
  run: async () => {
    const d = describeConfig(getConfig());
    return { mock: d.mock, search: d.search, llmChain: [...d.llmChain] };
  },
});
