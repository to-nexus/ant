/**
 * OpenAILLMClient
 * 
 * Direct OpenAI SDK integration.
 * Compatible with existing GenericLLMClient interface.
 */

import OpenAI from 'openai';
import { LLMClient, LLMStreamEvent } from '../../../core/ports/llm';

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

  async *stream(messages: Array<{ role: string; content: string }>): AsyncIterable<string> {
    const stream = await this.client.chat.completions.create({
      model: this.modelName,
      messages: messages.map(m => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      })),
      temperature: 0.7,
      max_tokens: 16000,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  }

  /**
   * 🎯 Raw streaming (OpenAI doesn't separate thinking like Anthropic)
   * For compatibility, wrap all content as 'text' type
   */
  async *streamRaw(messages: Array<{ role: string; content: string }>): AsyncIterable<LLMStreamEvent> {
    const stream = await this.client.chat.completions.create({
      model: this.modelName,
      messages: messages.map(m => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      })),
      temperature: 0.7,
      max_tokens: 16000,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield {
          type: 'text',
          content,
          metadata: {
            provider: 'openai',
            model: this.modelName,
            timestamp: new Date().toISOString(),
          },
        };
      }

      // Check for finish
      if (chunk.choices[0]?.finish_reason) {
        yield {
          type: 'done',
          content: '',
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

