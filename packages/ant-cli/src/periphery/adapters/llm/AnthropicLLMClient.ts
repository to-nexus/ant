/**
 * AnthropicLLMClient
 * 
 * Direct Anthropic SDK integration for advanced features like thinking blocks.
 * Falls back to LangChain for compatibility with existing code.
 */

// @ts-ignore
import Anthropic from '@anthropic-ai/sdk';
import { LLMClient, LLMStreamEvent, ToolDefinition, LLMInvokeResult, CacheableContent } from '../../../core/ports/llm';
import { TaskTokenUsage } from '../../../agents/architect/types/task';
import { withRetryStream, withRetry, withStreamIdleTimeout } from '../../../core/utils/retry';

export class AnthropicLLMClient implements LLMClient {
  private client: Anthropic;
  public readonly provider = 'anthropic';
  public readonly modelName: string;

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
    
    console.log(`🔥 [API CALL] provider=anthropic model=${this.modelName} method=invoke messages=${messages.length} cacheable=${cacheableBlocks}`);
    
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
    
    const enableThinking = options?.enableThinking === true;
    const thinkingBudget = options?.thinkingBudget || 10000;
    const requestedMaxTokens = options?.maxTokens || 16000;
    const maxTokens = enableThinking
      ? Math.max(requestedMaxTokens, thinkingBudget + 2000)
      : requestedMaxTokens;
    
    // Use streaming internally to avoid Anthropic's 10-minute non-streaming timeout.
    // .messages.stream() + .finalMessage() gives us the same Message object
    // as .messages.create() but keeps the HTTP connection alive via SSE.
    // Wrapped with withRetry to handle overloaded_error delivered inside SSE stream
    // (HTTP 200 + error event), which bypasses the SDK's built-in HTTP-status retry.
    const response = await withRetry(
      async () => {
        const stream = this.client.messages.stream({
          model: this.modelName,
          max_tokens: maxTokens,
          ...(systemParam && { system: systemParam }),
          ...(enableThinking ? {
            thinking: {
              type: 'enabled',
              budget_tokens: thinkingBudget,
            }
          } : {}),
          messages: userMessages.map(m => ({
            role: m.role as 'user' | 'assistant',
            content: m.content as any,
          })),
        });
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
    messages: Array<{ role: string; content: string | CacheableContent[] | any[] }>,
    options?: {
      tools?: ToolDefinition[];
      maxTokens?: number;
      enableThinking?: boolean;
      [key: string]: any;
    }
  ): AsyncIterable<LLMStreamEvent> {
    yield* withRetryStream(
      () => this._streamInternal(messages, options),
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
    messages: Array<{ role: string; content: string | CacheableContent[] | any[] }>,
    options?: {
      tools?: ToolDefinition[];
      maxTokens?: number;
      enableThinking?: boolean;
      [key: string]: any;
    }
  ): AsyncIterable<LLMStreamEvent> {
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
    
    console.log(`🔥 [API CALL] provider=anthropic model=${this.modelName} method=stream messages=${userMessages.length} tools=${toolsCount} thinking=${enableThinking} cacheable=${cacheableBlocks}`);
    
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

    const stream = await this.client.messages.create({
      model: this.modelName,
      max_tokens: maxTokens,
      ...(systemParam ? { system: systemParam } : {}),
      ...(enableThinking ? {
        thinking: {
          type: 'enabled',
          budget_tokens: thinkingBudget,
        }
      } : {}),
      messages: userMessages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,  // API directly accepts CacheableContent[]
      })),
      ...(options?.tools && options.tools.length > 0 ? {
        tools: options.tools.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema,
        })),
      } : {}),
      stream: true,
    });

    // 🔴 FIX: Accumulate tool_use input across multiple deltas
    const toolUseBuffer: Map<number, { id: string; name: string; input: string }> = new Map();
    const thinkingBlocks: Map<number, { startTime: number; content: string; signature: string }> = new Map();
    
    // ✅ Track token usage (accumulate from message_start and message_delta)
    let tokenUsage: TaskTokenUsage | undefined;
    
    // Idle timeout: if no stream event is received for 90s, treat as terminated.
    // Handles Mac sleep/wake and silent network partitions where the TCP connection
    // appears open but data has stopped flowing (no OS-level "terminated" error).
    const STREAM_IDLE_TIMEOUT_MS = 90_000;
    for await (const event of withStreamIdleTimeout(stream, STREAM_IDLE_TIMEOUT_MS)) {
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
        
        // 200K pricing tier check (actual API-reported tokens)
        const totalPromptTokens = inputTokens + cacheReadTokens + cacheCreationTokens;
        if (totalPromptTokens > 200000) {
          console.error(`💸 [PRICING] OVER 200K! ${totalPromptTokens.toLocaleString()} prompt tokens → 2x pricing tier (input=$6, cache_read=$0.60, cache_write=$7.50 per MTok)`);
        } else if (totalPromptTokens > 160000) {
          console.warn(`⚠️  [PRICING] ${totalPromptTokens.toLocaleString()} prompt tokens — approaching 200K tier (${((totalPromptTokens / 200000) * 100).toFixed(0)}%)`);
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
          metadata: {
            provider: 'anthropic',
            model: this.modelName,
            timestamp: new Date().toISOString(),
          },
        };
      }
    }
  }

  async invokeStructured<T = any>(
    messages: Array<{ role: string; content: string | CacheableContent[] }>,
    schema: Record<string, any>,
    schemaName: string
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
    
    const result = await this.invokeWithUsage(enhancedMessages as any);
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

