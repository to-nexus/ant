/**
 * OpenAILLMClient
 * 
 * Direct OpenAI SDK integration.
 * Compatible with existing GenericLLMClient interface.
 */

import OpenAI from 'openai';
import { LLMClient, LLMStreamEvent, ToolDefinition } from '../../../core/ports/llm';

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
   * 🎯 Unified streaming interface
   * OpenAI doesn't separate thinking blocks like Anthropic
   */
  async *stream(
    messages: Array<{ role: string; content: string | any[] }>,
    options?: {
      tools?: ToolDefinition[];
      maxTokens?: number;
      [key: string]: any;
    }
  ): AsyncIterable<LLMStreamEvent> {
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

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield {
          type: 'text',
          text: content,  // ✅ NEW: 명시적 text 필드
          metadata: {
            provider: 'openai',
            model: this.modelName,
            timestamp: new Date().toISOString(),
          },
        };
      }

      // Tool calls (OpenAI format)
      const toolCalls = chunk.choices[0]?.delta?.tool_calls;
      if (toolCalls && toolCalls.length > 0) {
        for (const toolCall of toolCalls) {
          if (toolCall.function) {
            yield {
              type: 'tool_use',
              toolUse: {
                id: toolCall.id || `call_${Date.now()}`,
                name: toolCall.function.name || '',
                input: JSON.parse(toolCall.function.arguments || '{}'),
                type: 'function' as const,  // ✅ NEW: 분류 추가
              },
              metadata: {
                provider: 'openai',
                model: this.modelName,
                timestamp: new Date().toISOString(),
              },
            };
          }
        }
      }

      // Check for finish
      if (chunk.choices[0]?.finish_reason) {
        yield {
          type: 'done',
          done: true,  // ✅ NEW: 명시적 done 플래그
          metadata: {
            provider: 'openai',
            model: this.modelName,
            timestamp: new Date().toISOString(),
          },
        };
      }
    }
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

