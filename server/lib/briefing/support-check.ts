/**
 * Optional semantic support check (VERIFY_LLM=1). One batched call to a cheap, fast model
 * via Bifrost asks, for every TL;DR bullet and claim, which of its cited sources actually
 * support it. Verdicts only ever REMOVE citations; the code still decides "verified".
 * Any failure (gateway down, bad JSON, timeout) is a warning and the lexical guard alone applies.
 */
import type { Source } from "../../../shared/briefing/schema";
import type { BriefingConfig } from "./config";
import { openAiCompatible, parseJsonLoose } from "./llm";
import type { Draft } from "./synthesize";

export interface SupportCheckResult {
  /** item key ("claim:3", "tldr:0") -> source ids judged NOT supporting it */
  unsupported: Map<string, Set<string>>;
  checked: number;
  model: string;
}

export async function llmSupportCheck(
  cfg: BriefingConfig,
  draft: Draft,
  sources: Source[],
  warnings: string[],
): Promise<SupportCheckResult | null> {
  if (!cfg.verifyLlm || !cfg.bifrostUrl) return null;
  const byId = new Map(sources.map((s) => [s.id, s]));
  const items: Array<{ key: string; text: string; ids: string[] }> = [];
  const add = (prefix: string, arr: Array<{ text: string; sourceIds?: string[] | undefined }> | undefined) =>
    (arr ?? []).forEach((x, i) => {
      const ids = [...new Set((x.sourceIds ?? []).map((s) => String(s).trim().toUpperCase()))].filter((s) => byId.has(s));
      if (x.text?.trim() && ids.length) items.push({ key: `${prefix}:${i}`, text: x.text.trim(), ids });
    });
  add("tldr", draft.tldr);
  add("claim", draft.claims);
  if (!items.length) return null;

  const usedIds = [...new Set(items.flatMap((x) => x.ids))];
  const srcBlock = usedIds
    .map((id) => {
      const s = byId.get(id)!;
      return `[${id}] ${s.title} (${s.domain})\n${(s.origin === "site" ? s.content || s.snippet : `${s.snippet} ${s.content ?? ""}`).replace(/\s+/g, " ").slice(0, cfg.verifyLlmSourceChars)}`;
    })
    .join("\n\n");
  const itemBlock = items.map((x) => `${x.key} | cites ${x.ids.join(",")} | ${x.text}`).join("\n");
  const messages = [
    {
      role: "system" as const,
      content:
        'You are a strict fact-checker. For each statement, decide which of ITS cited sources directly support it (same subject company/person, and the key facts, names and numbers appear). A source about a different company, or that only mentions the subject in passing, does NOT support it. Excerpts are partial: judge whether the source is about the same event and states its core fact; do not reject only because a minor detail (exact date wording, a secondary list item) is not in the excerpt. Return ONLY JSON: {"results":[{"key":string,"supported":[sourceId]}]} with one entry per statement.',
    },
    { role: "user" as const, content: `SOURCES:\n\n${srcBlock}\n\nSTATEMENTS (key | cites | text):\n${itemBlock}` },
  ];
  try {
    const { text, servedBy } = await openAiCompatible(
      cfg.bifrostUrl,
      undefined,
      cfg.verifyLlmModel,
      messages,
      cfg.verifyLlmTimeoutMs,
      cfg.bifrostApiKey ? { "x-bf-vk": cfg.bifrostApiKey } : {},
    );
    const parsed = parseJsonLoose(text) as { results?: Array<{ key?: string; supported?: string[] }> };
    const verdicts = new Map((parsed.results ?? []).map((r) => [String(r.key), new Set((r.supported ?? []).map((s) => String(s).toUpperCase()))]));
    const unsupported = new Map<string, Set<string>>();
    for (const it of items) {
      const v = verdicts.get(it.key);
      if (!v) continue; // no verdict -> do not punish
      const bad = it.ids.filter((id) => !v.has(id));
      if (bad.length) unsupported.set(it.key, new Set(bad));
    }
    return { unsupported, checked: items.length, model: servedBy ?? cfg.verifyLlmModel };
  } catch (e) {
    warnings.push(`LLM support check skipped (${(e as Error).message.slice(0, 160)}); lexical citation guard only.`);
    return null;
  }
}
