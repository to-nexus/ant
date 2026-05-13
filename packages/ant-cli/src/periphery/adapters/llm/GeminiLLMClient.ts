/**
 * GeminiLLMClient
 *
 * Google Gemini SDK integration for text generation (logic models).
 * Used for reasoning/planning nodes in the visual job (direct, engrave, triage, resolve).
 * Image generation uses GeminiImageClient instead.
 */

import { GoogleGenAI } from '@google/genai';
import {
  LLMClient,
  LLMStreamEvent,
  ToolDefinition,
  LLMInvokeResult,
  CacheableContent,
  ImageContentBlock,
  MessageContentBlock,
  ToolResultContentBlock,
  ToolUseContentBlock,
} from '../../../core/ports/llm';
import { TaskTokenUsage } from '../../../core/types/task';
import { withRetry } from '../../../core/utils/retry';

export class GeminiLLMClient implements LLMClient {
  private client: GoogleGenAI;
  public readonly provider = 'google';
  public readonly modelName: string;
  private temperature: number;
  private maxTokens: number;

  constructor(
    private agentJob?: string,
    config?: {
      apiKey?: string;
      modelName?: string;
      temperature?: number;
      maxTokens?: number;
    }
  ) {
    const apiKey = config?.apiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GeminiLLMClient: GEMINI_API_KEY is required');
    }

    this.client = new GoogleGenAI({ apiKey });

    if (!config?.modelName) {
      throw new Error(
        'GeminiLLMClient: modelName is required. ' +
        'Please provide it via config or ensure workspaceConfig.llmModels is properly configured.'
      );
    }

    this.modelName = config.modelName;
    this.temperature = config?.temperature ?? 0.7;
    this.maxTokens = config?.maxTokens ?? 16000;
  }

  async invoke(
    messages: Array<{ role: string; content: string | CacheableContent[] }>,
    options?: Record<string, any>
  ): Promise<string> {
    const result = await this.invokeWithUsage(messages, options);
    return result.content;
  }

  async invokeWithUsage(
    messages: Array<{ role: string; content: string | CacheableContent[] }>,
    options?: Record<string, any>
  ): Promise<LLMInvokeResult> {
    const { systemInstruction, contents } = this.convertMessages(messages);

    console.log(`🔥 [API CALL] provider=google model=${this.modelName} method=invoke messages=${messages.length}`);

    const response = await withRetry(
      async () => {
        return await this.client.models.generateContent({
          model: this.modelName,
          contents,
          config: {
            ...(systemInstruction ? { systemInstruction } : {}),
            temperature: this.temperature,
            maxOutputTokens: options?.maxTokens || this.maxTokens,
          },
        });
      },
      {
        maxAttempts: 6,
        initialDelayMs: 2000,
        maxDelayMs: 60000,
        backoffMultiplier: 2,
        retryableErrors: ['RESOURCE_EXHAUSTED', 'UNAVAILABLE', 'INTERNAL', '429', '500', '503'],
      }
    );

    const text = response.text ?? '';

    const usage: TaskTokenUsage | undefined = response.usageMetadata ? {
      inputTokens: response.usageMetadata.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata.candidatesTokenCount ?? 0,
      totalTokens: (response.usageMetadata.promptTokenCount ?? 0) + (response.usageMetadata.candidatesTokenCount ?? 0),
    } : undefined;

    return { content: text, usage };
  }

  async *stream(
    messages: Array<{ role: string; content: string | MessageContentBlock[] }>,
    options?: {
      tools?: ToolDefinition[];
      maxTokens?: number;
      [key: string]: any;
    }
  ): AsyncIterable<LLMStreamEvent> {
    const { systemInstruction, contents } = this.convertMessages(messages);
    const toolsCount = options?.tools?.length || 0;

    console.log(`🔥 [API CALL] provider=google model=${this.modelName} method=stream messages=${messages.length} tools=${toolsCount}`);

    const geminiTools = options?.tools?.length ? [{
      functionDeclarations: options.tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.input_schema as any,
      })),
    }] : undefined;

    const response = await this.client.models.generateContentStream({
      model: this.modelName,
      contents,
      config: {
        ...(systemInstruction ? { systemInstruction } : {}),
        temperature: this.temperature,
        maxOutputTokens: options?.maxTokens || this.maxTokens,
        ...(geminiTools ? { tools: geminiTools } : {}),
      },
    });

    let tokenUsage: TaskTokenUsage | undefined;
    let stopReason: LLMStreamEvent['stopReason'] | undefined;
    // Throttle partial emits: Gemini streams may surface usageMetadata per chunk.
    let lastPartialEmitAt = 0;
    let lastPartialOutputTokens = 0;
    const PARTIAL_USAGE_MIN_INTERVAL_MS = 500;
    const PARTIAL_USAGE_MIN_TOKEN_DELTA = 100;

    for await (const chunk of response) {
      if (chunk.usageMetadata) {
        const prev = tokenUsage;
        tokenUsage = {
          inputTokens: chunk.usageMetadata.promptTokenCount ?? 0,
          outputTokens: chunk.usageMetadata.candidatesTokenCount ?? 0,
          totalTokens: (chunk.usageMetadata.promptTokenCount ?? 0) + (chunk.usageMetadata.candidatesTokenCount ?? 0),
        };

        // Emit usage_partial so the chat-input gauge reflects in-flight usage.
        // First observation: emit immediately (exposes prompt size). Subsequent:
        // throttle by time+delta to avoid Redis/SSE flood.
        const now = Date.now();
        const outputDelta = tokenUsage.outputTokens - lastPartialOutputTokens;
        const shouldEmit =
          !prev ||
          now - lastPartialEmitAt >= PARTIAL_USAGE_MIN_INTERVAL_MS ||
          outputDelta >= PARTIAL_USAGE_MIN_TOKEN_DELTA;
        if (shouldEmit) {
          lastPartialEmitAt = now;
          lastPartialOutputTokens = tokenUsage.outputTokens;
          yield {
            type: 'usage_partial',
            usage: { ...tokenUsage },
          };
        }
      }

      if (!chunk.candidates?.[0]?.content?.parts) continue;

      for (const part of chunk.candidates[0].content.parts) {
        if (part.text) {
          yield { type: 'text', text: part.text };
        }

        if (part.functionCall) {
          yield {
            type: 'tool_use',
            toolUse: {
              id: `gemini-tool-${Date.now()}`,
              name: part.functionCall.name!,
              input: (part.functionCall.args as Record<string, any>) ?? {},
              thoughtSignature: part.thoughtSignature,
            },
          };
        }
      }

      if (chunk.candidates?.[0]?.finishReason) {
        const finishReason = chunk.candidates[0].finishReason;
        if (finishReason === 'SAFETY') {
          yield {
            type: 'error',
            error: { code: 'safety_block', message: 'Response blocked by Gemini safety filter' },
          };
        }
        // Map Gemini finishReason to the unified stopReason enum. MAX_TOKENS
        // is the truncation signal callers gate on.
        switch (finishReason) {
          case 'STOP': stopReason = 'end_turn'; break;
          case 'MAX_TOKENS': stopReason = 'max_tokens'; break;
          default: stopReason = 'other'; break;
        }
      }
    }

    yield {
      type: 'done',
      done: true,
      usage: tokenUsage,
      stopReason,
    };
  }

  async invokeStructured<T = any>(
    messages: Array<{ role: string; content: string | CacheableContent[] }>,
    schema: Record<string, any>,
    schemaName: string
  ): Promise<T> {
    const { systemInstruction, contents } = this.convertMessages(messages);

    console.log(`🔥 [API CALL] provider=google model=${this.modelName} method=invokeStructured schema=${schemaName}`);

    const response = await withRetry(
      async () => {
        return await this.client.models.generateContent({
          model: this.modelName,
          contents,
          config: {
            ...(systemInstruction ? { systemInstruction } : {}),
            temperature: this.temperature,
            maxOutputTokens: this.maxTokens,
            responseMimeType: 'application/json',
            responseSchema: schema,
          },
        });
      },
      {
        maxAttempts: 6,
        initialDelayMs: 2000,
        maxDelayMs: 60000,
        backoffMultiplier: 2,
        retryableErrors: ['RESOURCE_EXHAUSTED', 'UNAVAILABLE', 'INTERNAL', '429', '500', '503'],
      }
    );

    const text = response.text ?? '';

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`Failed to parse structured response from Gemini: ${text.slice(0, 200)}`);
    }
  }

  /**
   * Convert unified message format to Gemini SDK format.
   * Extracts system instruction and builds content parts.
   */
  private convertMessages(
    messages: Array<{ role: string; content: string | MessageContentBlock[] }>
  ): { systemInstruction: string | undefined; contents: any[] } {
    let systemInstruction: string | undefined;
    const contents: any[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemInstruction = this.extractText(msg.content);
        continue;
      }

      const role = msg.role === 'assistant' ? 'model' : 'user';
      const parts = this.convertContentToParts(msg.content);

      if (parts.length > 0) {
        contents.push({ role, parts });
      }
    }

    return { systemInstruction, contents };
  }

  private extractText(content: string | MessageContentBlock[]): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n');
    }
    return String(content);
  }

  private convertContentToParts(content: string | MessageContentBlock[]): any[] {
    if (typeof content === 'string') {
      return [{ text: content }];
    }

    if (!Array.isArray(content)) {
      return [{ text: String(content) }];
    }

    const parts: any[] = [];

    for (const block of content) {
      if (block.type === 'text') {
        parts.push({ text: block.text });
      } else if (block.type === 'image') {
        const imageBlock = block as ImageContentBlock;
        parts.push({
          inlineData: {
            mimeType: imageBlock.source.media_type,
            data: imageBlock.source.data,
          },
        });
      } else if (block.type === 'tool_use') {
        const tb = block as ToolUseContentBlock;
        parts.push({
          functionCall: { name: tb.name, args: tb.input },
          ...(tb.thoughtSignature ? { thoughtSignature: tb.thoughtSignature } : {}),
        });
      } else if (block.type === 'tool_result') {
        const tb = block as ToolResultContentBlock;
        const textResult = this.extractToolResultText(tb.content);
        parts.push({
          functionResponse: {
            name: tb.tool_name,
            response: { result: textResult },
          },
        });
        if (Array.isArray(tb.content)) {
          const imageCount = tb.content.filter(sub => sub.type === 'image').length;
          if (imageCount > 0) {
            console.warn(`⚠️ [GeminiLLM] Dropping ${imageCount} image(s) from tool_result "${tb.tool_name}" — Gemini does not reliably handle inlineData alongside functionResponse. Use prompt-level image embedding instead.`);
          }
        }
      }
      // 'thinking' blocks are Anthropic-specific; skip for Gemini
    }

    return parts;
  }

  private extractToolResultText(content: CacheableContent[] | string): string {
    if (typeof content === 'string') return content;
    return content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text)
      .join('\n');
  }
}
