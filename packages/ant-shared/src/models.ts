/**
 * Model Registry — the SINGLE source of truth for every LLM model ANT knows.
 *
 * One place declares each model's identity, pricing, context window, and
 * thinking-API behavior. The historically-separate maps are DERIVED from it:
 *   - {@link MODEL_CONTEXT_WINDOWS} (task.ts)  ← entries with a `contextWindow`
 *   - {@link MODEL_RATE_CARD} (pricing.ts)     ← entries with a `rate`
 *   - the `/models` endpoint registry (models.routes.ts) ← `selectable` entries
 *   - {@link AnthropicLLMClient.buildThinkingParams} ← `thinkingMode`
 *   - built-in per-tier defaults ← {@link DEFAULT_MODELS} (via `tier`); the EFFECTIVE
 *     defaults add env pins on top in `ant-cli/src/core/config/defaultModels.ts`
 *
 * Add or swap a model HERE and every consumer follows. This is what lets a
 * future model change be a one-line edit instead of a scatter across ~6 files.
 */

/** Per-model token rates, USD per 1M tokens (MTok), provider public list price. */
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
 *                 (Sonnet 5, Opus 5, Fable 5). Rejects `budget_tokens`.
 * - `extended`  → legacy `thinking:{type:'enabled', budget_tokens}` (Haiku 4.5).
 * - `none`      → no thinking params (non-Anthropic / image models).
 */
export type ThinkingMode = 'adaptive' | 'extended' | 'none';

/** LLM provider tag — the discriminator every model carries. */
export type ModelProvider = 'anthropic' | 'openai' | 'google' | 'deepseek' | 'glm' | 'kimi';

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
  glm: 'GLM_API_KEY',
  kimi: 'KIMI_API_KEY',
};

/**
 * Providers whose selection is gated behind an in-app data-privacy consent notice
 * (third-party, China-hosted). SINGLE owner of this policy — the config picker reads
 * it through {@link providerRequiresDataConsent} instead of hardcoding provider ids.
 */
export const PROVIDER_REQUIRES_DATA_CONSENT: ReadonlySet<ModelProvider> = new Set([
  'deepseek',
  'glm',
  'kimi',
]);

/** Whether selecting a model from `provider` must pass the data-consent gate. */
export function providerRequiresDataConsent(provider: ModelProvider | undefined): boolean {
  return !!provider && PROVIDER_REQUIRES_DATA_CONSENT.has(provider);
}

/**
 * Provider → its public pricing page (normalized). SINGLE owner of this mapping.
 * Surfaced per model on the pricing matrix so the applied unit prices are
 * traceable to the provider's own list, and so a future remote-fetch pricing
 * adapter has a canonical source URL to normalize against (rather than each
 * caller hardcoding a link). Rates themselves still live on `ModelSpec.rate`.
 */
export const PROVIDER_PRICING_URL: Record<ModelProvider, string> = {
  anthropic: 'https://www.anthropic.com/pricing',
  openai: 'https://openai.com/api/pricing/',
  google: 'https://ai.google.dev/gemini-api/docs/pricing',
  deepseek: 'https://api-docs.deepseek.com/quick_start/pricing',
  glm: 'https://z.ai/model-api',
  kimi: 'https://platform.kimi.ai/docs/pricing/chat-k3',
};

export interface ModelSpec {
  id: string;
  /** Human-readable label shown in the model picker, e.g. "Sonnet 5". */
  displayName: string;
  provider: ModelProvider;
  /**
   * This model's family within its provider, abstracted ABOVE version — `opus`
   * means "the Opus-class Anthropic model, whatever version". `(provider, tier)`
   * is unique across the registry and is the key operators pin by env
   * (`ANT_DEFAULT_MODEL_<PROVIDER>_<TIER>`), so swapping Opus 5 → Opus 5.1 is a
   * config change rather than a code change. Tier names are provider-native: a
   * tier NEVER represents another provider's model.
   */
  tier: string;
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
   * Which OpenAI API surface this model speaks. `'responses'` routes the
   * factory to `OpenAIResponsesLLMClient` (reasoning items, `max_output_tokens`,
   * event-protocol streaming); omitted/`'chat'` keeps the Chat Completions
   * client shared with DeepSeek / GLM / Kimi. Meaningless for non-OpenAI
   * providers. SSOT for the dispatch — never re-derive it from the model name.
   */
  apiSurface?: 'chat' | 'responses';
  /**
   * Output ceiling in tokens, INCLUDING reasoning tokens on reasoning models.
   * The Responses client clamps `max_output_tokens` to it after adding the
   * reasoning reserve, so a large requested budget can never exceed what the
   * model accepts. Omit when the model is never sized here.
   */
  maxOutputTokens?: number;
  /**
   * `false` = never send `temperature` for this model. GPT-5-class reasoning
   * models reject it; the same discipline Anthropic adaptive models follow
   * (see AnthropicLLMClient.buildSamplingParams). Defaults to `true`.
   */
  supportsTemperature?: boolean;
  /**
   * Adaptive models only: `true` = the API rejects an explicit
   * `thinking:{type:'disabled'}` with a 400 (Fable-class — thinking is always
   * on). Sonnet 5 / Opus 5 accept `disabled` (Opus 5 at effort ≤ high, which
   * holds when `output_config` is omitted), so they leave this unset.
   * Consumed via {@link canDisableThinking}.
   */
  rejectsDisabledThinking?: boolean;
  /**
   * Whether the model is offered as a NEW choice via the `/models` endpoint.
   * `false` = known/priced/sized for back-compat (existing projects that saved
   * it still work) but no longer selectable. Defaults to `true`.
   */
  selectable?: boolean;
  /**
   * How this model's wire protocol delivers tool-call arguments (UX policy
   * SSOT for live file rendering — render policy reads THIS, never the
   * provider name):
   *   - 'incremental': argument JSON streams as fragments (Anthropic
   *     input_json_delta, OpenAI-compat tool_calls / function_call_arguments
   *     deltas) → live file-card rendering.
   *   - 'complete': arguments arrive whole (Gemini functionCall.args) →
   *     terminal-only rendering; binding such a model to a file-writing
   *     execute node logs a one-time warning.
   * Omitted = derived from provider via {@link getToolArgStreaming}
   * ('complete' for google, 'incremental' otherwise).
   */
  toolArgStreaming?: 'incremental' | 'complete';
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
    tier: 'sonnet',
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
  'claude-opus-5': {
    id: 'claude-opus-5',
    displayName: 'Opus 5',
    provider: 'anthropic',
    tier: 'opus',
    description: 'Most capable Claude model for complex agentic coding and reasoning',
    recommended: false,
    capabilities: ['coding', 'reasoning', 'large-context', 'complex-analysis'],
    contextWindow: 1_000_000,
    rate: { input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5 },
    thinkingMode: 'adaptive',
  },
  // Latest Haiku — fastest Anthropic tier, offered as a selectable choice. No job
  // default binds to it today (learn uses sonnet), but it stays env-pinnable like
  // any other tier. Haiku 4.5 uses legacy `budget_tokens` thinking (`extended`),
  // not adaptive — do not switch this to `adaptive`.
  'claude-haiku-4-5-20251001': {
    id: 'claude-haiku-4-5-20251001',
    displayName: 'Haiku 4.5',
    provider: 'anthropic',
    tier: 'haiku',
    description: 'Fastest model with near-frontier intelligence',
    capabilities: ['fast', 'classification'],
    contextWindow: 200_000,
    rate: { input: 1, output: 5, cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.1 },
    thinkingMode: 'extended',
  },
  // OpenAI GPT-5.6 — spoken over the RESPONSES API (`apiSurface: 'responses'`),
  // not Chat Completions: only that surface returns reasoning items whose
  // encrypted content can be replayed across tool-call rounds. Reasoning depth
  // is requested via `reasoning.effort` (never Anthropic thinking params, hence
  // thinkingMode 'none'), and `temperature` is not accepted by this class of
  // model. OpenAI has no separate cache-write fee and the Responses usage object
  // reports no cacheCreationTokens, so cacheWrite* mirror input (inert) — same
  // rationale as the DeepSeek / GLM / Kimi entries below. `cacheRead` is the
  // cached-input list price.
  'gpt-5.6-sol': {
    id: 'gpt-5.6-sol',
    displayName: 'GPT-5.6 Sol',
    provider: 'openai',
    tier: 'sol',
    description: 'OpenAI frontier model for complex professional work — 1.05M context (Responses API)',
    recommended: false,
    capabilities: ['coding', 'reasoning', 'large-context', 'complex-analysis'],
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    rate: { input: 5, output: 30, cacheWrite5m: 5, cacheWrite1h: 5, cacheRead: 0.5 },
    thinkingMode: 'none',
    apiSurface: 'responses',
    supportsTemperature: false,
    selectable: true,
  },
  'gpt-5.6-terra': {
    id: 'gpt-5.6-terra',
    displayName: 'GPT-5.6 Terra',
    provider: 'openai',
    tier: 'terra',
    description: 'OpenAI balanced tier — intelligence vs cost, 1.05M context (Responses API)',
    recommended: false,
    capabilities: ['coding', 'reasoning', 'large-context'],
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    rate: { input: 2, output: 12, cacheWrite5m: 2, cacheWrite1h: 2, cacheRead: 0.2 },
    thinkingMode: 'none',
    apiSurface: 'responses',
    supportsTemperature: false,
    selectable: true,
  },
  'gpt-5.6-luna': {
    id: 'gpt-5.6-luna',
    displayName: 'GPT-5.6 Luna',
    provider: 'openai',
    tier: 'luna',
    description: 'OpenAI cost-optimized tier — fast classification and triage, 1.05M context (Responses API)',
    recommended: false,
    capabilities: ['fast', 'classification', 'coding', 'large-context'],
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    rate: { input: 0.2, output: 1.2, cacheWrite5m: 0.2, cacheWrite1h: 0.2, cacheRead: 0.02 },
    thinkingMode: 'none',
    apiSurface: 'responses',
    supportsTemperature: false,
    selectable: true,
  },
  // DeepSeek — OpenAI-compatible API, reuses OpenAILLMClient with an injected
  // baseURL/provider (LLMClientFactory). Top-tier V4 model; 1M context.
  'deepseek-v4-pro': {
    id: 'deepseek-v4-pro',
    displayName: 'DeepSeek V4 Pro',
    provider: 'deepseek',
    tier: 'pro',
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
  'deepseek-v4-flash': {
    id: 'deepseek-v4-flash',
    displayName: 'DeepSeek V4 Flash',
    provider: 'deepseek',
    tier: 'flash',
    description: 'DeepSeek V4 Flash — fast, low-cost reasoning + coding, 1M context (OpenAI-compatible API)',
    recommended: false,
    capabilities: ['fast', 'coding', 'reasoning', 'large-context'],
    contextWindow: 1_000_000,
    // Standard (cache-miss) list price from api-docs.deepseek.com/quick_start/pricing.
    // As with Pro: no separate cache-write fee and the OpenAI stream path does not
    // report cacheCreationTokens, so cacheWrite* mirror input (unused).
    rate: { input: 0.14, output: 0.28, cacheWrite5m: 0.14, cacheWrite1h: 0.14, cacheRead: 0.0028 },
    thinkingMode: 'none',
    selectable: true,
  },
  // GLM (Zhipu / Z.ai) — OpenAI-compatible API (api.z.ai, single Bearer token),
  // reuses OpenAILLMClient with an injected baseURL/provider (LLMClientFactory).
  // Premium flagship; 1M context. Thinking is handled by the OpenAI client provider
  // gate (thinking:{type:'enabled'}), so thinkingMode stays 'none' here.
  'glm-5.2': {
    id: 'glm-5.2',
    displayName: 'GLM-5.2',
    provider: 'glm',
    tier: 'flagship',
    description: 'GLM-5.2 — Zhipu flagship, top-tier coding + agentic reasoning, 1M context (OpenAI-compatible API)',
    recommended: false,
    capabilities: ['coding', 'reasoning', 'large-context'],
    contextWindow: 1_000_000,
    // Z.ai first-party list price (USD/MTok). No separate cache-write fee and the
    // OpenAI stream path does not report cacheCreationTokens, so cacheWrite* mirror
    // input (unused) — same rationale as the DeepSeek entries.
    rate: { input: 1.4, output: 4.4, cacheWrite5m: 1.4, cacheWrite1h: 1.4, cacheRead: 0.26 },
    thinkingMode: 'none',
    selectable: true,
  },
  'glm-4.7': {
    id: 'glm-4.7',
    displayName: 'GLM-4.7',
    provider: 'glm',
    tier: 'fast',
    description: 'GLM-4.7 — cost-effective coding + multi-step reasoning, 200K context (OpenAI-compatible API)',
    recommended: false,
    capabilities: ['fast', 'coding', 'reasoning'],
    contextWindow: 200_000,
    rate: { input: 0.6, output: 2.2, cacheWrite5m: 0.6, cacheWrite1h: 0.6, cacheRead: 0.11 },
    thinkingMode: 'none',
    selectable: true,
  },
  // Kimi (Moonshot AI) — OpenAI-compatible API (api.moonshot.ai/v1, single Bearer
  // token), reuses OpenAILLMClient with an injected baseURL/provider (LLMClientFactory).
  // China-hosted, so gated behind the data-consent notice (PROVIDER_REQUIRES_DATA_CONSENT).
  // No separate cache-write fee and the OpenAI stream path does not report
  // cacheCreationTokens, so cacheWrite* mirror input (unused) — same rationale as the
  // DeepSeek/GLM entries. thinkingMode stays 'none' (no Anthropic thinking params).
  'kimi-k3': {
    id: 'kimi-k3',
    displayName: 'Kimi K3',
    provider: 'kimi',
    tier: 'flagship',
    description: 'Kimi K3 — Moonshot flagship, long-horizon coding + agentic reasoning, 1M context (OpenAI-compatible API)',
    recommended: false,
    capabilities: ['coding', 'reasoning', 'large-context'],
    contextWindow: 1_048_576,
    // platform.kimi.ai list price (USD/MTok). cacheRead = cache-hit input price.
    rate: { input: 3, output: 15, cacheWrite5m: 3, cacheWrite1h: 3, cacheRead: 0.3 },
    thinkingMode: 'none',
    selectable: true,
  },
  'kimi-k2.7-code': {
    id: 'kimi-k2.7-code',
    displayName: 'Kimi K2.7 Code',
    provider: 'kimi',
    tier: 'code',
    description: 'Kimi K2.7 Code — cost-effective coding model, 256K context (OpenAI-compatible API)',
    recommended: false,
    capabilities: ['coding', 'fast'],
    contextWindow: 262_144,
    // platform.kimi.ai list price (USD/MTok). cacheRead = cache-hit input price.
    rate: { input: 0.95, output: 4, cacheWrite5m: 0.95, cacheWrite1h: 0.95, cacheRead: 0.19 },
    thinkingMode: 'none',
    selectable: true,
  },
  'kimi-k2.7-code-highspeed': {
    id: 'kimi-k2.7-code-highspeed',
    displayName: 'Kimi K2.7 Code (High-speed)',
    provider: 'kimi',
    tier: 'codeHighspeed',
    description: 'Kimi K2.7 Code high-speed variant — ~180 tok/s output, 256K context (OpenAI-compatible API)',
    recommended: false,
    capabilities: ['coding', 'fast'],
    contextWindow: 262_144,
    // platform.kimi.ai list price (USD/MTok) — 2x the standard code variant. cacheRead = cache-hit input price.
    rate: { input: 1.9, output: 8, cacheWrite5m: 1.9, cacheWrite1h: 1.9, cacheRead: 0.38 },
    thinkingMode: 'none',
    selectable: true,
  },
  // Gemini — creator/visual job models. All four are billed through MODEL_RATE_CARD.
  // TEXT models (pro / flash) price input/output normally. IMAGE models emit their
  // render as OUTPUT tokens (GeminiImageClient maps candidatesTokenCount→outputTokens),
  // which Google bills at a special "image output" rate — so their `output` rate is
  // that image-output price (Google per-image cost expressed per output token).
  //
  // Context-tier note: Gemini 3.x text pricing is context-tiered (≤200K vs >200K:
  // Pro $2/$12 → $4/$18, cache-read −90%). ANT registers the ≤200K tier flat —
  // these models only do image-prompt engineering / triage (small prompts, always
  // ≪200K), and the whole rate card is flat per-model (Claude 1M models are billed
  // the same way). True per-call context tiering would require per-call cost
  // accumulation (billing prices the SUMMED per-model aggregate, so a tier picked
  // from the sum would misprice) — a cross-cutting change, not a Gemini special-case.
  'gemini-3.1-pro-preview': {
    id: 'gemini-3.1-pro-preview',
    displayName: 'Gemini 3.1 Pro',
    provider: 'google',
    tier: 'pro',
    description: 'Advanced reasoning and prompt engineering for visual jobs',
    recommended: true,
    capabilities: ['reasoning', 'prompt-engineering'],
    contextWindow: 1_000_000,
    // ≤200K tier (Google list price). >200K tier is $4 / $18 / cacheRead $0.40.
    // Gemini caching is not used by ANT (no cacheCreation reported), so cacheWrite*
    // are inert and mirror input; cacheRead is the −90% hit rate if ever reported.
    rate: { input: 2, output: 12, cacheWrite5m: 2, cacheWrite1h: 2, cacheRead: 0.2 },
    thinkingMode: 'none',
  },
  'gemini-3-flash': {
    id: 'gemini-3-flash',
    displayName: 'Gemini 3 Flash',
    provider: 'google',
    tier: 'flash',
    description: 'Fast classification and triage for visual jobs',
    recommended: false,
    capabilities: ['fast', 'classification'],
    // Google list price (text/image/video input tier). cacheRead is the −90% hit
    // rate; cacheWrite* inert (Gemini caching unused). Audio-input tier ($1 in) is
    // not registered — visual jobs never send audio.
    rate: { input: 0.5, output: 3, cacheWrite5m: 0.5, cacheWrite1h: 0.5, cacheRead: 0.05 },
    thinkingMode: 'none',
  },
  'gemini-3-pro-image': {
    id: 'gemini-3-pro-image',
    displayName: 'Gemini 3 Pro Image (Nano Banana Pro)',
    provider: 'google',
    tier: 'proImage',
    description: 'High-quality image generation for final renders',
    recommended: true,
    capabilities: ['image-generation', 'high-quality'],
    // Google list price. `output` is the image-output token rate ($120/MTok) — the
    // render is billed as output tokens. Cache fields inert (image path reports no
    // cache tokens); kept for shape consistency.
    rate: { input: 2, output: 120, cacheWrite5m: 0.375, cacheWrite1h: 0.375, cacheRead: 0.2 },
    thinkingMode: 'none',
  },
  'gemini-3.1-flash-image': {
    id: 'gemini-3.1-flash-image',
    displayName: 'Gemini 3.1 Flash Image (Nano Banana 2)',
    provider: 'google',
    tier: 'flashImage',
    description: 'Fast image generation for draft exploration',
    recommended: false,
    capabilities: ['image-generation', 'fast'],
    // Google list price. `output` is the image-output token rate ($60/MTok). Cache
    // fields inert (image path reports no cache tokens); mirror input for shape.
    rate: { input: 0.5, output: 60, cacheWrite5m: 0.5, cacheWrite1h: 0.5, cacheRead: 0.05 },
    thinkingMode: 'none',
  },
};

/** provider → tier → model id. */
export type ModelTierMap = Readonly<Record<ModelProvider, Readonly<Record<string, string>>>>;

/**
 * Built-in default model per (provider, tier), DERIVED from {@link MODEL_REGISTRY} —
 * registering a model is the only way to declare a tier, so there is no second table
 * to forget a provider in.
 *
 * This map is deliberately code-owned and NOT env-configurable: which concrete id an
 * abstract tier points at changes when a provider ships a model, which is a code
 * update. What operators configure by env is the other direction — which (provider,
 * tier) each job/node default BINDS to — and that lives in
 * `ant-cli/src/core/config/defaultModels.ts`.
 */
function buildDefaultModels(registry: Readonly<Record<string, ModelSpec>>): ModelTierMap {
  const out = {} as Record<ModelProvider, Record<string, string>>;
  for (const spec of Object.values(registry)) {
    const byTier = (out[spec.provider] ??= {});
    const existing = byTier[spec.tier];
    if (existing) {
      // Last-wins would make the default silently depend on registry key order.
      throw new Error(
        `MODEL_REGISTRY: duplicate tier "${spec.provider}.${spec.tier}" ` +
          `(${existing} and ${spec.id}) — a tier identifies one model per provider.`,
      );
    }
    byTier[spec.tier] = spec.id;
  }
  return out;
}

export const DEFAULT_MODELS: ModelTierMap = buildDefaultModels(MODEL_REGISTRY);

/** Thinking mode for a model id, defaulting to `adaptive` for unknown Anthropic
 * ids (safe for future models — never re-introduces the rejected `budget_tokens`
 * shape) and `none` otherwise. */
export function getThinkingMode(modelId: string): ThinkingMode {
  const spec = MODEL_REGISTRY[modelId];
  if (spec) return spec.thinkingMode;
  return modelId.startsWith('claude-') ? 'adaptive' : 'none';
}

/**
 * Whether an explicit `thinking:{type:'disabled'}` is a legal wire shape for
 * this model. Unknown ids default to `true`: if a future Fable-class model
 * slips through unregistered, the resulting 400 is a VISIBLE failure that
 * falls back immediately — strictly better diagnostics than the silent
 * thinking-starvation (all of max_tokens consumed by thinking, zero text
 * blocks) that motivated this helper. Register such models with
 * `rejectsDisabledThinking: true`.
 */
export function canDisableThinking(modelId: string): boolean {
  return MODEL_REGISTRY[modelId]?.rejectsDisabledThinking !== true;
}

/**
 * Tool-call argument streaming capability for a model id (UX policy SSOT —
 * decides live vs terminal-only file-card rendering; see ModelSpec.toolArgStreaming).
 *
 * Resolution: explicit spec field → provider derivation (google = complete,
 * everything else = incremental) → unknown ids fall back by name prefix.
 */
export function getToolArgStreaming(modelId: string): 'incremental' | 'complete' {
  const spec = MODEL_REGISTRY[modelId];
  if (spec?.toolArgStreaming) return spec.toolArgStreaming;
  const provider = spec?.provider ?? (modelId.startsWith('gemini') ? 'google' : undefined);
  return provider === 'google' ? 'complete' : 'incremental';
}
