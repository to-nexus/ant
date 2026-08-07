/**
 * AnthropicLLMClient
 * 
 * Direct Anthropic SDK integration for advanced features like thinking blocks.
 */

// @ts-ignore
import Anthropic from '@anthropic-ai/sdk';
import { getLLMDispatcher } from './llmDispatcher';
import {
  LLMClient, LLMStreamEvent, ToolDefinition, LLMInvokeResult,
  CacheableContent, MessageContentBlock,
  TextContentBlock, ImageContentBlock, ToolUseContentBlock, ToolResultContentBlock, ThinkingContentBlock,
  resolveToolChoice,
} from '../../../core/ports/llm';
import { TaskTokenUsage } from '../../../core/types/task';
import { withRetryStream, withRetry, streamAttemptWithIdleAbort } from '../../../core/utils/retry';
import { sanitizeMessages } from '../../../core/utils/sanitizeMessages';
import { isReasoningEnvelope } from '../../../core/llm/reasoningEnvelope';
import { getModelContextWindow, getThinkingMode, canDisableThinking } from '@ant/shared';

/**
 * Anthropic Messages API accepted content block shapes.
 * Used as the conversion target in convertBlock() to ensure
 * only API-permitted fields are sent (whitelist approach).
 */
type CacheControl = { type: 'ephemeral' };

type AnthropicSubBlock =
  | { type: 'text'; text: string; cache_control?: CacheControl }
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; data: string }; cache_control?: CacheControl };

type AnthropicBlock =
  | AnthropicSubBlock
  | { type: 'tool_use'; id: string; name: string; input: Record<string, any> }
  // cache_control on tool_result is API-supported and is where the rolling
  // breakpoint usually lands (last block of the trailing user turn).
  | { type: 'tool_result'; tool_use_id: string; content: string | AnthropicSubBlock[]; is_error?: boolean; cache_control?: CacheControl }
  | { type: 'thinking'; thinking: string; signature: string };

export class AnthropicLLMClient implements LLMClient {
  private client: Anthropic;
  public readonly provider = 'anthropic';
  public readonly modelName: string;

  // Per-instance dedup for capacity alerts. Instance lifecycle = job lifecycle
  // (orchestrator.ts creates one client per job), so these naturally fire at
  // most once per job. Critical also suppresses warn — once the louder alert
  // sounds, the lower-tier reminder would be redundant.
  private hasWarnedCapacityWarn = false;
  private hasWarnedCapacityCritical = false;

  constructor(
    private agentJob?: string,
    config?: {
      apiKey?: string;
      modelName?: string;
      temperature?: number;
      maxTokens?: number;
    }
  ) {
    this.client = new Anthropic({
      apiKey: config?.apiKey || process.env.ANTHROPIC_API_KEY,
      // Byte-level liveness (headers/body timeouts + TCP keepalive) — the only
      // layer that sees the API's `ping` keepalives (the SDK's SSE parser
      // swallows them before the event iterator). See llmDispatcher.ts.
      fetchOptions: { dispatcher: getLLMDispatcher() },
    });

    // ✅ modelName은 반드시 명시적으로 제공되어야 함
    if (!config?.modelName) {
      throw new Error(
        'AnthropicLLMClient: modelName is required. ' +
        'Please provide it via config or ensure workspaceConfig.llmModels is properly configured.'
      );
    }
    
    this.modelName = config.modelName;
  }

  // Thinking-API dispatch is per-model via the MODEL_REGISTRY SSOT
  // (`getThinkingMode`), NOT a name heuristic. Adaptive-thinking models
  // (Sonnet 5, Opus 5, Fable 5) REJECT the legacy `budget_tokens` shape with
  // a 400; only `extended` models (Haiku 4.5) accept it. Unknown `claude-*`
  // ids default to adaptive so a future model never re-introduces the
  // rejected shape.
  //
  // Adaptive-model handling of the caller's round toggle (`enableThinking`)
  // is CHANNEL-SPLIT. Rationale (broad-mining-minty RCA, Jul 2026): on
  // adaptive models, OMITTING the thinking param does NOT disable thinking
  // — adaptive runs by default, server-side and billed. The old
  // `!enableThinking → {}` branch was therefore a silent no-op "disable", and
  // because `display` defaults to `"omitted"`, the model reasoned for minutes
  // with ZERO stream events → withStreamIdleTimeout misread the silence as a
  // network stall and burned all 8 retries (re-billing the cache each time).
  //
  // - stream channel (`honorExplicitDisable=false`): always-on
  //   `thinking:{type:'adaptive', display:'summarized'}` regardless of the
  //   toggle — thinking_delta events keep the idle watchdog alive, and
  //   disabled-thinking on Opus 5 carries a documented tool-call-as-text
  //   degeneration risk that tool-heavy graph rounds must not take.
  // - invoke channel (`honorExplicitDisable=true`): an EXPLICIT
  //   `enableThinking === false` sends `thinking:{type:'disabled'}` — a legal
  //   wire shape on Sonnet 5 / Opus 5 (registry-gated via canDisableThinking).
  //   This is NOT the forbidden omission-as-disable: it is the API's real
  //   off-switch. Without it, aux calls with small maxTokens (commit message
  //   2048, breadcrumb 256) had their entire budget consumed by thinking →
  //   stop_reason max_tokens with ZERO text blocks → empty content → fallback
  //   (git-idempotent-tulip 3차 RCA). `output_config` is intentionally omitted
  //   alongside `disabled`: Opus 5 rejects disabled × effort xhigh/max, while
  //   the server default (high) is always a valid pairing.
  //   `undefined` is NOT promoted to disable — callers that never set the
  //   toggle keep always-on adaptive.
  //
  // Effort (adaptive, thinking on): PINNED to `high` — no thinkingBudget tier,
  // no per-round omission. `medium` may skip thinking entirely; `high` (the
  // server default) always thinks, so pinning it is cost-neutral against the
  // previously-omitted rounds while removing the tier that could silently skip
  // thinking on a round the caller asked to think. `xhigh`/`max` (available on
  // Opus 5) are deliberately unused — they raise per-round spend on every job.
  private buildThinkingParams(
    enableThinking: boolean | undefined,
    thinkingBudget: number,
    honorExplicitDisable: boolean,
  ): Record<string, any> {
    const mode = getThinkingMode(this.modelName);
    if (mode === 'extended') {
      // Extended models (Haiku 4.5): omission genuinely disables thinking,
      // so the caller's round toggle stays authoritative.
      if (enableThinking !== true) return {};
      return {
        thinking: {
          type: 'enabled',
          budget_tokens: thinkingBudget,
        },
      };
    }
    // `none` only occurs for non-Anthropic ids, which never route to this
    // client — defensive no-param fallback.
    if (mode === 'none') return {};

    // adaptive (default for unknown claude-* ids) — see channel split above.
    if (honorExplicitDisable && enableThinking === false && canDisableThinking(this.modelName)) {
      return { thinking: { type: 'disabled' } };
    }
    return {
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'high' },
    };
  }

  /** Whether the params built by buildThinkingParams actually run thinking —
   *  drives the invoke-path maxTokens floor (thinking + text share one cap). */
  private static thinkingActive(params: Record<string, any>): boolean {
    const type = params.thinking?.type as string | undefined;
    return type !== undefined && type !== 'disabled';
  }

  // Sampling-param SSOT, sibling of buildThinkingParams (whose contract is
  // locked by tests/llm/anthropic-thinking-params.test.ts — do not fold the
  // two: thinking wire shape and sampling wire shape are orthogonal). Both
  // key off the same getThinkingMode registry.
  //
  // - adaptive models (Sonnet 5, Opus 5, Fable 5): NEVER send temperature —
  //   the API removed the parameter outright on these models (400 if sent).
  // - extended models (Haiku 4.5): the API requires temperature=1/omitted
  //   when thinking is enabled; send only on non-thinking rounds.
  // - 'none' never routes to this client — defensive pass-through.
  private buildSamplingParams(
    enableThinking: boolean,
    temperature: number | undefined,
  ): Record<string, any> {
    if (temperature === undefined) return {};
    const mode = getThinkingMode(this.modelName);
    if (mode === 'adaptive') return {};
    if (mode === 'extended' && enableThinking) return {};
    return { temperature };
  }

  // Parsed-event BACKSTOP window, not a liveness judge. Transport-level
  // timers own liveness (llmDispatcher.ts: headers 180s / body 300s + TCP
  // keepalive) — the API's `ping` keepalives reset the byte timer but are
  // swallowed by the SDK's SSE parser before this iterator, so the parsed
  // layer structurally cannot see them. This window only bounds the
  // pathological "bytes keep flowing but no parseable event ever arrives"
  // state.
  //
  // History: the regime-gated 90/180/300s windows were liveness guesses —
  // prime-nesting-grate (adaptive silence killed 8×, re-billing ~150K cached
  // tokens each) and sandy-loading-coral (GLM >90s TTFT killed 8/8) are the
  // same class. Never tighten this back into a per-regime guess.
  private resolveIdleTimeoutMs(_enableThinking: boolean, _thinkingBudget: number): number {
    return 600_000;
  }

  async invoke(messages: Array<{ role: string; content: string | CacheableContent[] }>, options?: Record<string, any>): Promise<string> {
    const result = await this.invokeWithUsage(messages, options);
    return result.content;
  }
  
  async invokeWithUsage(
    messages: Array<{ role: string; content: string | CacheableContent[] }>, 
    options?: Record<string, any>
  ): Promise<LLMInvokeResult> {
    // Count cacheable blocks for logging
    let cacheableBlocks = 0;
    for (const msg of messages) {
      if (Array.isArray(msg.content)) {
        // ✅ Only text blocks can have cache_control
        cacheableBlocks += msg.content.filter(c => c.type === 'text' && (c as any).cache_control).length;
      }
    }
    
    console.log(`🔥 [API CALL] provider=anthropic model=${this.modelName} method=invoke messages=${messages.length} cacheable=${cacheableBlocks} temp=${this.buildSamplingParams(options?.enableThinking === true, options?.temperature).temperature ?? 'omitted'}`);
    
    // ✅ Extract system message (Anthropic requires it as a separate parameter)
    const systemMessage = messages.find(m => m.role === 'system');
    const userMessages = messages.filter(m => m.role !== 'system');
    
    // Process system message for caching
    let systemParam: string | Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> | undefined;
    if (systemMessage) {
      if (typeof systemMessage.content === 'string') {
        systemParam = systemMessage.content;
      } else if (Array.isArray(systemMessage.content)) {
        // Filter only text blocks for system message (Anthropic doesn't support images in system)
        systemParam = systemMessage.content
          .filter((block): block is Extract<CacheableContent, { type: 'text' }> => block.type === 'text')
          .map(block => ({
            type: 'text' as const,
            text: block.text,
            ...(block.cache_control && { cache_control: block.cache_control })
          }));
      }
    }
    
    const thinkingBudget = options?.thinkingBudget || 10000;
    // invoke channel honors an EXPLICIT enableThinking:false as a real
    // `thinking:{type:'disabled'}` (see buildThinkingParams channel split).
    const thinkingParams = this.buildThinkingParams(options?.enableThinking, thinkingBudget, true);
    const requestedMaxTokens = options?.maxTokens || 16000;
    // Floor keys off the ACTUAL thinking state of the outgoing request, not
    // the caller's toggle: max_tokens caps thinking + text together, so any
    // round that thinks needs headroom or the text starves. Disabled rounds
    // keep the caller's cap verbatim (all of it is text budget).
    const maxTokens = AnthropicLLMClient.thinkingActive(thinkingParams)
      ? Math.max(requestedMaxTokens, thinkingBudget + 2000)
      : requestedMaxTokens;
    
    // Use streaming internally to avoid Anthropic's 10-minute non-streaming timeout.
    // .messages.stream() + .finalMessage() gives us the same Message object
    // as .messages.create() but keeps the HTTP connection alive via SSE.
    // Wrapped with withRetry to handle overloaded_error delivered inside SSE stream
    // (HTTP 200 + error event), which bypasses the SDK's built-in HTTP-status retry.
    // Build + normalize cache breakpoints ONCE (outside retry): rolling tail
    // marker + ≤4 cap so Anthropic caches the growing history, not just the
    // static prefix. `converted` is adapter-owned (fresh from convertMessages).
    const converted = this.convertMessages(userMessages);
    this.applyProviderCacheBreakpoints(systemParam, converted);

    const signal: AbortSignal | undefined = options?.signal;
    const response = await withRetry(
      async () => {
        const stream = this.client.messages.stream({
          model: this.modelName,
          max_tokens: maxTokens,
          ...(systemParam && { system: systemParam }),
          ...thinkingParams,
          ...this.buildSamplingParams(options?.enableThinking === true, options?.temperature),
          messages: converted,
        }, { signal });
        return await stream.finalMessage();
      },
      {
        maxAttempts: 8,
        initialDelayMs: 2000,
        maxDelayMs: 60000,
        backoffMultiplier: 2,
        retryableErrors: ['overloaded_error', 'api_error', 'rate_limit_error'],
      }
    );

    const textBlocks = response.content.filter((block: any) => block.type === 'text');
    const content = textBlocks.map((block: any) => block.text).join('');

    // Response-shape diagnostics — one line that makes the empty-content
    // failure class self-identifying in prod logs (3차 RCA: thinking consumed
    // the whole max_tokens cap → zero text blocks → silent fallback upstream).
    const thinkingBlockCount = response.content.filter((b: any) => b.type === 'thinking').length;
    const stopReason = (response as any).stop_reason as string | undefined;
    console.log(
      `📥 [API RESULT] model=${this.modelName} method=invoke stop_reason=${stopReason ?? 'unknown'} ` +
      `blocks=text:${textBlocks.length}/thinking:${thinkingBlockCount} ` +
      `thinking_req=${(thinkingParams as any).thinking?.type ?? 'omitted'} outputTokens=${(response as any).usage?.output_tokens ?? '?'}`,
    );
    if (textBlocks.length === 0 && stopReason === 'max_tokens') {
      console.warn(
        `⚠️  [AnthropicLLM] thinking consumed the entire max_tokens budget (${maxTokens}) — ` +
        `no text emitted. Caller receives empty content.`,
      );
    }

    // ✅ Extract token usage with cache metrics
    const usage = (response as any).usage ? {
      inputTokens: (response as any).usage.input_tokens || 0,
      outputTokens: (response as any).usage.output_tokens || 0,
      // ✅ IMPORTANT (Unified semantics across design/code):
      // totalTokens = "new non-cache" tokens = input + output
      // Cache metrics are tracked separately (cacheReadTokens/cacheCreationTokens).
      totalTokens:
        ((response as any).usage.input_tokens || 0) +
        ((response as any).usage.output_tokens || 0),
      cacheReadTokens: (response as any).usage.cache_read_input_tokens,
      cacheCreationTokens: (response as any).usage.cache_creation_input_tokens,
    } : undefined;
    
    // Log cache effectiveness
    if (usage?.cacheReadTokens || usage?.cacheCreationTokens) {
      console.log(`💰 [CACHE] read=${usage.cacheReadTokens || 0} create=${usage.cacheCreationTokens || 0}`);
    }
    
    return { content, usage };
  }

  /**
   * 🎯 Unified streaming interface with automatic retry
   * Handles thinking blocks, tool calling, prompt caching, and regular text
   * ✅ Retries on overloaded_error and api_error
   */
  async *stream(
    messages: Array<{ role: string; content: string | MessageContentBlock[] }>,
    options?: {
      tools?: ToolDefinition[];
      maxTokens?: number;
      enableThinking?: boolean;
      stopSequences?: string[];
      [key: string]: any;
    }
  ): AsyncIterable<LLMStreamEvent> {
    // Idle watchdog wraps the WHOLE attempt (including the messages.create
    // await) with a per-attempt AbortController that severs the HTTP stream
    // on watchdog fire — the abandoned-iterator wedge (sandy-loading-coral
    // RCA) cannot survive an actual transport abort. Window resolution
    // stays regime-aware (resolveIdleTimeoutMs).
    const idleMs = this.resolveIdleTimeoutMs(
      options?.enableThinking === true,
      options?.thinkingBudget || 10000,
    );
    yield* withRetryStream(
      () => streamAttemptWithIdleAbort(
        (signal) => this._streamInternal(messages, { ...options, signal }),
        idleMs,
        options?.signal,
      ),
      {
        maxAttempts: 8,
        initialDelayMs: 2000,
        maxDelayMs: 60000,
        backoffMultiplier: 2,
        retryableErrors: ['overloaded_error', 'api_error', 'rate_limit_error'],
        retryMarker: { type: 'retry' as const },
      }
    );
  }

  /**
   * Internal streaming implementation with prompt caching support
   */
  private async *_streamInternal(
    messages: Array<{ role: string; content: string | MessageContentBlock[] }>,
    options?: {
      tools?: ToolDefinition[];
      maxTokens?: number;
      enableThinking?: boolean;
      stopSequences?: string[];
      [key: string]: any;
    }
  ): AsyncIterable<LLMStreamEvent> {
    const signal: AbortSignal | undefined = options?.signal;
    // Cover aborts that land between tool-loop stream calls (before any HTTP).
    if (signal?.aborted) return;

    const toolsCount = options?.tools?.length || 0;
    const enableThinking = options?.enableThinking === true;
    const thinkingBudget = options?.thinkingBudget || 10000;
    
    // Count cacheable blocks for logging
    let cacheableBlocks = 0;
    for (const msg of messages) {
      if (Array.isArray(msg.content)) {
        // ✅ Only text blocks can have cache_control
        cacheableBlocks += msg.content.filter((c: any) => c?.type === 'text' && c?.cache_control).length;
      }
    }
    
    // ✅ Extract system message (Anthropic requires it as a separate parameter)
    // Priority: options.system > messages with role 'system'
    const systemMessage = messages.find(m => m.role === 'system');
    const userMessages = messages.filter(m => m.role !== 'system');
    
    console.log(`🔥 [API CALL] provider=anthropic model=${this.modelName} method=stream messages=${userMessages.length} tools=${toolsCount} thinking=${enableThinking} cacheable=${cacheableBlocks} temp=${this.buildSamplingParams(enableThinking, options?.temperature).temperature ?? 'omitted'}`);
    
    // Process system message (options.system takes priority)
    let systemParam: string | undefined = options?.system;
    if (!systemParam && systemMessage) {
      if (typeof systemMessage.content === 'string') {
        systemParam = systemMessage.content;
      } else if (Array.isArray(systemMessage.content)) {
        // Join text blocks
        systemParam = systemMessage.content
          .filter((c: any) => c?.type === 'text')
          .map((c: any) => c.text)
          .join('\n');
      }
    }
    
    const requestedMaxTokens = options?.maxTokens || 16000;
    const maxTokens = enableThinking
      ? Math.max(requestedMaxTokens, thinkingBudget + 2000)
      : requestedMaxTokens;

    // Caller-supplied hard-stop strings. Anthropic terminates generation
    // (and emits `stop_reason: "stop_sequence"`) the moment any of these
    // appears in the model's text output. Thinking blocks are unaffected.
    const stopSequences: string[] | undefined = Array.isArray(options?.stopSequences)
      ? options!.stopSequences as string[]
      : undefined;

    // Rolling tail marker + ≤4 cap so Anthropic caches the growing tool-loop
    // history (not just the static prefix). `converted` is adapter-owned.
    // systemParam here is a string, so it contributes 0 breakpoints.
    const converted = this.convertMessages(userMessages);
    this.applyProviderCacheBreakpoints(systemParam, converted);

    // Effective tool set + native choice mode for this round (shared helper —
    // `{ allow }` narrowing semantics live in the port, not per adapter).
    const resolvedTools = resolveToolChoice(options?.tools, options?.toolChoice);

    const stream = await this.client.messages.create({
      model: this.modelName,
      max_tokens: maxTokens,
      ...(systemParam ? { system: systemParam } : {}),
      // stream channel: honorExplicitDisable=false — always-on adaptive for
      // watchdog liveness; never sends `disabled` (see buildThinkingParams).
      ...this.buildThinkingParams(enableThinking, thinkingBudget, false),
      ...this.buildSamplingParams(enableThinking, options?.temperature),
      messages: converted,
      ...(resolvedTools.tools && resolvedTools.tools.length > 0 ? {
        tools: resolvedTools.tools.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema,
          // Fine-grained tool streaming (GA): unbuffered input_json_delta
          // fragments for live rendering of file-writing tool arguments.
          ...(t.eagerInputStreaming ? { eager_input_streaming: true } : {}),
        })),
        // Port `toolChoice` → Anthropic `tool_choice` via resolveToolChoice.
        // `'none'` keeps the tools block declared, preserving the tools+system
        // cache tiers (the pre-toolChoice strip invalidated the whole prefix
        // on the most expensive round). `{ allow }` narrows the advertised
        // set for drain salvage rounds — a deliberate cache trade on rare
        // terminal rounds.
        ...(resolvedTools.mode ? { tool_choice: { type: resolvedTools.mode } } : {}),
      } : {}),
      ...(stopSequences && stopSequences.length > 0 ? { stop_sequences: stopSequences } : {}),
      stream: true,
    }, { signal });

    // 🔴 FIX: Accumulate tool_use input across multiple deltas
    const toolUseBuffer: Map<number, { id: string; name: string; input: string }> = new Map();
    const thinkingBlocks: Map<number, { startTime: number; content: string; signature: string }> = new Map();
    
    // ✅ Track token usage (accumulate from message_start and message_delta)
    let tokenUsage: TaskTokenUsage | undefined;

    // Stop reason from the final `message_delta` event (Anthropic emits it
    // there, not on `message_stop`). Mapped to the unified port enum so
    // callers can gate on `'max_tokens'` without provider-specific knowledge.
    let stopReason: LLMStreamEvent['stopReason'] | undefined;

    // ✅ In-flight usage_partial throttling.
    // message_delta 이벤트는 초당 여러 번 발생할 수 있으므로 게이지 업데이트가
    // Redis/SSE 를 범람시키지 않도록 아래 조건 중 하나를 만족할 때만 partial 을 내보낸다.
    //   - 마지막 emit 이후 500ms 경과
    //   - outputTokens 이 마지막 emit 대비 100 이상 증가
    // message_start 직후의 최초 snapshot 은 조건 없이 즉시 방출 (입력 토큰을
    // 스트림 시작 수백 ms 내에 UI 에 보여주는 것이 D1 수정의 핵심 목적).
    const PARTIAL_USAGE_MIN_INTERVAL_MS = 500;
    const PARTIAL_USAGE_MIN_TOKEN_DELTA = 100;
    let lastPartialEmitAt = 0;
    let lastPartialOutputTokens = 0;
    const buildPartialUsage = (): TaskTokenUsage | undefined =>
      tokenUsage && {
        inputTokens: tokenUsage.inputTokens,
        outputTokens: tokenUsage.outputTokens,
        totalTokens: tokenUsage.totalTokens,
        ...(tokenUsage.cacheReadTokens !== undefined && { cacheReadTokens: tokenUsage.cacheReadTokens }),
        ...(tokenUsage.cacheCreationTokens !== undefined && { cacheCreationTokens: tokenUsage.cacheCreationTokens }),
      };

    // Idle watchdog lives in stream() (streamAttemptWithIdleAbort) — it
    // wraps this whole attempt, so no inner wrap here.
    for await (const event of stream) {
      // ✅ Capture usage from message_start (initial usage snapshot)
      if (event.type === 'message_start' && (event as any).message?.usage) {
        const usage = (event as any).message.usage;
        const inputTokens = usage.input_tokens || 0;
        const outputTokens = usage.output_tokens || 0;
        const cacheReadTokens = usage.cache_read_input_tokens || 0;
        const cacheCreationTokens = usage.cache_creation_input_tokens || 0;
        
        tokenUsage = {
          inputTokens,
          outputTokens,
          // ✅ IMPORTANT (Unified semantics): totalTokens = input + output (non-cache)
          totalTokens: inputTokens + outputTokens,
          cacheReadTokens: usage.cache_read_input_tokens,
          cacheCreationTokens: usage.cache_creation_input_tokens,
        };
        
        // Log cache effectiveness immediately
        if (tokenUsage.cacheReadTokens || tokenUsage.cacheCreationTokens) {
          console.log(`💰 [CACHE] read=${tokenUsage.cacheReadTokens || 0} create=${tokenUsage.cacheCreationTokens || 0}`);
        }
        
        // Capacity check — model-aware via MODEL_CONTEXT_WINDOWS.
        // SRE-conventional thresholds: 80% = attention, 95% = act.
        const totalPromptTokens = inputTokens + cacheReadTokens + cacheCreationTokens;
        try {
          const contextWindow = getModelContextWindow(this.modelName);
          const usagePct = totalPromptTokens / contextWindow;
          if (usagePct > 0.95) {
            if (!this.hasWarnedCapacityCritical) {
              this.hasWarnedCapacityCritical = true;
              this.hasWarnedCapacityWarn = true;
              console.error(
                `🚨 [CAPACITY] ${(usagePct * 100).toFixed(0)}% of ${this.modelName} ` +
                `(${totalPromptTokens.toLocaleString()}/${contextWindow.toLocaleString()}) — compaction overdue`
              );
            }
          } else if (usagePct > 0.80) {
            if (!this.hasWarnedCapacityWarn) {
              this.hasWarnedCapacityWarn = true;
              console.warn(
                `⚠️  [CAPACITY] ${(usagePct * 100).toFixed(0)}% of ${this.modelName} window`
              );
            }
          }
        } catch {
          // Unknown modelId — skip capacity check (mirrors buildMessages.ts pattern).
          // Register new models in MODEL_CONTEXT_WINDOWS to enable alerts.
        }

        // Emit initial usage_partial immediately so chat-input gauge reflects the
        // prompt size within a few hundred ms of the LLM call starting.
        lastPartialEmitAt = Date.now();
        lastPartialOutputTokens = outputTokens;
        yield {
          type: 'usage_partial',
          usage: buildPartialUsage(),
          metadata: {
            provider: 'anthropic',
            model: this.modelName,
            timestamp: new Date().toISOString(),
          },
        };
      }

      // Capture the final stop_reason — Anthropic only sends this on the
      // last `message_delta` (the same event that carries final usage).
      if (event.type === 'message_delta') {
        const rawReason = (event as any).delta?.stop_reason as string | undefined;
        if (rawReason) {
          switch (rawReason) {
            case 'end_turn': stopReason = 'end_turn'; break;
            case 'max_tokens': stopReason = 'max_tokens'; break;
            case 'stop_sequence': stopReason = 'stop_sequence'; break;
            case 'tool_use': stopReason = 'tool_use'; break;
            // pause_turn / refusal / unknown future values
            default: stopReason = 'other'; break;
          }
        }
      }

      // ✅ Update usage from message_delta (incremental updates)
      if (event.type === 'message_delta' && (event as any).usage) {
        const usage = (event as any).usage;
        if (tokenUsage) {
          const newOutputTokens = usage.output_tokens || tokenUsage.outputTokens;
          tokenUsage.outputTokens = newOutputTokens;
          // ✅ IMPORTANT (Unified semantics): totalTokens = input + output (non-cache)
          tokenUsage.totalTokens =
            tokenUsage.inputTokens +
            newOutputTokens;
        } else {
          const outputTokens = usage.output_tokens || 0;
          tokenUsage = {
            inputTokens: 0,
            outputTokens,
            totalTokens: outputTokens,
          };
        }

        // Throttled partial emit during streaming.
        const now = Date.now();
        const tokenDelta = (tokenUsage.outputTokens || 0) - lastPartialOutputTokens;
        if (
          now - lastPartialEmitAt >= PARTIAL_USAGE_MIN_INTERVAL_MS ||
          tokenDelta >= PARTIAL_USAGE_MIN_TOKEN_DELTA
        ) {
          lastPartialEmitAt = now;
          lastPartialOutputTokens = tokenUsage.outputTokens || 0;
          yield {
            type: 'usage_partial',
            usage: buildPartialUsage(),
            metadata: {
              provider: 'anthropic',
              model: this.modelName,
              timestamp: new Date().toISOString(),
            },
          };
        }
      }
      
      // Thinking block - START
      if (event.type === 'content_block_start' && event.content_block.type === 'thinking') {
        thinkingBlocks.set(event.index, {
          startTime: Date.now(),
          content: '',
          signature: '',
        });
      }
      
      // Thinking block - DELTA
      if (event.type === 'content_block_delta' && event.delta.type === 'thinking_delta') {
        const block = thinkingBlocks.get(event.index);
        if (block) {
          block.content += event.delta.thinking;
        }
        
        yield {
          type: 'thinking',
          thinking: event.delta.thinking,
          index: event.index,
          metadata: {
            provider: 'anthropic',
            model: this.modelName,
            timestamp: new Date().toISOString(),
          },
        };
      }

      // Thinking block - SIGNATURE DELTA (required for multi-turn conversation history)
      if (event.type === 'content_block_delta' && (event.delta as any).type === 'signature_delta') {
        const block = thinkingBlocks.get(event.index);
        if (block) {
          block.signature += (event.delta as any).signature || '';
        }
      }

      // Text block
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield {
          type: 'text',
          text: event.delta.text,
          index: event.index,
          metadata: {
            provider: 'anthropic',
            model: this.modelName,
            timestamp: new Date().toISOString(),
          },
        };
      }

      // 🔴 FIX: Tool use - START (initialize buffer)
      if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
        toolUseBuffer.set(event.index, {
          id: event.content_block.id,
          name: event.content_block.name,
          input: '',
        });
      }

      // 🔴 FIX: Tool use - DELTA (accumulate input JSON)
      if (event.type === 'content_block_delta' && event.delta.type === 'input_json_delta') {
        const buffer = toolUseBuffer.get(event.index);
        if (buffer) {
          buffer.input += event.delta.partial_json;
          // ✅ Forward the raw fragment for live rendering (file-writing tools).
          // The terminal `tool_use` event below stays authoritative.
          if (event.delta.partial_json) {
            yield {
              type: 'tool_use_delta',
              toolUseDelta: {
                toolUseId: buffer.id,
                name: buffer.name,
                partialInput: event.delta.partial_json,
              },
              index: event.index,
              metadata: {
                provider: 'anthropic',
                model: this.modelName,
                timestamp: new Date().toISOString(),
              },
            };
          }
        }
      }

      // 🔴 FIX: Content block STOP (handle both tool_use and thinking)
      if (event.type === 'content_block_stop') {
        // ✅ Check if this is a thinking block ending
        const thinkingBlock = thinkingBlocks.get(event.index);
        if (thinkingBlock) {
          const durationMs = Date.now() - thinkingBlock.startTime;
          
          yield {
            type: 'thinking',
            thinking: '',
            signature: thinkingBlock.signature || undefined,
            index: event.index,
            metadata: {
              provider: 'anthropic',
              model: this.modelName,
              timestamp: new Date().toISOString(),
              blockEnd: true,
              durationMs,
            },
          };
          
          thinkingBlocks.delete(event.index);
        }
        
        // ✅ Check if this is a tool_use ending
        const buffer = toolUseBuffer.get(event.index);
        if (buffer) {
          try {
            // ✅ Handle empty input (tools with no parameters)
            const inputStr = buffer.input.trim();
            const parsedInput = inputStr ? JSON.parse(inputStr) : {};
            
            yield {
              type: 'tool_use',
              toolUse: {
                id: buffer.id,
                name: buffer.name,
                input: parsedInput,
                type: 'function' as const,
              },
              index: event.index,
              metadata: {
                provider: 'anthropic',
                model: this.modelName,
                timestamp: new Date().toISOString(),
              },
            };
          } catch (error) {
            console.error(`[AnthropicLLM] Failed to parse tool input for ${buffer.name}:`, buffer.input?.substring(0, 200));
            console.error(error);
            
            // ✅ Still yield tool_use with empty input so the flow doesn't break
            yield {
              type: 'tool_use',
              toolUse: {
                id: buffer.id,
                name: buffer.name,
                input: {},  // Fallback to empty object
                type: 'function' as const,
              },
              index: event.index,
              metadata: {
                provider: 'anthropic',
                model: this.modelName,
                timestamp: new Date().toISOString(),
              },
            };
          } finally {
            // ✅ Always clean up buffer
            toolUseBuffer.delete(event.index);
          }
        }
      }

      // Message complete
      if (event.type === 'message_stop') {
        yield {
          type: 'done',
          done: true,
          usage: tokenUsage,
          stopReason,
          metadata: {
            provider: 'anthropic',
            model: this.modelName,
            timestamp: new Date().toISOString(),
          },
        };
      }
    }
  }

  /**
   * Provider cache-breakpoint mechanics (Anthropic-specific).
   *
   * Anthropic prompt caching requires an EXPLICIT `cache_control` marker on
   * each cached span — unlike DeepSeek/OpenAI which auto-cache prefixes
   * server-side. Callers (CacheBlockMapper / buildPlanPromptBlocks /
   * composeMessages) only mark the static turn-1 prefix, so across a growing
   * tool-loop the accumulated history was never cached under Anthropic models:
   * cacheRead froze at the prefix size while billable input climbed every
   * round (prime-nesting-grate RCA — 46-min / 6.5M-token plan phase). The fix
   * lives here, the single wire chokepoint every assembly seam converges on,
   * so no caller needs provider knowledge.
   *
   *   1. Rolling tail — mark the last block of the last message so the NEXT
   *      round reads the whole prior prefix (system + docs + history) from
   *      cache. Anthropic caches the longest prefix ending at a marker.
   *   2. ≤4 cap — Anthropic hard-limits breakpoints to 4 across
   *      system + messages + tools. Keep the earliest stable-prefix markers
   *      + the rolling tail; drop the intermediate ones.
   *
   * Mutates in place — `systemParam` and `messages` are adapter-owned
   * (messages are fresh from convertMessages), never the caller's arrays.
   */
  private applyProviderCacheBreakpoints(
    systemParam: string | Array<{ type: 'text'; text: string; cache_control?: CacheControl }> | undefined,
    messages: Array<{ role: 'user' | 'assistant'; content: string | AnthropicBlock[] }>,
  ): void {
    const CACHEABLE_TYPES = new Set(['text', 'image', 'tool_result']);

    // 1. Rolling tail on the last markable block of the last message.
    //    Gated on history presence (>1): a single-shot call would only pay
    //    the 1.25x cache-WRITE with no later round to read it back. From the
    //    2nd round on, the tail lets each round read the full prior prefix.
    if (messages.length > 1) {
      const last = messages[messages.length - 1];
      if (typeof last.content === 'string') {
        last.content = [{ type: 'text', text: last.content, cache_control: { type: 'ephemeral' } }];
      } else {
        for (let i = last.content.length - 1; i >= 0; i--) {
          const block = last.content[i] as { type: string; cache_control?: CacheControl };
          if (CACHEABLE_TYPES.has(block.type)) {
            block.cache_control = { type: 'ephemeral' };
            break;
          }
        }
      }
    }

    // 2. Cap to 4. Collect marked blocks in wire order (system first, then
    //    messages) and strip the middle when over the limit.
    const marked: Array<{ cache_control?: CacheControl }> = [];
    if (Array.isArray(systemParam)) {
      for (const b of systemParam) if (b.cache_control) marked.push(b);
    }
    for (const m of messages) {
      if (Array.isArray(m.content)) {
        for (const b of m.content) {
          const cb = b as { cache_control?: CacheControl };
          if (cb.cache_control) marked.push(cb);
        }
      }
    }
    const MAX_BREAKPOINTS = 4;
    if (marked.length > MAX_BREAKPOINTS) {
      // Keep the first (MAX-1) stable-prefix markers + the last (rolling tail).
      for (let i = MAX_BREAKPOINTS - 1; i < marked.length - 1; i++) {
        delete marked[i].cache_control;
      }
    }
  }

  private convertMessages(
    messages: Array<{ role: string; content: string | MessageContentBlock[] | CacheableContent[] }>
  ): Array<{ role: 'user' | 'assistant'; content: string | AnthropicBlock[] }> {
    // Provider-neutral guard: strip empty text blocks before mapping to the
    // wire format. Anthropic rejects empty text blocks with a 400 (e.g. a
    // clarify-pause turn saved with empty content); see sanitizeMessages.
    const converted = sanitizeMessages(messages).map(m => ({
      role: m.role as 'user' | 'assistant',
      content: typeof m.content === 'string'
        ? m.content
        // Cross-provider guard: a conversation whose model was switched
        // mid-flight can carry thinking blocks whose signature is ANOTHER
        // provider's replay token (OpenAI Responses encodes its reasoning
        // items there — see core/llm/reasoningEnvelope.ts). Anthropic
        // validates signatures, so the block is dropped whole rather than
        // forwarded with a signature it will reject.
        : (m.content as Array<MessageContentBlock | CacheableContent>)
            .filter(block => !(block.type === 'thinking'
              && isReasoningEnvelope((block as ThinkingContentBlock).signature)))
            .map(block => this.convertBlock(block)),
    }));

    // Anthropic API requires the conversation to end with a user message.
    // When resuming from an interrupted session, conversationHistory may end
    // with an assistant turn (e.g. clarify response saved before crash).
    if (converted.length > 0 && converted[converted.length - 1].role === 'assistant') {
      console.warn('⚠️ [AnthropicLLMClient] Messages end with assistant role — appending user continuation to satisfy API contract');
      converted.push({ role: 'user', content: 'Continue.' });
    }

    return converted;
  }

  private convertBlock(block: MessageContentBlock | CacheableContent): AnthropicBlock {
    switch (block.type) {
      case 'text': {
        const b = block as TextContentBlock;
        return { type: 'text', text: b.text, ...(b.cache_control && { cache_control: b.cache_control }) };
      }
      case 'image': {
        const b = block as ImageContentBlock;
        return { type: 'image', source: b.source };
      }
      case 'tool_use': {
        const b = block as ToolUseContentBlock;
        return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
      }
      case 'tool_result': {
        const b = block as ToolResultContentBlock;
        return {
          type: 'tool_result' as const,
          tool_use_id: b.tool_use_id,
          content: typeof b.content === 'string'
            ? b.content
            : b.content.map(sub => this.convertBlock(sub) as AnthropicSubBlock),
          ...(b.is_error && { is_error: b.is_error }),
        };
      }
      case 'thinking': {
        const b = block as ThinkingContentBlock;
        return { type: 'thinking', thinking: b.thinking, signature: b.signature || '' };
      }
      default:
        return block as any;
    }
  }

  async invokeStructured<T = any>(
    messages: Array<{ role: string; content: string | CacheableContent[] }>,
    schema: Record<string, any>,
    schemaName: string,
    options?: { temperature?: number; maxTokens?: number; [key: string]: any }
  ): Promise<T> {
    // Anthropic doesn't have native structured output yet
    // Add JSON schema to prompt
    const lastMessage = messages[messages.length - 1];
    
    // Handle both string and CacheableContent[] formats
    let enhancedContent: string | CacheableContent[];
    if (typeof lastMessage.content === 'string') {
      enhancedContent = `${lastMessage.content}

Please respond with ONLY a valid JSON object that matches this schema:
\`\`\`json
${JSON.stringify(schema, null, 2)}
\`\`\`

Do not include any explanatory text before or after the JSON. Start your response with { and end with }.`;
    } else {
      // Array format - append JSON instruction as new block
      enhancedContent = [
        ...lastMessage.content,
        {
          type: 'text' as const,
          text: `

Please respond with ONLY a valid JSON object that matches this schema:
\`\`\`json
${JSON.stringify(schema, null, 2)}
\`\`\`

Do not include any explanatory text before or after the JSON. Start your response with { and end with }.`
        }
      ];
    }
    
    const enhancedMessages = [
      ...messages.slice(0, -1),
      {
        role: lastMessage.role,
        content: enhancedContent
      }
    ];
    
    const result = await this.invokeWithUsage(enhancedMessages as any, options);
    const response = result.content;
    
    try {
      // Try to extract JSON from response (in case there's extra text)
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as T;
      }
      // If no braces found, try parsing the whole response
      return JSON.parse(response) as T;
    } catch (error) {
      console.error('Failed to parse structured response:', response);
      console.error('Parse error:', error);
      throw new Error(`Failed to parse structured response from Anthropic: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

