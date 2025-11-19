/**
 * AnthropicLLMClient
 * 
 * Direct Anthropic SDK integration for advanced features like thinking blocks.
 * Falls back to LangChain for compatibility with existing code.
 */

// @ts-ignore
import Anthropic from '@anthropic-ai/sdk';
import { LLMClient, LLMStreamEvent, ToolDefinition } from '../../../core/ports/llm';

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
    const textBlocks = response.content.filter((block: any) => block.type === 'text');
    return textBlocks.map((block: any) => block.text).join('');
  }

  /**
   * 🎯 Unified streaming interface
   * Handles thinking blocks, tool calling, and regular text
   */
  async *stream(
    messages: Array<{ role: string; content: string | any[] }>,
    options?: {
      tools?: ToolDefinition[];
      maxTokens?: number;
      [key: string]: any;
    }
  ): AsyncIterable<LLMStreamEvent> {
    const stream = await this.client.messages.create({
      model: this.modelName,
      max_tokens: options?.maxTokens || 16000,
      messages: messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
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

    for await (const event of stream) {
      // Thinking block
      if (event.type === 'content_block_delta' && event.delta.type === 'thinking_delta') {
        yield {
          type: 'thinking',
          thinking: event.delta.thinking,  // ✅ NEW: 명시적 thinking 필드
          index: event.index,
          metadata: {
            provider: 'anthropic',
            model: this.modelName,
            timestamp: new Date().toISOString(),
          },
        };
      }

      // Text block
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield {
          type: 'text',
          text: event.delta.text,  // ✅ NEW: 명시적 text 필드
          index: event.index,
          metadata: {
            provider: 'anthropic',
            model: this.modelName,
            timestamp: new Date().toISOString(),
          },
        };
      }

      // Tool use
      if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
        yield {
          type: 'tool_use',
          toolUse: {
            id: event.content_block.id,
            name: event.content_block.name,
            input: event.content_block.input,
            type: 'function' as const,  // ✅ NEW: 분류 추가
          },
          index: event.index,
          metadata: {
            provider: 'anthropic',
            model: this.modelName,
            timestamp: new Date().toISOString(),
          },
        };
      }

      // Message complete
      if (event.type === 'message_stop') {
        yield {
          type: 'done',
          done: true,  // ✅ NEW: 명시적 done 플래그
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
    // Add JSON schema to prompt
    const lastMessage = messages[messages.length - 1];
    const enhancedMessages = [
      ...messages.slice(0, -1),
      {
        role: lastMessage.role,
        content: `${lastMessage.content}

Please respond with ONLY a valid JSON object that matches this schema:
\`\`\`json
${JSON.stringify(schema, null, 2)}
\`\`\`

Do not include any explanatory text before or after the JSON. Start your response with { and end with }.`
      }
    ];
    
    const response = await this.invoke(enhancedMessages);
    
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

