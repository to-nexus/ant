/**
 * MockLLMClient — Test-only LLM adapter
 *
 * Routes responses by LLMContext.nodeType so each agent graph node
 * receives a canned response in the exact parser format it expects.
 *
 * Activated via:
 *   - ANT_LLM_MOCK=true env var (E2E, cross-process)
 *   - setLLMClientFactory() hook (unit test, in-process)
 */

import type {
  LLMClient,
  LLMInvokeResult,
  LLMStreamEvent,
  CacheableContent,
  MessageContentBlock,
  ToolDefinition,
} from '../../../core/ports/llm';
import type { LLMContext } from './LLMClientFactory';
import { triageResponse } from './mock/triage';
import { detectResponse } from './mock/detect';
import { decomposeCodeResponse, decomposeDesignResponse } from './mock/decompose';
import { planResponse } from './mock/plan';
import { executeStreamEvents, executeInvokeResponse } from './mock/execute';

export class MockLLMClient implements LLMClient {
  readonly provider = 'mock';
  readonly modelName = 'mock-model';

  private agentJob?: string;
  private context?: LLMContext;

  constructor(agentJob?: string, context?: LLMContext) {
    this.agentJob = agentJob;
    this.context = context;
  }

  async invoke(
    messages: Array<{ role: string; content: string | CacheableContent[] }>,
    _options?: Record<string, any>,
  ): Promise<string> {
    const response = this.route(messages);
    console.log(`🧪 [MockLLM] invoke ${this.label()} → ${response.slice(0, 60).replace(/\n/g, '\\n')}...`);
    return response;
  }

  async invokeWithUsage(
    messages: Array<{ role: string; content: string | CacheableContent[] }>,
    options?: Record<string, any>,
  ): Promise<LLMInvokeResult> {
    const content = await this.invoke(messages, options);
    return {
      content,
      usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    };
  }

  async *stream(
    messages: Array<{ role: string; content: string | MessageContentBlock[] }>,
    _options?: { tools?: ToolDefinition[]; maxTokens?: number; [key: string]: any },
  ): AsyncIterable<LLMStreamEvent> {
    const nodeType = this.context?.nodeType;
    console.log(`🧪 [MockLLM] stream ${this.label()}`);

    if (nodeType === 'execute') {
      for (const event of executeStreamEvents()) {
        yield event;
      }
      return;
    }

    const text = this.route(messages as any);
    yield { type: 'text', text };
    yield {
      type: 'done',
      done: true,
      usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    };
  }

  async invokeStructured<T = any>(
    _messages: Array<{ role: string; content: string | CacheableContent[] }>,
    schema: Record<string, any>,
    schemaName: string,
  ): Promise<T> {
    console.log(`🧪 [MockLLM] invokeStructured ${this.label()} schema=${schemaName}`);
    return this.buildFromSchema(schema) as T;
  }

  private label(): string {
    return `(${this.agentJob ?? '?'}/${this.context?.jobType ?? '?'}/${this.context?.nodeType ?? 'default'})`;
  }

  private route(messages: Array<{ role: string; content: string | CacheableContent[] }>): string {
    const nodeType = this.context?.nodeType;
    const jobType = this.context?.jobType;

    if (nodeType === 'detect') {
      return detectResponse(jobType);
    }
    if (nodeType === 'decompose') {
      return jobType === 'design' ? decomposeDesignResponse() : decomposeCodeResponse();
    }
    if (nodeType === 'plan') {
      return planResponse();
    }
    if (nodeType === 'execute') {
      return executeInvokeResponse();
    }
    if (nodeType === 'docGen') {
      return '# Mock Design Document\n\nThis is a mock-generated design document.\n';
    }

    const text = this.extractText(messages);
    if (text.toLowerCase().includes('triage') || text.toLowerCase().includes('classify') || !nodeType) {
      return triageResponse();
    }

    return `Mock response for ${this.label()}`;
  }

  private extractText(messages: Array<{ role: string; content: string | any[] }>): string {
    const last = messages[messages.length - 1];
    if (!last) return '';
    if (typeof last.content === 'string') return last.content;
    if (Array.isArray(last.content)) {
      return last.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join(' ');
    }
    return '';
  }

  private buildFromSchema(schema: Record<string, any>): any {
    const props = schema.properties || {};
    const result: Record<string, any> = {};
    for (const [key, def] of Object.entries(props) as Array<[string, any]>) {
      switch (def.type) {
        case 'string': result[key] = `mock-${key}`; break;
        case 'number': case 'integer': result[key] = 0; break;
        case 'boolean': result[key] = false; break;
        case 'array': result[key] = []; break;
        case 'object': result[key] = {}; break;
        default: result[key] = null;
      }
    }
    return result;
  }
}
