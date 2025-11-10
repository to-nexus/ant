/**
 * AnthropicLLMClient
 * 
 * Direct Anthropic SDK integration for advanced features like thinking blocks.
 * Falls back to LangChain for compatibility with existing code.
 */

import Anthropic from '@anthropic-ai/sdk';
import { LLMClient, LLMStreamEvent } from '../../../core/ports/llm';

export class AnthropicLLMClient implements LLMClient {
  private client: Anthropic;
  public readonly provider = 'anthropic';
  public readonly modelName: string;

  constructor(
    private agentType?: string,
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

    this.modelName = config?.modelName || 
      process.env[`${agentType?.toUpperCase()}_MODEL_NAME`] || 
      'claude-sonnet-4-20250514';

    console.log(`\n🤖 [Anthropic] Direct SDK Client:`, {
      agentType,
      modelName: this.modelName,
    });
  }

  async invoke(messages: Array<{ role: string; content: string }>): Promise<string> {
    const response = await this.client.messages.create({
      model: this.modelName,
      max_tokens: 16000,
      messages: messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    });

    // Extract text content (ignore thinking blocks for non-streaming)
    const textBlocks = response.content.filter(block => block.type === 'text');
    return textBlocks.map(block => block.text).join('');
  }

  async *stream(messages: Array<{ role: string; content: string }>): AsyncIterable<string> {
    // Simple streaming (thinking + text combined, for backward compatibility)
    const stream = await this.client.messages.create({
      model: this.modelName,
      max_tokens: 16000,
      messages: messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      stream: true,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          yield event.delta.text;
        }
        // Note: thinking_delta is skipped for backward compatibility
      }
    }
  }

  /**
   * 🎯 NEW: Raw streaming with thinking/text separation
   */
  async *streamRaw(messages: Array<{ role: string; content: string }>): AsyncIterable<LLMStreamEvent> {
    const stream = await this.client.messages.create({
      model: this.modelName,
      max_tokens: 16000,
      messages: messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      stream: true,
    });

    let currentBlockIndex = 0;
    let currentBlockType: 'thinking' | 'text' | null = null;

    for await (const event of stream) {
      // Block start: identify type
      if (event.type === 'content_block_start') {
        currentBlockIndex = event.index;
        currentBlockType = event.content_block.type === 'thinking' ? 'thinking' : 'text';
      }

      // Block delta: stream content
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'thinking_delta') {
          yield {
            type: 'thinking',
            content: event.delta.thinking,
            index: event.index,
            metadata: {
              provider: 'anthropic',
              model: this.modelName,
              timestamp: new Date().toISOString(),
            },
          };
        } else if (event.delta.type === 'text_delta') {
          yield {
            type: 'text',
            content: event.delta.text,
            index: event.index,
            metadata: {
              provider: 'anthropic',
              model: this.modelName,
              timestamp: new Date().toISOString(),
            },
          };
        }
      }

      // Message complete
      if (event.type === 'message_stop') {
        yield {
          type: 'done',
          content: '',
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
    messages: Array<{ role: string; content: string }>,
    schema: Record<string, any>,
    schemaName: string
  ): Promise<T> {
    // Anthropic doesn't have native structured output yet
    // Fall back to text parsing
    const response = await this.invoke(messages);
    try {
      return JSON.parse(response) as T;
    } catch {
      throw new Error('Failed to parse structured response from Anthropic');
    }
  }
}

