# Groundwork evaluation

Meeting: 2026-11-20T15:00:00-08:00 (sales call), 30-day window. Raw briefs: `docs/eval/<company>.json` / `.md`.

| Company | Sources found | Cited | Verified | Uncertain | Dropped claims | Citations removed | Newsroom pages (Map) | Tavily credits | Seconds | Model that served |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Snowflake | 40 | 8 | 4 | 5 | 1 | 0 | 0 | 15 | 42.1 | groq/openai/gpt-oss-120b |
| Databricks | 40 | 6 | 3 | 2 | 0 | 0 | 4 | 21 | 14.9 | groq/openai/gpt-oss-120b |
| Anthropic | 40 | 9 | 4 | 6 | 0 | 0 | 2 | 17 | 11.7 | groq/openai/gpt-oss-120b |
| Stripe | 40 | 7 | 4 | 3 | 0 | 0 | 4 | 21 | 17.7 | groq/openai/gpt-oss-120b |
| Figma | 40 | 10 | 3 | 6 | 1 | 0 | 0 | 15 | 15.3 | groq/openai/gpt-oss-120b |
| Stripe (nemotron-llm-check) | 40 | 8 | 1 | 6 | 0 | 5 | 4 | 21 | 57.8 | nvidia/nvidia/nemotron-3-ultra-550b-a55b + LLM check |

## Interpretation and reproduction

These are recorded pipeline runs, not a benchmark against independently labeled answers. “Verified” and “uncertain” are the pipeline's own classifications; they do not establish factual accuracy, citation support, or precision and recall. Timings and credit use are observations from these runs, not guarantees. Review the cited sources before relying on a brief.

To run another live evaluation, configure Tavily and the desired model backend as described in the README and export the environment variables to the shell. Then run:

```bash
MOCK=0 pnpm exec tsx scripts/eval-briefs.ts "Stripe" stripe.com example-2
pnpm exec tsx scripts/eval-briefs.ts --table
```

The first command performs live API calls, appends a row to `results.jsonl`, and overwrites the brief files for the same company and tag. Omit the optional tag or replace it with a distinct tag. The second regenerates this table from all rows. `EVAL_MEETING` overrides the meeting time; the table heading reflects the value used when rebuilding, while each JSONL row records its own meeting time. Runs can differ as source content, provider behavior, and model outputs change.
