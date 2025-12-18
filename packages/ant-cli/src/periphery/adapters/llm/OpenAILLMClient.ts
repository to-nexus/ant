/**
 * OpenAILLMClient
 * 
 * Direct OpenAI SDK integration.
 * Compatible with existing GenericLLMClient interface.
 */

import OpenAI from 'openai';
import { LLMClient, LLMStreamEvent, ToolDefinition } from '../../../core/ports/llm';
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

    this.modelName = config?.modelName || 
      process.env[`${agentType?.toUpperCase()}_MODEL_NAME`] || 
      'gpt-4-turbo-preview';
  }

  async invoke(messages: Array<{ role: string; content: string }>): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.modelName,
      messages: messages.map(m => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      })),
      temperature: 0.7,
      max_tokens: 16000,
    });

    return response.choices[0]?.message?.content || '';
  }

  /**
   * 🎯 Unified streaming interface with automatic retry
   * OpenAI doesn't separate thinking blocks like Anthropic
   * ✅ Retries on overloaded_error and api_error
   */
  async *stream(
    messages: Array<{ role: string; content: string | any[] }>,
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
    messages: Array<{ role: string; content: string | any[] }>,
    options?: {
      tools?: ToolDefinition[];
      maxTokens?: number;
      [key: string]: any;
    }
  ): AsyncIterable<LLMStreamEvent> {
    // ✅ Check if this is a Codex model that requires /v1/responses API
    const isCodexModel = this.modelName.includes('codex') || this.modelName.startsWith('gpt-5');
    
    if (isCodexModel) {
      // Use newer responses API for Codex models
      const stream = await (this.client as any).responses.create({
        model: this.modelName,
        messages: messages.map(m => ({
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content,
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
          content: m.content,
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
    return JSON.parse(content) as T;
  }
}

