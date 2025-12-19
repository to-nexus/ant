/**
 * AnthropicLLMClient
 * 
 * Direct Anthropic SDK integration for advanced features like thinking blocks.
 * Falls back to LangChain for compatibility with existing code.
 */

// @ts-ignore
import Anthropic from '@anthropic-ai/sdk';
import { LLMClient, LLMStreamEvent, ToolDefinition } from '../../../core/ports/llm';
import { withRetryStream } from '../../../core/utils/retry';

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

    // ✅ modelName은 반드시 명시적으로 제공되어야 함
    if (!config?.modelName) {
      throw new Error(
        'AnthropicLLMClient: modelName is required. ' +
        'Please provide it via config or ensure workspaceConfig.llmModels is properly configured.'
      );
    }
    
    this.modelName = config.modelName;
  }

  async invoke(messages: Array<{ role: string; content: string }>): Promise<string> {
    // ✅ Extract system message (Anthropic requires it as a separate parameter)
    const systemMessage = messages.find(m => m.role === 'system');
    const userMessages = messages.filter(m => m.role !== 'system');
    
    const response = await this.client.messages.create({
      model: this.modelName,
      max_tokens: 16000,
      ...(systemMessage && { system: systemMessage.content }),  // ✅ Add system parameter if exists
      messages: userMessages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    });

    // Extract text content (ignore thinking blocks for non-streaming)
    const textBlocks = response.content.filter((block: any) => block.type === 'text');
    return textBlocks.map((block: any) => block.text).join('');
  }

  /**
   * 🎯 Unified streaming interface with automatic retry
   * Handles thinking blocks, tool calling, and regular text
   * ✅ Retries on overloaded_error and api_error
   */
  async *stream(
    messages: Array<{ role: string; content: string | any[] }>,
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
      enableThinking?: boolean;
      [key: string]: any;
    }
  ): AsyncIterable<LLMStreamEvent> {
    // ✅ Conditionally enable Extended Thinking (default: true)
    const enableThinking = options?.enableThinking !== false;
    
    const stream = await this.client.messages.create({
      model: this.modelName,
      max_tokens: options?.maxTokens || 16000,
      // ✅ Conditionally enable Extended Thinking
      ...(enableThinking ? {
        thinking: {
          type: 'enabled',
          budget_tokens: 10000,
        }
      } : {}),
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

    // 🔴 FIX: Accumulate tool_use input across multiple deltas
    const toolUseBuffer: Map<number, { id: string; name: string; input: string }> = new Map();
    const thinkingBlocks: Map<number, { startTime: number; content: string }> = new Map();
    
    for await (const event of stream) {
      // Thinking block - START
      if (event.type === 'content_block_start' && event.content_block.type === 'thinking') {
        thinkingBlocks.set(event.index, {
          startTime: Date.now(),
          content: '',
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

      // 🔴 FIX: Tool use - START (initialize buffer)
      if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
        toolUseBuffer.set(event.index, {
          id: event.content_block.id,
          name: event.content_block.name,
          input: '',  // ✅ Start empty, will accumulate from deltas
        });
      }

      // 🔴 FIX: Tool use - DELTA (accumulate input JSON)
      if (event.type === 'content_block_delta' && event.delta.type === 'input_json_delta') {
        const buffer = toolUseBuffer.get(event.index);
        if (buffer) {
          buffer.input += event.delta.partial_json;  // ✅ Accumulate JSON
        }
      }

      // 🔴 FIX: Content block STOP (handle both tool_use and thinking)
      if (event.type === 'content_block_stop') {
        // ✅ Check if this is a thinking block ending
        const thinkingBlock = thinkingBlocks.get(event.index);
        if (thinkingBlock) {
          const durationMs = Date.now() - thinkingBlock.startTime;
          
          // ✅ Emit thinking end signal
          yield {
            type: 'thinking',
            thinking: '',  // Empty content
            index: event.index,
            metadata: {
              provider: 'anthropic',
              model: this.modelName,
              timestamp: new Date().toISOString(),
              blockEnd: true,  // ✅ Signal end
              durationMs,
            },
          };
          
          thinkingBlocks.delete(event.index);  // Clean up
        }
        
        // ✅ Check if this is a tool_use ending
        const buffer = toolUseBuffer.get(event.index);
        if (buffer) {
          try {
            const parsedInput = JSON.parse(buffer.input);  // ✅ Parse complete JSON
            yield {
              type: 'tool_use',
              toolUse: {
                id: buffer.id,
                name: buffer.name,
                input: parsedInput,  // ✅ Complete parsed input!
                type: 'function' as const,
              },
              index: event.index,
              metadata: {
                provider: 'anthropic',
                model: this.modelName,
                timestamp: new Date().toISOString(),
              },
            };
            toolUseBuffer.delete(event.index);  // ✅ Clean up
          } catch (error) {
            console.error(`[AnthropicLLM] Failed to parse tool input:`, buffer.input);
            console.error(error);
          }
        }
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

