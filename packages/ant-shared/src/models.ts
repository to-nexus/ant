/**
 * Model Registry — the SINGLE source of truth for every LLM model ANT knows.
 *
 * One place declares each model's identity, pricing, context window, and
 * thinking-API behavior. The historically-separate maps are DERIVED from it:
 *   - {@link MODEL_CONTEXT_WINDOWS} (task.ts)  ← entries with a `contextWindow`
 *   - {@link MODEL_RATE_CARD} (pricing.ts)     ← entries with a `rate`
 *   - the `/models` endpoint registry (models.routes.ts) ← `selectable` entries
 *   - {@link AnthropicLLMClient.buildThinkingParams} ← `thinkingMode`
 *   - workspace/project defaults ← {@link DEFAULT_MODELS}
 *
 * Add or swap a model HERE and every consumer follows. This is what lets a
 * future model change be a one-line edit instead of a scatter across ~6 files.
 */

/** Per-model token rates, USD per 1M tokens (MTok), Anthropic public pricing. */
export interface ModelRate {
  /** Fresh (uncached) input tokens. */
  input: number;
  /** Output (completion) tokens. */
  output: number;
  /** Cache write, 5-minute TTL (~1.25x base input). */
  cacheWrite5m: number;
  /** Cache write, 1-hour TTL (~2x base input). */
  cacheWrite1h: number;
  /** Cache read / hit (~0.1x base input). */
  cacheRead: number;
}

/**
 * How a model's thinking is requested on the Anthropic Messages API.
 * - `adaptive`  → `thinking:{type:'adaptive'}` + `output_config.effort`
 *                 (Sonnet 5, Opus 4.6/4.7/4.8, Fable 5). Rejects `budget_tokens`.
 * - `extended`  → legacy `thinking:{type:'enabled', budget_tokens}` (Haiku 4.5).
 * - `none`      → no thinking params (non-Anthropic / image models).
 */
export type ThinkingMode = 'adaptive' | 'extended' | 'none';

/** LLM provider tag — the discriminator every model carries. */
export type ModelProvider = 'anthropic' | 'openai' | 'google' | 'deepseek';

/**
 * Provider → the environment variable that holds its API key. SINGLE owner of
 * this mapping: the LLM factory reads keys through it, and the `/models`
 * endpoint reports which providers are configured through it. Do not re-declare
 * the env names anywhere else.
 */
export const PROVIDER_API_KEY_ENV: Record<ModelProvider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GEMINI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
};

export interface ModelSpec {
  id: string;
  /** Human-readable label shown in the model picker, e.g. "Sonnet 5". */
  displayName: string;
  provider: ModelProvider;
  description?: string;
  /** Highlighted with a ★ in the picker. */
  recommended?: boolean;
  capabilities?: string[];
  /** Context window in tokens. Omit for models that are never sized here. */
  contextWindow?: number;
  /** Token rate card. Omit for models not billed through the credit pipeline. */
  rate?: ModelRate;
  thinkingMode: ThinkingMode;
  /**
   * Whether the model is offered as a NEW choice via the `/models` endpoint.
   * `false` = known/priced/sized for back-compat (existing projects that saved
   * it still work) but no longer selectable. Defaults to `true`.
   */
  selectable?: boolean;
}

/**
 * The registry. Insertion order is the display order in the `/models` list.
 * Anthropic first (selectable defaults), then legacy (hidden), then Gemini.
 */
export const MODEL_REGISTRY: Readonly<Record<string, ModelSpec>> = {
  'claude-sonnet-5': {
    id: 'claude-sonnet-5',
    displayName: 'Sonnet 5',
    provider: 'anthropic',
    description: 'Latest Claude Sonnet — best combination of speed and intelligence',
    recommended: true,
    capabilities: ['coding', 'reasoning', 'large-context'],
    contextWindow: 1_000_000,
    // Standard list price. Introductory $2/$10 runs through 2026-08-31; we bill
    // at standard so cost is never under-attributed (same discipline as the
    // MOST_EXPENSIVE_MODEL_ID fallback in pricing.ts).
    rate: { input: 3, output: 15, cacheWrite5m: 3.75, cacheWrite1h: 6, cacheRead: 0.3 },
    thinkingMode: 'adaptive',
  },
  'claude-opus-4-8': {
    id: 'claude-opus-4-8',
    displayName: 'Opus 4.8',
    provider: 'anthropic',
    description: 'Most capable Claude model, best for complex reasoning',
    recommended: false,
    capabilities: ['coding', 'reasoning', 'large-context', 'complex-analysis'],
    contextWindow: 1_000_000,
    rate: { input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5 },
    thinkingMode: 'adaptive',
  },
  // Legacy — kept so projects that saved this id still price/size correctly and
  // pass the capacity check. Not offered as a new choice. Adaptive thinking is
  // supported on 4.6 and is the forward-recommended mode.
  'claude-sonnet-4-6': {
    id: 'claude-sonnet-4-6',
    displayName: 'Sonnet 4.6',
    provider: 'anthropic',
    description: 'Previous-generation Sonnet (legacy)',
    capabilities: ['coding', 'reasoning', 'large-context'],
    contextWindow: 1_000_000,
    rate: { input: 3, output: 15, cacheWrite5m: 3.75, cacheWrite1h: 6, cacheRead: 0.3 },
    thinkingMode: 'adaptive',
    selectable: false,
  },
  'claude-haiku-4-5-20251001': {
    id: 'claude-haiku-4-5-20251001',
    displayName: 'Haiku 4.5',
    provider: 'anthropic',
    description: 'Fastest model with near-frontier intelligence',
    capabilities: ['fast', 'classification'],
    contextWindow: 200_000,
    rate: { input: 1, output: 5, cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.1 },
    thinkingMode: 'extended',
    selectable: false,
  },
  // DeepSeek — OpenAI-compatible API, reuses OpenAILLMClient with an injected
  // baseURL/provider (LLMClientFactory). Top-tier V4 model; 1M context.
  'deepseek-v4-pro': {
    id: 'deepseek-v4-pro',
    displayName: 'DeepSeek V4 Pro',
    provider: 'deepseek',
    description: 'DeepSeek V4 Pro — top-tier reasoning + coding, 1M context (OpenAI-compatible API)',
    recommended: false,
    capabilities: ['coding', 'reasoning', 'large-context'],
    contextWindow: 1_000_000,
    // Standard (cache-miss) list price — conservative to avoid under-charging.
    // DeepSeek has no separate cache-write fee and the OpenAI stream path does
    // not report cacheCreationTokens, so cacheWrite* mirror input (unused).
    rate: { input: 0.435, output: 0.87, cacheWrite5m: 0.435, cacheWrite1h: 0.435, cacheRead: 0.003625 },
    // Non-Anthropic: never send Anthropic thinking params. DeepSeek's own
    // thinking control is injected separately in OpenAILLMClient (provider gate).
    thinkingMode: 'none',
    selectable: true,
  },
  // Gemini — creator/visual job models. Not billed through MODEL_RATE_CARD.
  // Only the pro (text) model reaches getModelContextWindow; image models go
  // through GeminiImageClient, so they carry no contextWindow.
  'gemini-3.1-pro-preview': {
    id: 'gemini-3.1-pro-preview',
    displayName: 'Gemini 3.1 Pro',
    provider: 'google',
    description: 'Advanced reasoning and prompt engineering for visual jobs',
    recommended: true,
    capabilities: ['reasoning', 'prompt-engineering'],
    contextWindow: 1_000_000,
    thinkingMode: 'none',
  },
  'gemini-3-flash-preview': {
    id: 'gemini-3-flash-preview',
    displayName: 'Gemini 3 Flash',
    provider: 'google',
    description: 'Fast classification and triage for visual jobs',
    recommended: false,
    capabilities: ['fast', 'classification'],
    thinkingMode: 'none',
  },
  'gemini-3-pro-image-preview': {
    id: 'gemini-3-pro-image-preview',
    displayName: 'Gemini 3 Pro Image',
    provider: 'google',
    description: 'High-quality image generation for final renders',
    recommended: true,
    capabilities: ['image-generation', 'high-quality'],
    thinkingMode: 'none',
  },
  'gemini-3.1-flash-image-preview': {
    id: 'gemini-3.1-flash-image-preview',
    displayName: 'Gemini 3.1 Flash Image',
    provider: 'google',
    description: 'Fast image generation for draft exploration',
    recommended: false,
    capabilities: ['image-generation', 'fast'],
    thinkingMode: 'none',
  },
};

/**
 * Default model per job tier — the SSOT the scattered hardcodes collapse into.
 * `AI_MODEL_NAME` env still overrides both at workspace-default time.
 */
export const DEFAULT_MODELS = {
  /** plan / design / code / learn job defaults. */
  sonnetTier: 'claude-sonnet-5',
  /** reviewer / doc defaults + global fallback when nothing else resolves. */
  opusTier: 'claude-opus-4-8',
} as const;

/** Thinking mode for a model id, defaulting to `adaptive` for unknown Anthropic
 * ids (safe for future models — never re-introduces the rejected `budget_tokens`
 * shape) and `none` otherwise. */
export function getThinkingMode(modelId: string): ThinkingMode {
  const spec = MODEL_REGISTRY[modelId];
  if (spec) return spec.thinkingMode;
  return modelId.startsWith('claude-') ? 'adaptive' : 'none';
}
