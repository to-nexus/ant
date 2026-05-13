/**
 * Unit tests for the `onMaxTokensTruncation` hook on `runPlanWithTools`.
 *
 * Regression coverage for safe-braking-eagle: the shared helper must fire
 * its truncation hook when the LLM stream's `done` event reports
 * `stopReason === 'max_tokens'`, and must NOT fire it on normal completion.
 *
 * The helper drives ChatAPIClient / StreamOrchestrator / XMLStreamParser via
 * dynamic `import(...)` so the test mocks those modules at the top.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LLMClient, LLMStreamEvent, ToolDefinition } from '../../../../../../src/core/ports/llm';

vi.mock('../../../../../../src/core/adapters/ChatAPIClient', () => ({
  getChatAPIClient: () => ({
    showChatStatus: vi.fn().mockResolvedValue(undefined),
    sendLLMEvent: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../../../../../../src/core/streaming/parsers/XMLStreamParser', () => ({
  XMLStreamParser: class {},
}));

vi.mock('../../../../../../src/core/streaming/strategies/CommonRenderStrategy', () => ({
  CommonRenderStrategy: class {
    setPlanTaskTitle() {}
    setParallelTaskName() {}
  },
}));

vi.mock('../../../../../../src/core/streaming/StreamOrchestrator', () => ({
  StreamOrchestrator: class {
    async processEvent() {}
    async finalize() {}
  },
}));

vi.mock('../../../../../../src/agents/common/graph/llmHelpers', () => ({
  applyEstimatedInputTokensFromMessages: vi.fn(),
  maybeUpdatePhaseTokenUsage: vi.fn(),
}));

import { runPlanWithTools } from '../../../../../../src/agents/common/graph/nodes/plan';

async function* mockStream(events: LLMStreamEvent[]) {
  for (const ev of events) yield ev;
}

function makeLLM(events: LLMStreamEvent[]): LLMClient {
  return {
    stream: vi.fn(() => mockStream(events)),
  } as unknown as LLMClient;
}

const baseTools: ToolDefinition[] = [{
  name: 'read_file',
  description: 'read a file',
  parameters: { type: 'object', properties: {}, required: [] },
}];

const baseArgs = (llm: LLMClient, onMaxTokensTruncation?: any) => ({
  state: {} as any,
  messages: [{ role: 'user' as const, content: 'first turn' }],
  llm,
  tools: baseTools,
  enableThinking: false,
  maxTokens: 32000,
  taskName: 'test-task',
  jobType: 'code' as const,
  onMaxTokensTruncation,
});

describe('runPlanWithTools — onMaxTokensTruncation hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fires onMaxTokensTruncation when done event carries stopReason=max_tokens', async () => {
    const llm = makeLLM([
      // No closing </plan>; no tool_use → result is null (the silent failure)
      { type: 'text', text: '<plan>{"task":{"id":"t","goal":"truncated mid-stream' },
      {
        type: 'done',
        done: true,
        usage: { inputTokens: 1000, outputTokens: 32000, totalTokens: 33000 },
        stopReason: 'max_tokens',
      },
    ]);
    const hook = vi.fn();
    await runPlanWithTools(baseArgs(llm, hook));
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledWith({ outputTokens: 32000, round: 0 });
  });

  it('does NOT fire onMaxTokensTruncation when done event reports end_turn', async () => {
    const llm = makeLLM([
      {
        type: 'text',
        text: '<plan>' + 'x'.repeat(100) + '</plan>',
      },
      {
        type: 'done',
        done: true,
        usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 },
        stopReason: 'end_turn',
      },
    ]);
    const hook = vi.fn();
    await runPlanWithTools(baseArgs(llm, hook));
    expect(hook).not.toHaveBeenCalled();
  });

  it('does NOT fire onMaxTokensTruncation when stopReason is omitted (defensive)', async () => {
    const llm = makeLLM([
      { type: 'text', text: '<plan>' + 'y'.repeat(100) + '</plan>' },
      {
        type: 'done',
        done: true,
        usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 },
        // no stopReason — older adapter / mock LLM
      },
    ]);
    const hook = vi.fn();
    await runPlanWithTools(baseArgs(llm, hook));
    expect(hook).not.toHaveBeenCalled();
  });

  it('round number reflects message-history halving (re-entry rounds)', async () => {
    const llm = makeLLM([
      { type: 'text', text: 'no closing tag' },
      {
        type: 'done',
        done: true,
        usage: { inputTokens: 100, outputTokens: 32000, totalTokens: 32100 },
        stopReason: 'max_tokens',
      },
    ]);
    const hook = vi.fn();
    await runPlanWithTools({
      ...baseArgs(llm, hook),
      // Simulate round 3 of a tool-loop: user + (assistant+tool_result) × 3 = 7 messages
      messages: Array.from({ length: 7 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: 'turn',
      })),
    });
    expect(hook).toHaveBeenCalledWith({ outputTokens: 32000, round: 3 });
  });
});
