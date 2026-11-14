# 2-minute demo video script

**Setup before recording:** `pnpm dev`, browser at `/home`. For a live run, set `MOCK=0` with `TAVILY_API_KEY` and Bifrost running, and pick a real company you know had news this month. For a guaranteed run, keep `MOCK=1` and use "Northwind Robotics" (the demo banner stays visible, so viewers know it's fictional). Optionally keep the Bifrost UI (`localhost:8080`) open in a second tab to show request logs.

| Time | On screen | Say |
| --- | --- | --- |
| 0:00–0:12 | Title, then the empty `/home` page | "You have a sales call with Northwind Robotics on Friday. What changed there this month? Groundwork answers that in under a minute, and cites every line." |
| 0:12–0:30 | Type the target, choose Company, set the meeting time, pick **Sales call**, add context ("we sell fleet analytics"), click **Generate brief** | "I give it the company, the meeting time and the purpose. It plans targeted searches for news, launches, exec changes, funding and partnerships, then runs them on Tavily, limited to the 30 days before the meeting." |
| 0:30–0:45 | Progress panel: queries, results → sources, dupes, outside window | "Results are de-duplicated, anything dated outside the window is dropped, and the top sources get full text through Tavily Extract. Then an LLM drafts the brief through the Bifrost gateway." |
| 0:45–1:10 | Brief card: TL;DR, then verified developments; hover an `S3` chip and click through | "TL;DR first. Every claim has a date and source chips. Hover to see the outlet and date, click to open it. Green means verified: two independent outlets, or the company's own press release." |
| 1:10–1:35 | Scroll to **Uncertain / unverified** and point at the 300% line and the CFO line. Expand **Pipeline notes**: "Dropped… S99" | "This is the key part. The model claimed 300% revenue growth, but that number isn't in any source, so it's flagged. The CFO exit comes from one anonymous report, so it's flagged too. And a claim citing a source that doesn't exist was removed completely. The model proposes; our code decides what counts as verified." |
| 1:35–1:50 | Talking points and open questions, then **Copy Markdown** and **Print one-pager** (show the one-page preview) | "You get talking points for a sales call, questions to confirm, and a one-page export for your notes or CRM." |
| 1:50–2:00 | Switch to `/chat`: "Brief me on Dana Whitfield before Tuesday's partnership meeting" | "The same actions power the chat agent, built on Agent-Native. Groundwork: walk in knowing what changed, with a source for every line." |

**Backup lines if a live search is thin:** "Few verified developments is a result too. The agent tells you so instead of padding the page."
