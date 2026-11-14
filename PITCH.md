# Groundwork — pitch outline (9 slides)

## 1. Title
**Groundwork: walk into every meeting knowing what changed, with a source for every line.**
- Geek Room Global AI Hackathon · PS05 Pre-Meeting Briefing Agent · Tavily track
- Built on Agent-Native, Tavily and Bifrost
- *Talking point:* "In 60 seconds, a cited one-pager on anyone you're about to meet."

## 2. The problem
- Meeting prep means 20–40 minutes in news tabs, or walking in cold.
- Generic AI answers are fluent but undated and uncited, and sometimes made up. In a sales or investor meeting, one wrong "fact" costs credibility.
- *Talking point:* "The issue isn't summarising. It's knowing what you can safely say out loud."

## 3. The solution
- Input: company or person, meeting time, and purpose (sales, partnership, investor, BD, hiring).
- Output: a one-page brief with a TL;DR, dated key developments, people and org changes, talking points, open questions, an **Uncertain / unverified** box, and sources.
- Every factual line carries `[S#]` citations. Export it as Markdown or print it.
- *Talking point:* show the screenshot and point at the green ✓ vs amber ⚠ items.

## 4. How it works (architecture)
- Plan 6–8 targeted queries, then Tavily news search with a hard 30-day date window, then dedupe and window-filter, then Tavily Extract for full text.
- The LLM drafts through the **Bifrost** gateway. **verify.ts** then decides what counts as verified.
- One set of Agent-Native **actions** (`research-target`, `generate-briefing`, `export-briefing`) powers the UI, the chat agent, HTTP, CLI and MCP.
- *Talking point:* "Defined once, usable everywhere: the form and the chat agent call the exact same code."

## 5. The innovation: "the model proposes, the code decides"
- A citation to a source we never retrieved: the statement is dropped.
- A figure not found in the cited text: marked ⚠ uncertain.
- Verified needs 2+ independent outlets **or** a primary source (official site or press wire).
- Rumours, single secondary sources and undated pages go to the ⚠ box, with the reason.
- *Talking point:* demo moment. The model "invents" 300% revenue growth and cites source S99. Watch both get caught.

## 6. Tavily + Bifrost, used properly
- Tavily: `topic: news`, `start_date`/`end_date` = the window, `include_answer: false` (evidence, not answers), and Extract for grounding text.
- Bifrost: an OpenAI-compatible gateway with provider keys kept out of the app, plus failover, caching, budgets and logs. The app falls back to OpenAI, then Anthropic, then an extractive drafter, so the brief always ships.
- *Talking point:* "Swapping models is a config change in Bifrost, not a code change."

## 7. Impact and who it's for
- Sales/AEs before discovery calls, founders before investor meetings, BD and partnerships, recruiters before exec interviews.
- Prep goes from ~30 minutes to ~1 minute, with lower risk of repeating a stale or false claim.
- Purpose-aware talking points and "confirm before relying on" questions turn research into a conversation plan.

## 8. Technical execution and scalability
- TypeScript end to end, with Zod contracts as the action input and output schemas.
- Parallel search fan-out and stateless actions, so it scales horizontally. Bifrost handles model rate limits and failover.
- Tests: an end-to-end run of the live path against stand-in Tavily and Bifrost servers, plus unit tests for the verifier. A deterministic `MOCK=1` mode makes demos reproducible.
- Next steps: calendar integration (auto-brief 1 hour before each meeting), CRM push, NLI entailment checks per claim, and team-shared history.

## 9. Ask / close
- Live demo link, GitHub repo, and a 2-minute video.
- Team: _names and roles_
- *Closing line:* "Don't just be prepared. Be right."
