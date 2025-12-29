/**
 * OpenAILLMClient
 * 
 * Direct OpenAI SDK integration.
 * Compatible with existing GenericLLMClient interface.
 */

import OpenAI from 'openai';
import { LLMClient, LLMStreamEvent, ToolDefinition, LLMInvokeResult, CacheableContent } from '../../../core/ports/llm';
import { TaskTokenUsage } from '../../../agents/architect/types/task';
import { withRetryStream } from '../../../core/utils/retry';

export class OpenAILLMClient implements LLMClient {
  private client: OpenAI;
  public readonly provider = 'openai';
  public readonly modelName: string;

  constructor(
    private agentType?: string,
    config?: {
      apiKey?: string;
      modelName?: string;
      temperature?: number;
      maxTokens?: number;
      timeout?: number;
    }
  ) {
    this.client = new OpenAI({
      apiKey: config?.apiKey || process.env.OPENAI_API_KEY,
      timeout: config?.timeout || 180000, // 3 minutes
    });

    // ✅ modelName은 반드시 명시적으로 제공되어야 함
    if (!config?.modelName) {
      throw new Error(
        'OpenAILLMClient: modelName is required. ' +
        'Please provide it via config or ensure workspaceConfig.llmModels is properly configured.'
      );
    }
    
    this.modelName = config.modelName;
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
    console.log(`🔥 [API CALL] provider=openai model=${this.modelName} method=invoke messages=${messages.length}`);
    
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
      messages: messages.map(m => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: normalizeChatContent(m.content),
      })),
      temperature: 0.7,
      max_tokens: options?.maxTokens || 16000,
    });

    const content = response.choices[0]?.message?.content || '';
    
    // ✅ Extract token usage
    const usage = response.usage ? {
      inputTokens: response.usage.prompt_tokens || 0,
      outputTokens: response.usage.completion_tokens || 0,
      totalTokens: response.usage.total_tokens || 0,
    } : undefined;
    
    return { content, usage };
  }

  /**
   * 🎯 Unified streaming interface with automatic retry
   * OpenAI doesn't separate thinking blocks like Anthropic
   * ✅ Retries on overloaded_error and api_error
   */
  async *stream(
    messages: Array<{ role: string; content: string | CacheableContent[] | any[] }>,
    options?: {
      tools?: ToolDefinition[];
      maxTokens?: number;
      [key: string]: any;
    }
  ): AsyncIterable<LLMStreamEvent> {
    yield* withRetryStream(
      () => this._streamInternal(messages, options),
      {
        maxAttempts: 4,
        initialDelayMs: 2000,
        backoffMultiplier: 2,
        retryableErrors: ['overloaded_error', 'api_error'],
      }
    );
  }

  /**
   * Internal streaming implementation
   */
  private async *_streamInternal(
    messages: Array<{ role: string; content: string | CacheableContent[] | any[] }>,
    options?: {
      tools?: ToolDefinition[];
      maxTokens?: number;
      [key: string]: any;
    }
  ): AsyncIterable<LLMStreamEvent> {
    // ✅ LOG: Actual API call with model name
    const toolsCount = options?.tools?.length || 0;
    console.log(`🔥 [API CALL] provider=openai model=${this.modelName} method=stream messages=${messages.length} tools=${toolsCount}`);
    
    // ✅ Check if this is a Codex model that requires /v1/responses API
    const isCodexModel = this.modelName.includes('codex') || this.modelName.startsWith('gpt-5');
    
    const toDataUrl = (img: any): string => {
      const mediaType = img?.source?.media_type;
      const data = img?.source?.data;
      if (!mediaType || !data) throw new Error(`[OpenAILLMClient] Invalid image block (missing media_type/data)`);
      return `data:${mediaType};base64,${data}`;
    };

    const normalizeChatContent = (content: any): any => {
      if (typeof content === 'string') return content;
      if (!Array.isArray(content)) return content;

      const hasImage = content.some((c: any) => c?.type === 'image');
      if (!hasImage) {
        // If it's CacheableContent[] text blocks, join into a single string
        if (content.every((c: any) => c?.type === 'text')) {
          return content.map((c: any) => c.text).join('');
        }
        return content;
      }

      // Multimodal parts (chat.completions)
      return content.map((c: any) => {
        if (c?.type === 'text') return { type: 'text', text: c.text };
        if (c?.type === 'image') return { type: 'image_url', image_url: { url: toDataUrl(c) } };
        return { type: 'text', text: String(c) };
      });
    };
    
    if (isCodexModel) {
      // Use newer responses API for Codex models.
      // NOTE: If multimodal blocks are present, we fall back to chat.completions for now.
      // Reason: responses API payload shape differs across SDK versions; chat.completions multimodal is stable here.
      const hasImage = messages.some(m => Array.isArray(m.content) && (m.content as any[]).some((c: any) => c?.type === 'image'));
      if (hasImage) {
        console.warn(`⚠️  [OpenAILLMClient] Multimodal input detected. Falling back to chat.completions stream for model=${this.modelName}.`);
        const stream = await this.client.chat.completions.create({
          model: this.modelName,
          messages: messages.map(m => ({
            role: m.role as 'user' | 'assistant' | 'system',
            content: normalizeChatContent(m.content),
          })),
          ...(options?.tools && options.tools.length > 0 ? {
            tools: options.tools.map(t => ({
              type: 'function' as const,
              function: {
                name: t.name,
                description: t.description,
                parameters: t.input_schema,
              },
            })),
          } : {}),
          temperature: 0.7,
          max_tokens: options?.maxTokens || 16000,
          stream: true,
        });
        yield* this._processChatCompletionsStream(stream);
        return;
      }

      // Text-only: keep existing responses API usage
      const stream = await (this.client as any).responses.create({
        model: this.modelName,
        messages: messages.map(m => ({
          role: m.role as 'user' | 'assistant' | 'system',
          content: normalizeChatContent(m.content),
        })),
        ...(options?.tools && options.tools.length > 0 ? {
          tools: options.tools.map(t => ({
            type: 'function' as const,
            function: {
              name: t.name,
              description: t.description,
              parameters: t.input_schema,
            },
          })),
        } : {}),
        temperature: 0.7,
        max_tokens: options?.maxTokens || 16000,
        stream: true,
      });
      
      // Process responses API stream (similar format to chat completions)
      yield* this._processResponsesStream(stream);
    } else {
      // Use standard chat completions API
      const stream = await this.client.chat.completions.create({
        model: this.modelName,
        messages: messages.map(m => ({
          role: m.role as 'user' | 'assistant' | 'system',
          content: normalizeChatContent(m.content),
        })),
        ...(options?.tools && options.tools.length > 0 ? {
          tools: options.tools.map(t => ({
            type: 'function' as const,
            function: {
              name: t.name,
              description: t.description,
              parameters: t.input_schema,
            },
          })),
        } : {}),
        temperature: 0.7,
        max_tokens: options?.maxTokens || 16000,
        stream: true,
      });
      
      yield* this._processChatCompletionsStream(stream);
    }
  }
  
  /**
   * Process chat completions stream (standard API)
   */
  private async *_processChatCompletionsStream(stream: any): AsyncIterable<LLMStreamEvent> {
    // ✅ Buffer for accumulating tool call arguments (OpenAI streams them incrementally)
    const toolCallBuffers = new Map<number, { id: string; name: string; arguments: string }>();
    
    // ✅ Track token usage
    let tokenUsage: TaskTokenUsage | undefined;

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield {
          type: 'text',
          text: content,
          index: 0,  // OpenAI doesn't use multiple content blocks like Anthropic
          metadata: {
            provider: 'openai',
            model: this.modelName,
            timestamp: new Date().toISOString(),
          },
        };
      }

      // Tool calls (OpenAI format) - accumulate arguments across chunks
      const toolCalls = chunk.choices[0]?.delta?.tool_calls;
      if (toolCalls && toolCalls.length > 0) {
        for (const toolCall of toolCalls) {
          const index = toolCall.index;
          
          if (!toolCallBuffers.has(index)) {
            toolCallBuffers.set(index, {
              id: toolCall.id || `call_${Date.now()}`,
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

      // Check for finish - emit accumulated tool calls
      if (chunk.choices[0]?.finish_reason) {
        // ✅ Capture usage from final chunk
        if (chunk.usage) {
          tokenUsage = {
            inputTokens: chunk.usage.prompt_tokens || 0,
            outputTokens: chunk.usage.completion_tokens || 0,
            totalTokens: chunk.usage.total_tokens || 0,
          };
        }
        
        // Emit all accumulated tool calls
        for (const [index, buffer] of toolCallBuffers.entries()) {
          if (buffer.name && buffer.arguments) {
            try {
              const parsedInput = JSON.parse(buffer.arguments);
              yield {
                type: 'tool_use',
                toolUse: {
                  id: buffer.id,
                  name: buffer.name,
                  input: parsedInput,
                  type: 'function' as const,
                },
                index,
                metadata: {
                  provider: 'openai',
                  model: this.modelName,
                  timestamp: new Date().toISOString(),
                },
              };
            } catch (error) {
              console.error(`[OpenAILLMClient] Failed to parse tool call arguments for ${buffer.name}:`, error);
              console.error(`[OpenAILLMClient] Raw arguments:`, buffer.arguments);
            }
          }
        }
        
        yield {
          type: 'done',
          done: true,
          usage: tokenUsage,  // ✅ Include final token usage
          metadata: {
            provider: 'openai',
            model: this.modelName,
            timestamp: new Date().toISOString(),
          },
        };
      }
    }
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
    schemaName: string
  ): Promise<T> {
    const response = await this.client.chat.completions.create({
      model: this.modelName,
      messages: messages.map(m => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      })),
      temperature: 0.7,
      max_tokens: 16000,
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

