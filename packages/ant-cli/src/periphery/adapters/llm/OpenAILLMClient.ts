/**
 * OpenAILLMClient
 * 
 * Direct OpenAI SDK integration.
 * Compatible with existing GenericLLMClient interface.
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
} from '../../../core/ports/llm';
import { TaskTokenUsage } from '../../../core/types/task';
import { withRetryStream } from '../../../core/utils/retry';
import { sanitizeMessages } from '../../../core/utils/sanitizeMessages';

/**
 * OpenAI-compatible providers that accept the `thinking:{type}` request param, mapped
 * to the env var that toggles it off ('disabled'). Absent providers (real OpenAI)
 * never receive the param. Add a provider here when its endpoint mirrors this shape.
 */
const THINKING_TOGGLE_PROVIDERS: Record<string, string> = {
  deepseek: 'DEEPSEEK_THINKING',
  glm: 'GLM_THINKING',
};

/**
 * Normalize an OpenAI-compatible `usage` object to the disjoint {@link TaskTokenUsage}
 * contract. OpenAI-compatible providers (OpenAI, DeepSeek, GLM/Zhipu) report
 * `prompt_tokens` INCLUDING the cached portion, with
 * `prompt_tokens_details.cached_tokens` as a subset. The rate card + tokenUtils
 * assume Anthropic semantics where `inputTokens` is cache-MISS only (disjoint from
 * `cacheReadTokens`). Subtracting the cached subset here keeps the two axes disjoint
 * so cached tokens are not billed twice (full input rate AND cache-read rate).
 */
export function normalizeOpenAICompatUsage(usage: {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
  prompt_tokens_details?: { cached_tokens?: number | null } | null;
} | null | undefined): TaskTokenUsage | undefined {
  if (!usage) return undefined;
  const cached = usage.prompt_tokens_details?.cached_tokens || 0;
  const promptTokens = usage.prompt_tokens || 0;
  return {
    inputTokens: Math.max(0, promptTokens - cached),
    outputTokens: usage.completion_tokens || 0,
    totalTokens: usage.total_tokens || 0,
    ...(cached ? { cacheReadTokens: cached } : {}),
  };
}

export class OpenAILLMClient implements LLMClient {
  private client: OpenAI;
  /**
   * Provider tag. Defaults to 'openai' but the factory injects 'deepseek' or 'glm'
   * when this client is reused for those OpenAI-compatible endpoints. Drives the
   * per-provider `thinking` param (see THINKING_TOGGLE_PROVIDERS) and honest
   * event/log labelling.
   */
  public readonly provider: string;
  public readonly modelName: string;
  private readonly temperature: number;

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
    }
  ) {
    this.client = new OpenAI({
      apiKey: config?.apiKey || process.env.OPENAI_API_KEY,
      baseURL: config?.baseURL,
      timeout: config?.timeout || 180000, // 3 minutes
    });

    this.provider = config?.provider ?? 'openai';
    this.temperature = config?.temperature ?? 0.7;

    // ✅ modelName은 반드시 명시적으로 제공되어야 함
    if (!config?.modelName) {
      throw new Error(
        'OpenAILLMClient: modelName is required. ' +
        'Please provide it via config or ensure workspaceConfig.llmModels is properly configured.'
      );
    }

    this.modelName = config.modelName;
  }

  /**
   * Thinking-param SSOT for OpenAI-compat toggle providers (DeepSeek, GLM/Zhipu),
   * shared by the streaming and non-streaming paths. Honors the caller's
   * per-round `enableThinking` (parity with AnthropicLLMClient, 5e981a1f):
   * ignoring it kept GLM reasoning every round → max_tokens truncation
   * (empty-calming-alder). The provider's *_THINKING=disabled env is an
   * operator hard opt-out that wins. Returns `{}` for real OpenAI (no such
   * field) and any non-toggle provider.
   */
  private resolveThinkingParam(options?: { enableThinking?: boolean }): Record<string, unknown> {
    const thinkingToggleEnv = THINKING_TOGGLE_PROVIDERS[this.provider];
    if (!thinkingToggleEnv) return {};
    const envDisabled = process.env[thinkingToggleEnv] === 'disabled';
    const enabled = !envDisabled && options?.enableThinking !== false;
    return { thinking: { type: enabled ? 'enabled' : 'disabled' } };
  }

  async invoke(messages: Array<{ role: string; content: string | CacheableContent[] }>, options?: Record<string, any>): Promise<string> {
    const result = await this.invokeWithUsage(messages as any, options);
    return result.content;
  }

  async invokeWithUsage(
    messages: Array<{ role: string; content: string | CacheableContent[] }>,
    options?: Record<string, any>
  ): Promise<LLMInvokeResult> {
    // ✅ LOG: Actual API call with model name
    console.log(`🔥 [API CALL] provider=${this.provider} model=${this.modelName} method=invoke messages=${messages.length} temp=${options?.temperature ?? this.temperature}`);
    
    const toDataUrl = (img: any): string => {
      const mediaType = img?.source?.media_type;
      const data = img?.source?.data;
      if (!mediaType || !data) throw new Error(`[OpenAILLMClient] Invalid image block (missing media_type/data)`);
      return `data:${mediaType};base64,${data}`;
    };

    // OpenAI supports multimodal content as an array of parts (text + image_url) in chat completions.
    const normalizeChatContent = (content: string | CacheableContent[]): any => {
      if (typeof content === 'string') return content;
      if (!Array.isArray(content)) return String(content);

      const hasImage = content.some((c: any) => c?.type === 'image');
      if (!hasImage) {
        // Preserve old behavior: join text blocks
        return content
          .filter((c: any) => c?.type === 'text')
          .map((c: any) => c.text)
          .join('');
      }

      // Build ordered parts
      return content.map((c: any) => {
        if (c?.type === 'text') return { type: 'text', text: c.text };
        if (c?.type === 'image') return { type: 'image_url', image_url: { url: toDataUrl(c) } };
        return { type: 'text', text: String(c) };
      });
    };
    
    const response = await this.client.chat.completions.create({
      model: this.modelName,
      // Provider-neutral guard: strip empty text blocks; see sanitizeMessages.
      messages: sanitizeMessages(messages).map(m => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: normalizeChatContent(m.content),
      })),
      temperature: options?.temperature ?? this.temperature,
      max_tokens: options?.maxTokens || 16000,
      ...this.resolveThinkingParam(options),
    } as any);

    const content = response.choices[0]?.message?.content || '';

    // ✅ Extract token usage, normalized to the disjoint contract (cached tokens
    // are a subset of prompt_tokens on OpenAI-compatible providers).
    const usage = normalizeOpenAICompatUsage(response.usage as any);

    return { content, usage };
  }

  /**
   * 🎯 Unified streaming interface with automatic retry
   * OpenAI doesn't separate thinking blocks like Anthropic
   * ✅ Retries on overloaded_error and api_error
   */
  async *stream(
    messages: Array<{ role: string; content: string | MessageContentBlock[] }>,
    options?: {
      tools?: ToolDefinition[];
      maxTokens?: number;
      /** Per-round thinking toggle from the tool-loop; honored by hard-toggle
       *  OpenAI-compat providers (DeepSeek, GLM) — see `_streamInternal`. */
      enableThinking?: boolean;
      [key: string]: any;
    }
  ): AsyncIterable<LLMStreamEvent> {
    yield* withRetryStream(
      () => this._streamInternal(messages, options),
      {
        // Parity with the Anthropic path (8). DeepSeek 429/500/503 are common
        // under load; retry.ts classifies 429 + status>=500 as retryable.
        maxAttempts: 8,
        initialDelayMs: 2000,
        backoffMultiplier: 2,
        retryableErrors: ['overloaded_error', 'api_error', 'rate_limit_exceeded', 'rate_limit_error'],
        retryMarker: { type: 'retry' as const },
      }
    );
  }

  /**
   * Internal streaming implementation
   */
  private async *_streamInternal(
    messages: Array<{ role: string; content: string | MessageContentBlock[] }>,
    options?: {
      tools?: ToolDefinition[];
      maxTokens?: number;
      enableThinking?: boolean;
      [key: string]: any;
    }
  ): AsyncIterable<LLMStreamEvent> {
    const toolsCount = options?.tools?.length || 0;
    console.log(`🔥 [API CALL] provider=${this.provider} model=${this.modelName} method=stream messages=${messages.length} tools=${toolsCount} temp=${options?.temperature ?? this.temperature}`);

    const isCodexModel = this.modelName.includes('codex') || this.modelName.startsWith('gpt-5');
    const openAIMessages = this.convertToOpenAIMessages(messages);
    const temperature = options?.temperature ?? this.temperature;

    const providerExtra = this.resolveThinkingParam(options);

    const toolsConfig = options?.tools?.length ? {
      tools: options.tools.map(t => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      })),
    } : {};

    if (isCodexModel) {
      const hasImage = messages.some(m =>
        Array.isArray(m.content) && m.content.some(c => c.type === 'image')
      );
      if (hasImage) {
        console.warn(`⚠️  [OpenAILLMClient] Multimodal input detected. Falling back to chat.completions stream for model=${this.modelName}.`);
        const stream = await this.client.chat.completions.create({
          model: this.modelName,
          messages: openAIMessages,
          ...toolsConfig,
          temperature,
          max_tokens: options?.maxTokens || 16000,
          stream: true,
          stream_options: { include_usage: true },
        });
        yield* this._processChatCompletionsStream(stream);
        return;
      }

      const stream = await (this.client as any).responses.create({
        model: this.modelName,
        messages: openAIMessages,
        ...toolsConfig,
        temperature,
        max_tokens: options?.maxTokens || 16000,
        stream: true,
      });
      yield* this._processResponsesStream(stream);
    } else {
      // B1 (M2) — include_usage makes usage arrive in a final choices-empty
      // chunk (DeepSeek's only usage delivery). providerExtra adds DeepSeek's
      // thinking param and is empty for real OpenAI.
      const stream = await this.client.chat.completions.create({
        model: this.modelName,
        messages: openAIMessages,
        ...toolsConfig,
        temperature,
        max_tokens: options?.maxTokens || 16000,
        stream: true,
        stream_options: { include_usage: true },
        ...providerExtra,
      } as any);
      yield* this._processChatCompletionsStream(stream);
    }
  }

  /**
   * Convert unified MessageContentBlock[] messages to OpenAI's message format.
   *
   * OpenAI requires:
   * - Assistant tool_use → `tool_calls` property on assistant message
   * - Tool results → separate messages with `role: 'tool'`
   * - Images in tool results → appended as a user message with image_url parts
   * - Thinking blocks → stripped (OpenAI has no equivalent)
   */
  private convertToOpenAIMessages(
    messages: Array<{ role: string; content: string | MessageContentBlock[] }>
  ): any[] {
    const result: any[] = [];

    // Provider-neutral guard: strip empty text blocks (parity with the
    // Anthropic 400 case); see sanitizeMessages.
    for (const msg of sanitizeMessages(messages)) {
      if (typeof msg.content === 'string') {
        result.push({
          role: msg.role as 'user' | 'assistant' | 'system',
          content: msg.content,
        });
        continue;
      }

      if (!Array.isArray(msg.content)) {
        result.push({
          role: msg.role as 'user' | 'assistant' | 'system',
          content: String(msg.content),
        });
        continue;
      }

      const blocks = msg.content;
      const hasToolUse = blocks.some(b => b.type === 'tool_use');
      const hasToolResult = blocks.some(b => b.type === 'tool_result');

      if (msg.role === 'assistant' && hasToolUse) {
        const textParts = blocks.filter(b => b.type === 'text').map(b => (b as { type: 'text'; text: string }).text).join('');
        const toolCalls = blocks
          .filter((b): b is ToolUseContentBlock => b.type === 'tool_use')
          .map(b => ({
            id: b.id,
            type: 'function' as const,
            function: { name: b.name, arguments: JSON.stringify(b.input) },
          }));

        result.push({
          role: 'assistant' as const,
          content: textParts || null,
          tool_calls: toolCalls,
        });
      } else if (hasToolResult) {
        const imagePartsForFollowUp: any[] = [];

        for (const block of blocks) {
          if (block.type === 'tool_result') {
            const tb = block as ToolResultContentBlock;
            const textContent = typeof tb.content === 'string'
              ? tb.content
              : tb.content.filter(c => c.type === 'text').map(c => (c as { type: 'text'; text: string }).text).join('\n');

            result.push({
              role: 'tool' as const,
              tool_call_id: tb.tool_use_id,
              content: textContent,
            });

            if (Array.isArray(tb.content)) {
              for (const sub of tb.content) {
                if (sub.type === 'image') {
                  const img = sub as ImageContentBlock;
                  imagePartsForFollowUp.push({
                    type: 'image_url',
                    image_url: { url: `data:${img.source.media_type};base64,${img.source.data}` },
                  });
                }
              }
            }
          }
        }

        if (imagePartsForFollowUp.length > 0) {
          result.push({
            role: 'user' as const,
            content: [
              { type: 'text', text: 'The tool returned the following image(s) for visual inspection:' },
              ...imagePartsForFollowUp,
            ],
          });
        }
      } else {
        result.push({
          role: msg.role as 'user' | 'assistant' | 'system',
          content: this.convertBlocksToOpenAIParts(blocks),
        });
      }
    }

    return result;
  }

  private convertBlocksToOpenAIParts(blocks: MessageContentBlock[]): any {
    const hasImage = blocks.some(b => b.type === 'image');
    const textBlocks = blocks.filter(b => b.type === 'text');

    if (!hasImage) {
      return textBlocks.map(b => (b as { type: 'text'; text: string }).text).join('');
    }

    const parts: any[] = [];
    for (const block of blocks) {
      if (block.type === 'text') {
        parts.push({ type: 'text', text: (block as { type: 'text'; text: string }).text });
      } else if (block.type === 'image') {
        const img = block as ImageContentBlock;
        parts.push({
          type: 'image_url',
          image_url: { url: `data:${img.source.media_type};base64,${img.source.data}` },
        });
      }
    }
    return parts;
  }
  
  /**
   * Process chat completions stream (standard API)
   */
  private async *_processChatCompletionsStream(stream: any): AsyncIterable<LLMStreamEvent> {
    // ✅ Buffer for accumulating tool call arguments (OpenAI streams them incrementally)
    const toolCallBuffers = new Map<number, { id: string; name: string; arguments: string }>();
    // M4 — fallback key when a provider (DeepSeek) omits delta.tool_calls[].index,
    // so multiple concurrent tool calls never collapse into one buffer.
    let autoToolIndex = 0;

    // ✅ Track token usage + stop reason across the whole stream.
    let tokenUsage: TaskTokenUsage | undefined;
    let stopReason: LLMStreamEvent['stopReason'];

    const metadata = () => ({
      provider: this.provider,
      model: this.modelName,
      timestamp: new Date().toISOString(),
    });

    // B1 (M2) — capture usage from ANY chunk, not just the finish_reason one.
    // DeepSeek delivers usage in a trailing choices-empty chunk after the
    // finish_reason chunk, so reading it only inside the finish block loses it.
    const captureUsage = (chunk: any) => {
      if (!chunk.usage) return;
      // Normalize to the disjoint contract: `prompt_tokens` INCLUDES the cached
      // portion on OpenAI-compatible providers, so inputTokens is set to the
      // cache-MISS remainder (see normalizeOpenAICompatUsage). Without this the
      // cached tokens are billed twice (full input rate AND cache-read rate).
      tokenUsage = normalizeOpenAICompatUsage(chunk.usage);
    };

    for await (const chunk of stream) {
      captureUsage(chunk);

      const delta = chunk.choices[0]?.delta;

      const content = delta?.content;
      if (content) {
        yield { type: 'text', text: content, index: 0, metadata: metadata() };
      }

      // S2 (M6 surfacing) — DeepSeek streams chain-of-thought in
      // delta.reasoning_content. Surface as a thinking event (no signature).
      // ⚠️ reasoning_content is NEVER fed back into request messages (would 400);
      // convertToOpenAIMessages strips thinking blocks — locked by regression test.
      const reasoning = delta?.reasoning_content;
      if (reasoning) {
        yield { type: 'thinking', thinking: reasoning, index: 0, metadata: metadata() };
      }

      // Tool calls (OpenAI format) - accumulate arguments across chunks
      const toolCalls = delta?.tool_calls;
      if (toolCalls && toolCalls.length > 0) {
        for (const toolCall of toolCalls) {
          // M4 — honor the provider index when present; otherwise fall back to a
          // monotonic counter so index-less deltas don't merge.
          const index = toolCall.index ?? autoToolIndex++;

          if (!toolCallBuffers.has(index)) {
            toolCallBuffers.set(index, {
              // M5 — UUID avoids same-millisecond id collisions across calls.
              id: toolCall.id || `call_${randomUUID()}`,
              name: toolCall.function?.name || '',
              arguments: '',
            });
          }

          const buffer = toolCallBuffers.get(index)!;

          // Update id and name if provided (first chunk has them)
          if (toolCall.id) {
            buffer.id = toolCall.id;
          }
          if (toolCall.function?.name) {
            buffer.name = toolCall.function.name;
          }

          // Accumulate arguments (streamed incrementally)
          if (toolCall.function?.arguments) {
            buffer.arguments += toolCall.function.arguments;
          }
        }
      }

      // Observe finish — record the stop reason and emit accumulated tool calls,
      // but DEFER the `done` event until the loop ends so the trailing
      // usage-only chunk is reflected (B1).
      if (chunk.choices[0]?.finish_reason) {
        // Map OpenAI finish_reason to the unified stopReason enum.
        // OpenAI 'length' === Anthropic 'max_tokens' (output ceiling hit).
        const rawFinish = chunk.choices[0].finish_reason;
        switch (rawFinish) {
          case 'stop': stopReason = 'end_turn'; break;
          case 'length': stopReason = 'max_tokens'; break;
          case 'tool_calls': case 'function_call': stopReason = 'tool_use'; break;
          default: stopReason = 'other'; break;
        }

        // Emit all accumulated tool calls
        for (const [index, buffer] of toolCallBuffers.entries()) {
          if (!buffer.name) continue;
          let parsedInput: Record<string, any>;
          try {
            // Empty args = tool with no parameters → {}
            const argStr = buffer.arguments.trim();
            parsedInput = argStr ? JSON.parse(argStr) : {};
          } catch (error) {
            // B3 (M10) — parse failure must NOT drop the tool_use, or the tool
            // loop finishes with 0 tool calls and returns a silent empty
            // response. Fall back to {} like the Anthropic path.
            console.error(`[OpenAILLMClient] Failed to parse tool call arguments for ${buffer.name}:`, error);
            console.error(`[OpenAILLMClient] Raw arguments:`, buffer.arguments);
            parsedInput = {};
          }
          yield {
            type: 'tool_use',
            toolUse: { id: buffer.id, name: buffer.name, input: parsedInput, type: 'function' as const },
            index,
            metadata: metadata(),
          };
        }
      }
    }

    // B1 — single terminal done event, after the trailing usage chunk.
    yield {
      type: 'done',
      done: true,
      usage: tokenUsage,
      stopReason,
      metadata: metadata(),
    };
  }
  
  /**
   * Process responses API stream (newer API for Codex models)
   * Similar to chat completions but with slightly different structure
   */
  private async *_processResponsesStream(stream: any): AsyncIterable<LLMStreamEvent> {
    // Responses API uses same streaming format as chat completions
    yield* this._processChatCompletionsStream(stream);
  }

  async invokeStructured<T = any>(
    messages: Array<{ role: string; content: string }>,
    schema: Record<string, any>,
    schemaName: string,
    options?: { temperature?: number; maxTokens?: number; [key: string]: any }
  ): Promise<T> {
    const response = await this.client.chat.completions.create({
      model: this.modelName,
      // Provider-neutral guard: strip empty text blocks; see sanitizeMessages.
      messages: sanitizeMessages(messages).map(m => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      })),
      temperature: options?.temperature ?? this.temperature,
      max_tokens: options?.maxTokens ?? 16000,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content || '{}';
    
    // ✅ Token usage is tracked in invokeWithUsage, but for structured output we need to track it separately
    // Since invokeStructured doesn't use invokeWithUsage, we'll log token usage here but won't return it
    // This is acceptable because invokeStructured is used less frequently (mainly in decompose)
    if (response.usage) {
      console.log(`   Tokens: ${response.usage.total_tokens} total (${response.usage.prompt_tokens} in, ${response.usage.completion_tokens} out)`);
    }
    
    return JSON.parse(content) as T;
  }
}

