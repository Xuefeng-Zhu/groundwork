/**
 * Model gateway. Primary path is Bifrost (Maxim AI's OpenAI-compatible LLM gateway),
 * which gives us provider failover, caching, budgets and observability for free.
 * Falls back to direct OpenAI, then Anthropic, when Bifrost is not configured or fails.
 */
import type { BriefingConfig } from "./config";

export type LlmProvider = "bifrost" | "openai" | "anthropic";

export interface LlmResult {
  provider: LlmProvider;
  model: string;
  text: string;
}

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fn(ctrl.signal);
  } finally {
    clearTimeout(t);
  }
}

export async function openAiCompatible(
  baseUrl: string,
  apiKey: string | undefined,
  model: string,
  messages: ChatMessage[],
  timeoutMs: number,
  extraHeaders: Record<string, string> = {},
  extraBody: Record<string, unknown> = {},
): Promise<{ text: string; servedBy?: string | undefined }> {
  return withTimeout(timeoutMs, async (signal) => {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...extraHeaders,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.1,
        response_format: { type: "json_object" },
        ...extraBody,
      }),
      signal,
    });
    if (!res.ok) throw new Error(`${baseUrl} ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as {
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
      extra_fields?: { provider?: string };
    };
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error("Empty completion");
    // Bifrost reports which provider actually answered (after any failover).
    const servedBy = data.extra_fields?.provider && data.model ? `${data.extra_fields.provider}/${data.model}` : undefined;
    return { text, servedBy };
  });
}

async function anthropic(
  key: string,
  model: string,
  messages: ChatMessage[],
  timeoutMs: number,
): Promise<string> {
  return withTimeout(timeoutMs, async (signal) => {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 4000,
        temperature: 0.1,
        system,
        messages: messages
          .filter((m) => m.role === "user")
          .map((m) => ({ role: "user", content: m.content })),
      }),
      signal,
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = data.content?.find((c) => c.type === "text")?.text;
    if (!text) throw new Error("Empty completion");
    return text;
  });
}

/** Try each configured provider in order; collect errors as warnings. */
export async function completeJson(
  cfg: BriefingConfig,
  messages: ChatMessage[],
  warnings: string[],
): Promise<LlmResult | null> {
  if (cfg.bifrostUrl) {
    try {
      const { text, servedBy } = await openAiCompatible(
        cfg.bifrostUrl,
        undefined, // provider keys live inside Bifrost; optional virtual key below
        cfg.bifrostModel,
        messages,
        cfg.llmTimeoutMs,
        cfg.bifrostApiKey ? { "x-bf-vk": cfg.bifrostApiKey } : {},
        // Bifrost-native failover: tried in order if the primary model errors or is rate-limited.
        cfg.bifrostFallbacks.length ? { fallbacks: cfg.bifrostFallbacks } : {},
      );
      if (servedBy && servedBy !== cfg.bifrostModel) {
        warnings.push(`Bifrost failed over from ${cfg.bifrostModel} to ${servedBy}.`);
      }
      return { provider: "bifrost", model: servedBy ?? cfg.bifrostModel, text };
    } catch (e) {
      warnings.push(`Bifrost call failed (${(e as Error).message}); trying direct provider.`);
    }
  }
  if (cfg.openaiKey) {
    try {
      const { text } = await openAiCompatible(cfg.openaiBaseUrl, cfg.openaiKey, cfg.openaiModel, messages, cfg.llmTimeoutMs);
      return { provider: "openai", model: cfg.openaiModel, text };
    } catch (e) {
      warnings.push(`OpenAI call failed (${(e as Error).message}).`);
    }
  }
  if (cfg.anthropicKey) {
    try {
      const text = await anthropic(cfg.anthropicKey, cfg.anthropicModel, messages, cfg.llmTimeoutMs);
      return { provider: "anthropic", model: cfg.anthropicModel, text };
    } catch (e) {
      warnings.push(`Anthropic call failed (${(e as Error).message}).`);
    }
  }
  return null;
}

/** Parse a JSON object from a model reply, tolerating ```json fences or leading prose. */
export function parseJsonLoose(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced?.[1] ?? text;
  try {
    return JSON.parse(body);
  } catch {
    const s = body.indexOf("{");
    const e = body.lastIndexOf("}");
    if (s >= 0 && e > s) return JSON.parse(body.slice(s, e + 1));
    throw new Error("Model reply was not JSON");
  }
}
