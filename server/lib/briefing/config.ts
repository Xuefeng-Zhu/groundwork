/**
 * Runtime configuration, read from environment variables (deploy-level config).
 * No key is ever hardcoded; missing keys degrade gracefully (see README).
 */
export interface BriefingConfig {
  mock: boolean;
  tavilyKey?: string | undefined;
  tavilyExtractTop: number;
  tavilyBaseUrl: string;
  bifrostUrl?: string | undefined;
  bifrostApiKey?: string | undefined;
  bifrostModel: string;
  openaiKey?: string | undefined;
  openaiBaseUrl: string;
  openaiModel: string;
  anthropicKey?: string | undefined;
  anthropicModel: string;
  llmTimeoutMs: number;
  /** Prompt budget: how many sources, and how many characters of each, go to the model. Lower for small free tiers (e.g. Groq 8k TPM). */
  llmMaxSources: number;
  llmSourceChars: number;
}

function truthy(v: string | undefined): boolean {
  return !!v && ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function clean(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

export function getConfig(env: NodeJS.ProcessEnv = process.env): BriefingConfig {
  return {
    mock: truthy(env.MOCK),
    tavilyKey: clean(env.TAVILY_API_KEY),
    tavilyExtractTop: Number(env.TAVILY_EXTRACT_TOP ?? 4) || 0,
    tavilyBaseUrl: (clean(env.TAVILY_BASE_URL) ?? "https://api.tavily.com").replace(/\/+$/, ""),
    bifrostUrl: clean(env.BIFROST_URL)?.replace(/\/+$/, ""),
    bifrostApiKey: clean(env.BIFROST_API_KEY),
    bifrostModel: clean(env.BIFROST_MODEL) ?? "openai/gpt-4o-mini",
    openaiKey: clean(env.OPENAI_API_KEY),
    // When the in-app chat is pointed at Bifrost via OPENAI_BASE_URL we reuse it.
    openaiBaseUrl: (clean(env.OPENAI_DIRECT_BASE_URL) ?? "https://api.openai.com/v1").replace(/\/+$/, ""),
    openaiModel: clean(env.OPENAI_MODEL) ?? "gpt-4o-mini",
    anthropicKey: clean(env.ANTHROPIC_API_KEY),
    anthropicModel: clean(env.ANTHROPIC_MODEL) ?? "claude-sonnet-4-5",
    llmTimeoutMs: Number(env.LLM_TIMEOUT_MS ?? 60000) || 60000,
    llmMaxSources: Number(env.LLM_MAX_SOURCES ?? 30) || 30,
    llmSourceChars: Number(env.LLM_SOURCE_CHARS ?? 1400) || 1400,
  };
}

export function describeConfig(c: BriefingConfig) {
  return {
    mock: c.mock,
    search: c.mock ? "mock" : c.tavilyKey ? "tavily" : "missing",
    llmChain: c.mock
      ? ["mock"]
      : [
          ...(c.bifrostUrl ? [`bifrost:${c.bifrostModel}`] : []),
          ...(c.openaiKey ? [`openai:${c.openaiModel}`] : []),
          ...(c.anthropicKey ? [`anthropic:${c.anthropicModel}`] : []),
          "heuristic",
        ],
  } as const;
}
