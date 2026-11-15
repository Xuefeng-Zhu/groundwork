# Groundwork — pitch outline (9 slides)

## 1. Title
**Groundwork: prepare for meetings with cited research and visible uncertainty.**
- Geek Room Global AI Hackathon · PS05 Pre-Meeting Briefing Agent · Tavily track
- Built on Agent-Native, Tavily and Bifrost
- *Talking point:* "A cited one-pager to help you prepare for your next meeting."

## 2. The problem
- Meeting prep means 20–40 minutes in news tabs, or walking in cold.
- Generic AI answers are fluent but undated and uncited, and sometimes made up. In a sales or investor meeting, one wrong "fact" costs credibility.
- *Talking point:* "The issue isn't summarising. It's knowing what you can safely say out loud."

## 3. The solution
- Input: company or person, meeting time, and purpose (sales, partnership, investor, BD, hiring).
- Output: a one-page brief with a TL;DR, dated key developments, people and org changes, talking points, open questions, an **Uncertain / unverified** box, and sources.
- Claims include `[S#]` source links for review. Export the brief as Markdown or print it.
- *Talking point:* show the screenshot and point at the green ✓ vs amber ⚠ items.

## 4. How it works (architecture)
- Plan 6–8 targeted queries, then Tavily news search for the 30 days before the meeting, deduplicate and filter results, and use Tavily Extract for full text. The local filter allows a six-hour grace period, retains undated results, and may retain older background sources for context.
- The LLM drafts through the **Bifrost** gateway. **verify.ts** applies heuristic checks to decide which claims receive the verified label; readers should still check sources.
- One set of Agent-Native **actions** (`research-target`, `generate-briefing`, `export-briefing`) powers the UI, the chat agent, HTTP, CLI and MCP.
- *Talking point:* "Defined once, usable everywhere: the form and the chat agent call the exact same code."

## 5. The innovation: "the model proposes, the code decides"
- Invalid citation IDs are removed; a claim with no valid citations is dropped.
- A detected figure not found in the cited text: marked ⚠ uncertain.
- Verified requires the checks to pass and either two distinct source root domains or a primary source (official site or press wire). Distinct domains do not guarantee independent reporting.
- Rumours, claims supported only by a single secondary source, and claims with no dated sources go to the ⚠ box, with the reason. The lexical checks do not prove factual or semantic support; review the cited sources.
- *Talking point:* demo moment. The mock draft includes an invented 300% revenue growth figure and cites source S99. Watch the checks flag the figure and drop the unsupported claim.

## 6. Tavily + Bifrost, used properly
- Tavily: `topic: news`, `start_date`/`end_date` = the window, `include_answer: false` (evidence, not answers), and Extract for grounding text.
- Bifrost: an OpenAI-compatible gateway with provider keys kept out of the app, plus failover, caching, budgets and logs. Our model chain is NVIDIA Nemotron 3 Ultra → Groq gpt-oss-120b → NVIDIA GLM-5.3 Flash, all through one endpoint. The app falls back to OpenAI, then Anthropic, then an extractive drafter when model calls fail; research can still fail if search is unavailable.
- *Talking point:* "Swapping models is a config change in Bifrost, not a code change."

## 7. Impact and who it's for
- Sales/AEs before discovery calls, founders before investor meetings, BD and partnerships, recruiters before exec interviews.
- The goal is to shorten preparation and make sources and uncertainty easier to review; speed and accuracy have not been established in a controlled study.
- Purpose-aware talking points and "confirm before relying on" questions turn research into a conversation plan.

## 8. Technical execution and scalability
- TypeScript end to end, with Zod contracts as the action input and output schemas.
- Parallel search fan-out and stateless actions, so it scales horizontally. Bifrost handles model rate limits and failover.
- Tests: an end-to-end run of the live path against stand-in Tavily and Bifrost servers, plus unit tests for the verifier. A deterministic `MOCK=1` mode makes demos reproducible.
- Next steps: calendar integration (auto-brief 1 hour before each meeting), CRM push, NLI entailment checks per claim, and team-shared history.

## 9. Ask / close
- Live demo link, GitHub repo, and a 2-minute video.
- Team: _names and roles_
- *Closing line:* "Prepare with sources you can inspect."
