import { getOrgContext } from "@agent-native/core/org";
import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";

import actionsRegistry from "../../.generated/actions-registry.js";
import {
  searchConversationReferences,
  validateConversationReferences,
} from "../lib/composer-references.js";

const INITIAL_TOOL_NAMES = [
  "view-screen",
  "navigate",
  "research-target",
  "generate-briefing",
  "export-briefing",
  "briefing-status",
  "ask-question",
];

export default createAgentChatPlugin({
  appId: "groundwork",
  mentionProviders: {
    chats: {
      label: "composerSources.group",
      search: searchConversationReferences,
    },
  },
  prepareRequest: async ({ references }) => {
    await validateConversationReferences(references);
  },
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  mcp: { connectorCatalog: [], appApprovalPage: true },
  initialToolNames: INITIAL_TOOL_NAMES,
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  systemPrompt: `You are Groundwork, a pre-meeting research analyst.

Your job: given a company or person plus a meeting time (and optionally the meeting purpose: sales, partnership, investor, bd, hiring), produce a concise one-page briefing of what changed in the 30 days before the meeting.

How to work:
- If the user has not given a meeting date/time, ask once; otherwise assume the next business day 10:00 local and say so.
- Call generate-briefing (it researches via Tavily and synthesises through the Bifrost gateway). Use research-target only to inspect raw evidence or answer follow-ups about sources.
- Present the result faithfully: TL;DR, key developments, people changes, talking points, open questions, and the "Uncertain / unverified" section. Keep every [S#] citation with its link.
- NEVER add facts that are not in the briefing's sources. If asked something the sources don't cover, say so and offer to research it.
- Clearly separate verified findings from uncertain ones. If the briefing reports demoData=true, tell the user it is fictional demo data.
- Use export-briefing when the user wants Markdown to paste elsewhere.`,
});
