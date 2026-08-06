/**
 * OpenAIResponsesLLMClient
 *
 * OpenAI models that speak the RESPONSES API (`ModelSpec.apiSurface === 'responses'`,
 * e.g. the GPT-5.6 family). Sibling of {@link OpenAILLMClient}, which stays on Chat
 * Completions for OpenAI-compatible third parties (DeepSeek / GLM / Kimi).
 *
 * Why a separate adapter rather than a branch inside the chat client — the two
 * protocols diverge on every axis that matters:
 *   - request: flat `input` ITEM array (function_call / function_call_output /
 *     reasoning are top-level items), not chat messages with a `role:'tool'` sidecar
 *   - reasoning: returned as replayable items; the chat path deliberately STRIPS
 *     thinking from history because re-sending `reasoning_content` 400s there
 *   - depth control: `reasoning.effort`, not the DeepSeek/GLM `thinking:{type}` field
 *   - budget: `max_output_tokens` (INCLUDES reasoning tokens), not `max_tokens`
 *   - usage: `input_tokens` / `output_tokens` / `*_details`, not `prompt_tokens`
 *   - stream: an event protocol (`response.*`) with no `choices` at all
 *   - stop: there is NO `stop` parameter (see `stream()`)
 *
 * Shared with every other adapter: the undici dispatcher (byte-level liveness),
 * `sanitizeMessages`, and the retry + idle-watchdog wrappers.
 */

import OpenAI from 'openai';
import { randomUUID } from 'node:crypto';
import {
  LLMClient,
  LLMStreamEvent,
  ToolDefinition,
  LLMInvokeResult,
  CacheableContent,
  MessageContentBlock,
  ToolUseContentBlock,
  ToolResultContentBlock,
  ImageContentBlock,
  ThinkingContentBlock,
  TextContentBlock,
  resolveToolChoice,
} from '../../../core/ports/llm';
import { TaskTokenUsage } from '../../../core/types/task';
import { withRetryStream, streamAttemptWithIdleAbort } from '../../../core/utils/retry';
import { getLLMDispatcher } from './llmDispatcher';
import { sanitizeMessages } from '../../../core/utils/sanitizeMessages';
import {
  decodeReasoningEnvelope,
  encodeReasoningEnvelope,
  type ReasoningItemRef,
} from '../../../core/llm/reasoningEnvelope';
import { MODEL_REGISTRY } from '@ant/shared';

type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

/**
 * Effort for the port's boolean `enableThinking`.
 *
 * `high` when thinking is on — parity with AnthropicLLMClient, which pins
 * `output_config.effort` to `high` for adaptive models. `low` (not `none` /
 * `minimal`) is the floor: those two values are not documented as supported
 * across the whole GPT-5.6 family, and a rejected enum costs a hard 400 while
 * a slightly-too-deep cheap round costs a few hundred tokens.
 */
const EFFORT_ENABLED: ReasoningEffort = 'high';
const EFFORT_DISABLED: ReasoningEffort = 'low';

/** Operator hard override, mirroring DEEPSEEK_THINKING / GLM_THINKING on the chat path. */
const EFFORT_ENV = 'OPENAI_REASONING_EFFORT';

/**
 * Output-budget headroom per effort tier. `max_output_tokens` is spent on
 * reasoning FIRST, so passing the caller's text budget straight through lets a
 * deep round consume the whole ceiling and finish with zero visible text — the
 * same thinking-starvation class the Anthropic client guards with its
 * `budget_tokens + 2000` floor.
 */
const REASONING_RESERVE: Record<ReasoningEffort, number> = {
  low: 2_000,
  medium: 8_000,
  high: 24_000,
  xhigh: 48_000,
};

/** Ceiling used when the model is not registered with a `maxOutputTokens`. */
const DEFAULT_MAX_OUTPUT_TOKENS = 128_000;

/**
 * Normalize a Responses `usage` object to the disjoint {@link TaskTokenUsage}
 * contract. Two traps this closes:
 *  - `input_tokens` INCLUDES `input_tokens_details.cached_tokens`, while the
 *    rate card assumes Anthropic semantics where `inputTokens` is cache-MISS
 *    only. Not subtracting bills the cached prefix twice.
 *  - `output_tokens` ALREADY INCLUDES `output_tokens_details.reasoning_tokens`
 *    (reasoning is billed at the output rate). Adding it would double-count.
 */
export function normalizeResponsesUsage(usage: {
  input_tokens?: number | null;
  output_tokens?: number | null;
  total_tokens?: number | null;
  input_tokens_details?: { cached_tokens?: number | null } | null;
  output_tokens_details?: { reasoning_tokens?: number | null } | null;
} | null | undefined): TaskTokenUsage | undefined {
  if (!usage) return undefined;
  const cached = usage.input_tokens_details?.cached_tokens || 0;
  const inputTokens = Math.max(0, (usage.input_tokens || 0) - cached);
  const outputTokens = usage.output_tokens || 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: usage.total_tokens || inputTokens + outputTokens,
    ...(cached ? { cacheReadTokens: cached } : {}),
  };
}

/** Heuristic for "the API rejected our replayed reasoning items". */
function isReasoningReplayRejection(error: any): boolean {
  const status = error?.status ?? error?.response?.status;
  if (status !== 400) return false;
  const message = String(error?.message || error?.error?.message || '').toLowerCase();
  return message.includes('reasoning');
}

export class OpenAIResponsesLLMClient implements LLMClient {
  private client: OpenAI;
  public readonly provider: string;
  public readonly modelName: string;
  private readonly temperature: number;
  /** Registry-declared: reasoning models reject `temperature` outright. */
  private readonly sendsTemperature: boolean;
  private readonly maxOutputCeiling: number;

  constructor(
    private agentJob?: string,
    config?: {
      apiKey?: string;
      baseURL?: string;
      provider?: string;
      modelName?: string;
      temperature?: number;
      maxTokens?: number;
      timeout?: number;
    },
  ) {
    this.client = new OpenAI({
      apiKey: config?.apiKey || process.env.OPENAI_API_KEY,
      baseURL: config?.baseURL,
      timeout: config?.timeout || 180000,
      fetchOptions: { dispatcher: getLLMDispatcher() },
    });

    this.provider = config?.provider ?? 'openai';
    this.temperature = config?.temperature ?? 0.7;

    if (!config?.modelName) {
      throw new Error(
        'OpenAIResponsesLLMClient: modelName is required. ' +
        'Please provide it via config or ensure workspaceConfig.llmModels is properly configured.',
      );
    }
    this.modelName = config.modelName;

    const spec = MODEL_REGISTRY[this.modelName];
    this.sendsTemperature = spec?.supportsTemperature !== false;
    this.maxOutputCeiling = spec?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  }

  // ==========================================================================
  // Request shaping
  // ==========================================================================

  private resolveEffort(enableThinking?: boolean): ReasoningEffort {
    const override = process.env[EFFORT_ENV] as ReasoningEffort | undefined;
    if (override && override in REASONING_RESERVE) return override;
    return enableThinking === false ? EFFORT_DISABLED : EFFORT_ENABLED;
  }

  private resolveMaxOutputTokens(requested: number | undefined, effort: ReasoningEffort): number {
    const base = requested && requested > 0 ? requested : 16000;
    return Math.min(this.maxOutputCeiling, base + REASONING_RESERVE[effort]);
  }

  private samplingParams(temperature?: number): Record<string, unknown> {
    if (!this.sendsTemperature) return {};
    return { temperature: temperature ?? this.temperature };
  }

  private toolsParam(tools?: ToolDefinition[]): Record<string, unknown> {
    if (!tools?.length) return {};
    // Responses function tools are FLAT — no nested `function: {...}` wrapper.
    return {
      tools: tools.map((t) => ({
        type: 'function' as const,
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
        // `strict: true` demands every property be required with
        // additionalProperties:false; ANT's tool schemas are not written that way.
        strict: false,
      })),
    };
  }

  private metadata() {
    return {
      provider: this.provider,
      model: this.modelName,
      timestamp: new Date().toISOString(),
    };
  }

  // ==========================================================================
  // Message → Responses `input` items
  // ==========================================================================

  private static toDataUrl(img: ImageContentBlock): string {
    return `data:${img.source.media_type};base64,${img.source.data}`;
  }

  /**
   * Convert the neutral message list into Responses input items.
   *
   * @param includeReasoning replay `reasoning` items decoded from thinking-block
   *   signatures. Turned off for the one defensive retry after a reasoning-shaped 400.
   */
  private convertToResponsesInput(
    messages: Array<{ role: string; content: string | MessageContentBlock[] | CacheableContent[] }>,
    includeReasoning: boolean,
  ): any[] {
    const items: any[] = [];

    for (const msg of sanitizeMessages(messages)) {
      const role = msg.role === 'assistant' ? 'assistant' : msg.role === 'system' ? 'system' : 'user';

      if (typeof msg.content === 'string') {
        items.push({ role, content: msg.content });
        continue;
      }
      if (!Array.isArray(msg.content)) {
        items.push({ role, content: String(msg.content) });
        continue;
      }

      const blocks = msg.content as MessageContentBlock[];
      const textParts: string[] = [];
      const images: ImageContentBlock[] = [];
      const toolResultImages: ImageContentBlock[] = [];
      const pendingCalls: any[] = [];
      const pendingOutputs: any[] = [];

      for (const block of blocks) {
        switch (block.type) {
          case 'text':
            textParts.push((block as TextContentBlock).text);
            break;

          case 'image':
            images.push(block as ImageContentBlock);
            break;

          case 'thinking': {
            if (!includeReasoning) break;
            // The signature carries this round's reasoning items (see
            // core/llm/reasoningEnvelope.ts). Replaying them is what preserves
            // chain-of-thought across tool-call rounds; a foreign/absent
            // signature decodes to [] and is simply skipped.
            for (const ref of decodeReasoningEnvelope((block as ThinkingContentBlock).signature)) {
              items.push({
                type: 'reasoning',
                id: ref.id,
                summary: [],
                ...(ref.encryptedContent ? { encrypted_content: ref.encryptedContent } : {}),
              });
            }
            break;
          }

          case 'tool_use': {
            const b = block as ToolUseContentBlock;
            pendingCalls.push({
              type: 'function_call',
              call_id: b.id,
              name: b.name,
              arguments: JSON.stringify(b.input ?? {}),
            });
            break;
          }

          case 'tool_result': {
            const b = block as ToolResultContentBlock;
            const text = typeof b.content === 'string'
              ? b.content
              : b.content
                  .filter((c) => c.type === 'text')
                  .map((c) => (c as TextContentBlock).text)
                  .join('\n');
            pendingOutputs.push({ type: 'function_call_output', call_id: b.tool_use_id, output: text });
            if (Array.isArray(b.content)) {
              for (const sub of b.content) {
                if (sub.type === 'image') toolResultImages.push(sub as ImageContentBlock);
              }
            }
            break;
          }
        }
      }

      // Order within a turn: reasoning (pushed above) → message → function_call
      // → function_call_output. This mirrors how the API emitted them.
      const joinedText = textParts.join('');
      if (joinedText || images.length) {
        if (images.length) {
          items.push({
            role,
            content: [
              ...(joinedText ? [{ type: 'input_text', text: joinedText }] : []),
              ...images.map((img) => ({
                type: 'input_image',
                image_url: OpenAIResponsesLLMClient.toDataUrl(img),
              })),
            ],
          });
        } else {
          items.push({ role, content: joinedText });
        }
      }

      items.push(...pendingCalls, ...pendingOutputs);

      // Images cannot ride inside a function_call_output; re-attach them as a
      // follow-up user message (parity with the chat adapter).
      if (toolResultImages.length) {
        items.push({
          role: 'user',
          content: [
            { type: 'input_text', text: 'The tool returned the following image(s) for visual inspection:' },
            ...toolResultImages.map((img) => ({
              type: 'input_image',
              image_url: OpenAIResponsesLLMClient.toDataUrl(img),
            })),
          ],
        });
      }
    }

    return items;
  }

  // ==========================================================================
  // Non-streaming
  // ==========================================================================

  async invoke(
    messages: Array<{ role: string; content: string | CacheableContent[] }>,
    options?: Record<string, any>,
  ): Promise<string> {
    const result = await this.invokeWithUsage(messages, options);
    return result.content;
  }

  async invokeWithUsage(
    messages: Array<{ role: string; content: string | CacheableContent[] }>,
    options?: Record<string, any>,
  ): Promise<LLMInvokeResult> {
    // One-shot callers (commit message, breadcrumb, compaction) pass small
    // budgets; force the cheapest effort so reasoning cannot eat the whole
    // ceiling and return zero text.
    const effort = this.resolveEffort(options?.enableThinking ?? false);
    const maxOutputTokens = this.resolveMaxOutputTokens(options?.maxTokens, effort);

    console.log(`🔥 [API CALL] provider=${this.provider} model=${this.modelName} method=invoke(responses) messages=${messages.length} effort=${effort}`);

    const response: any = await this.client.responses.create({
      model: this.modelName,
      input: this.convertToResponsesInput(messages as any, false),
      max_output_tokens: maxOutputTokens,
      reasoning: { effort },
      store: false,
      ...this.samplingParams(options?.temperature),
    } as any);

    return {
      content: OpenAIResponsesLLMClient.extractOutputText(response),
      usage: normalizeResponsesUsage(response?.usage),
    };
  }

  async invokeStructured<T = any>(
    messages: Array<{ role: string; content: string | CacheableContent[] }>,
    schema: Record<string, any>,
    schemaName: string,
    options?: { temperature?: number; maxTokens?: number; [key: string]: any },
  ): Promise<T> {
    const effort = this.resolveEffort(options?.enableThinking ?? false);
    const response: any = await this.client.responses.create({
      model: this.modelName,
      input: this.convertToResponsesInput(messages as any, false),
      max_output_tokens: this.resolveMaxOutputTokens(options?.maxTokens, effort),
      reasoning: { effort },
      store: false,
      // Native structured output — strictly better than the chat path's
      // `json_object` + prose-schema approximation.
      text: { format: { type: 'json_schema', name: schemaName, schema, strict: false } },
      ...this.samplingParams(options?.temperature),
    } as any);

    const content = OpenAIResponsesLLMClient.extractOutputText(response) || '{}';
    return JSON.parse(content) as T;
  }

  private static extractOutputText(response: any): string {
    if (typeof response?.output_text === 'string' && response.output_text) return response.output_text;
    const parts: string[] = [];
    for (const item of response?.output ?? []) {
      if (item?.type !== 'message') continue;
      for (const c of item.content ?? []) {
        if (c?.type === 'output_text' && typeof c.text === 'string') parts.push(c.text);
      }
    }
    return parts.join('');
  }

  // ==========================================================================
  // Streaming
  // ==========================================================================

  /**
   * Parsed-event BACKSTOP window — same 600s rationale as the chat adapter
   * (transport timers in llmDispatcher.ts own liveness). `reasoning.summary`
   * is requested precisely so a long reasoning phase keeps emitting parseable
   * events instead of looking like a stalled socket.
   */
  private resolveStreamIdleMs(): number {
    return 600_000;
  }

  async *stream(
    messages: Array<{ role: string; content: string | MessageContentBlock[] }>,
    options?: {
      tools?: ToolDefinition[];
      maxTokens?: number;
      stopSequences?: string[];
      toolChoice?: import('../../../core/ports/llm').LLMToolChoice;
      enableThinking?: boolean;
      signal?: AbortSignal;
      [key: string]: any;
    },
  ): AsyncIterable<LLMStreamEvent> {
    if (options?.stopSequences?.length && !OpenAIResponsesLLMClient.warnedStopUnsupported) {
      OpenAIResponsesLLMClient.warnedStopUnsupported = true;
      console.warn('⚠️  [OpenAIResponsesLLMClient] The Responses API has no `stop` parameter — stopSequences are ignored (generation continues past the tag; parsers still handle it).');
    }

    yield* withRetryStream(
      () => streamAttemptWithIdleAbort(
        (signal) => this._streamInternal(messages, { ...options, signal }),
        this.resolveStreamIdleMs(),
        options?.signal,
      ),
      {
        maxAttempts: 8,
        initialDelayMs: 2000,
        backoffMultiplier: 2,
        retryableErrors: ['overloaded_error', 'api_error', 'rate_limit_exceeded', 'rate_limit_error'],
        retryMarker: { type: 'retry' as const },
      },
    );
  }

  private static warnedStopUnsupported = false;

  private async *_streamInternal(
    messages: Array<{ role: string; content: string | MessageContentBlock[] }>,
    options?: {
      tools?: ToolDefinition[];
      maxTokens?: number;
      toolChoice?: import('../../../core/ports/llm').LLMToolChoice;
      enableThinking?: boolean;
      signal?: AbortSignal;
      [key: string]: any;
    },
  ): AsyncIterable<LLMStreamEvent> {
    const signal = options?.signal;
    // Cover a stop that lands between rounds, before any HTTP is issued.
    if (signal?.aborted) return;

    const effort = this.resolveEffort(options?.enableThinking);
    const maxOutputTokens = this.resolveMaxOutputTokens(options?.maxTokens, effort);
    // Effective tool set + native choice mode (shared `{ allow }` semantics).
    const resolvedTools = resolveToolChoice(options?.tools, options?.toolChoice);
    const toolsCount = resolvedTools.tools?.length || 0;

    console.log(`🔥 [API CALL] provider=${this.provider} model=${this.modelName} method=stream(responses) messages=${messages.length} tools=${toolsCount} effort=${effort} maxOut=${maxOutputTokens}`);

    const build = (includeReasoning: boolean) => ({
      model: this.modelName,
      input: this.convertToResponsesInput(messages, includeReasoning),
      ...this.toolsParam(resolvedTools.tools),
      // Only meaningful with tools declared (port contract). `'none'` keeps the
      // declarations in the request so a function_call-bearing history stays
      // self-consistent on forced-final rounds.
      ...(toolsCount && resolvedTools.mode ? { tool_choice: resolvedTools.mode } : {}),
      max_output_tokens: maxOutputTokens,
      // `summary: 'auto'` is load-bearing, not cosmetic: without streamed
      // reasoning events a long thinking phase is indistinguishable from a dead
      // socket to the idle watchdog.
      reasoning: { effort, summary: 'auto' as const },
      // Stateless: ANT replays reasoning itself, so nothing is retained server
      // side. `include` is what makes encrypted_content available to replay.
      store: false,
      include: ['reasoning.encrypted_content' as const],
      stream: true as const,
      ...this.samplingParams(options?.temperature),
    });

    let stream: any;
    try {
      stream = await this.client.responses.create(build(true) as any, { signal });
    } catch (error: any) {
      if (!isReasoningReplayRejection(error)) throw error;
      // Defensive: if the API ever rejects our replayed reasoning items (stale
      // ids, ordering), drop them for this request rather than failing the job.
      console.warn(`⚠️  [OpenAIResponsesLLMClient] Reasoning replay rejected (${error?.message}); retrying once without reasoning items.`);
      stream = await this.client.responses.create(build(false) as any, { signal });
    }

    yield* this._processResponsesStream(stream);
  }

  private async *_processResponsesStream(stream: any): AsyncIterable<LLMStreamEvent> {
    /** Streamed function-call arguments, keyed by output item id. */
    const toolArgs = new Map<string, string>();
    /** Function-call item id → {callId, name} captured at output_item.added, so
     *  argument fragments can be forwarded as routable tool_use_delta events. */
    const toolItemMeta = new Map<string, { callId: string; name: string }>();
    const reasoningItems: ReasoningItemRef[] = [];

    let tokenUsage: TaskTokenUsage | undefined;
    let stopReason: LLMStreamEvent['stopReason'];
    let sawFunctionCall = false;
    let emittedThinkingText = false;
    let toolIndex = 0;

    for await (const event of stream) {
      switch (event?.type) {
        case 'response.output_text.delta': {
          if (event.delta) yield { type: 'text', text: event.delta, index: 0, metadata: this.metadata() };
          break;
        }

        // Reasoning surfaces as a summary when `reasoning.summary` is set, and
        // as raw reasoning text on models that expose it. Either is a thinking delta.
        case 'response.reasoning_summary_text.delta':
        case 'response.reasoning_text.delta': {
          if (event.delta) {
            emittedThinkingText = true;
            yield { type: 'thinking', thinking: event.delta, index: 0, metadata: this.metadata() };
          }
          break;
        }

        // Function-call item opens — capture call id + name so argument
        // fragments below can be forwarded as routable tool_use_delta events.
        case 'response.output_item.added': {
          const item = event.item;
          if (item?.type === 'function_call' && item.id) {
            toolItemMeta.set(item.id, {
              callId: item.call_id || `call_${randomUUID()}`,
              name: item.name || '',
            });
          }
          break;
        }

        case 'response.function_call_arguments.delta': {
          if (event.item_id) {
            toolArgs.set(event.item_id, (toolArgs.get(event.item_id) || '') + (event.delta || ''));
            // ✅ Forward the raw fragment for live rendering (file-writing tools).
            const meta = toolItemMeta.get(event.item_id);
            if (meta?.name && event.delta) {
              yield {
                type: 'tool_use_delta',
                toolUseDelta: {
                  toolUseId: meta.callId,
                  name: meta.name,
                  partialInput: event.delta,
                },
                index: toolIndex,
                metadata: this.metadata(),
              };
            }
          }
          break;
        }

        case 'response.output_item.done': {
          const item = event.item;
          if (item?.type === 'reasoning') {
            reasoningItems.push({ id: item.id, encryptedContent: item.encrypted_content ?? undefined });
          } else if (item?.type === 'function_call') {
            sawFunctionCall = true;
            const raw = (item.arguments ?? toolArgs.get(item.id) ?? '').trim();
            let input: Record<string, any>;
            try {
              input = raw ? JSON.parse(raw) : {};
            } catch (error) {
              // Never drop the tool_use on a parse failure — the loop would end
              // with 0 tool calls and return a silent empty response.
              console.error(`[OpenAIResponsesLLMClient] Failed to parse tool arguments for ${item.name}:`, error);
              console.error('[OpenAIResponsesLLMClient] Raw arguments:', raw);
              input = {};
            }
            yield {
              type: 'tool_use',
              toolUse: {
                // Reuse the id already surfaced on tool_use_delta events for
                // this item, so delta and terminal events stay correlated.
                id: item.call_id || toolItemMeta.get(item.id)?.callId || `call_${randomUUID()}`,
                name: item.name || '',
                input,
                type: 'function' as const,
              },
              index: toolIndex++,
              metadata: this.metadata(),
            };
          }
          break;
        }

        case 'response.completed':
        case 'response.incomplete': {
          const response = event.response;
          tokenUsage = normalizeResponsesUsage(response?.usage) ?? tokenUsage;
          const incompleteReason = response?.incomplete_details?.reason;
          if (incompleteReason === 'max_output_tokens') {
            stopReason = 'max_tokens';
          } else if (sawFunctionCall) {
            // Responses reports `completed` even when the turn ended in tool
            // calls — without this derivation the tool loop reads every round
            // as a final answer and never executes a tool.
            stopReason = 'tool_use';
          } else if (response?.status === 'completed') {
            stopReason = 'end_turn';
          } else {
            stopReason = 'other';
          }
          break;
        }

        case 'response.failed':
        case 'error': {
          const err = event.response?.error ?? event;
          yield {
            type: 'error',
            error: { code: err?.code || 'api_error', message: err?.message || 'Responses API stream failed' },
            metadata: this.metadata(),
          };
          stopReason = stopReason ?? 'other';
          break;
        }
      }
    }

    // Carry this round's reasoning items forward. The accumulators upstream
    // (`thinkingSignature = event.signature`, last-wins) only materialize a
    // thinking block when some thinking TEXT was seen — so when the model
    // reasoned without emitting a summary, emit one zero-width space to make
    // the block exist. Invisible in the UI; without it the envelope is lost and
    // the next round re-derives the plan from scratch.
    if (reasoningItems.length) {
      const signature = encodeReasoningEnvelope(reasoningItems);
      if (signature) {
        if (!emittedThinkingText) {
          yield { type: 'thinking', thinking: '​', index: 0, metadata: this.metadata() };
        }
        yield { type: 'thinking', thinking: '', signature, index: 0, metadata: this.metadata() };
      }
    }

    yield {
      type: 'done',
      done: true,
      usage: tokenUsage,
      stopReason,
      metadata: this.metadata(),
    };
  }
}
