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
    // Enriched with round-shape so the caller can distinguish a degenerate
    // no-output monologue from an escalated large-plan emission
    // (gentle-leaping-lathe). Here a `<plan>` was open at truncation.
    expect(hook).toHaveBeenCalledWith({
      outputTokens: 32000,
      round: 0,
      toolCallCount: 0,
      hasOpenPlan: true,
    });
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
    // Degenerate shape: no `<plan>` opened and no tool calls — the caller
    // labels this a no-output monologue truncation.
    expect(hook).toHaveBeenCalledWith({
      outputTokens: 32000,
      round: 3,
      toolCallCount: 0,
      hasOpenPlan: false,
    });
  });
});

describe('runPlanWithTools — bounded escalation (gentle-leaping-lathe)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeLLMSeq(sequences: LLMStreamEvent[][]): LLMClient {
    let call = 0;
    return {
      stream: vi.fn(() => {
        const events = sequences[Math.min(call, sequences.length - 1)];
        call++;
        return mockStream(events);
      }),
    } as unknown as LLMClient;
  }

  it('escalates ONE round to escalatedMaxTokens when a <plan> is truncated mid-emit, then completes', async () => {
    const llm = makeLLMSeq([
      // base round: <plan> opened but cut off at max_tokens
      [
        { type: 'text', text: '<plan>{"task":{"id":"t","goal":"big plan mid' } as LLMStreamEvent,
        { type: 'done', done: true, usage: { inputTokens: 100, outputTokens: 16000, totalTokens: 16100 }, stopReason: 'max_tokens' } as LLMStreamEvent,
      ],
      // escalated round: full plan closes cleanly
      [
        { type: 'text', text: '<plan>' + 'z'.repeat(120) + '</plan>' } as LLMStreamEvent,
        { type: 'done', done: true, usage: { inputTokens: 100, outputTokens: 400, totalTokens: 500 }, stopReason: 'end_turn' } as LLMStreamEvent,
      ],
    ]);
    const hook = vi.fn();
    const result = await runPlanWithTools({
      ...baseArgs(llm, hook),
      maxTokens: 16000,
      escalatedMaxTokens: 64000,
    } as any);
    // Two LLM calls: base (truncated) + one escalated retry.
    expect((llm.stream as any)).toHaveBeenCalledTimes(2);
    // Second call used the larger ceiling.
    expect((llm.stream as any).mock.calls[1][1].maxTokens).toBe(64000);
    // Escalated round completed cleanly → planText, no truncation hook.
    expect(hook).not.toHaveBeenCalled();
    expect(result?.kind).toBe('planText');
  });

  it('does NOT escalate a degenerate no-<plan> monologue truncation', async () => {
    const llm = makeLLMSeq([
      [
        { type: 'text', text: 'thinking out loud, no plan tag ever opens...' } as LLMStreamEvent,
        { type: 'done', done: true, usage: { inputTokens: 100, outputTokens: 16000, totalTokens: 16100 }, stopReason: 'max_tokens' } as LLMStreamEvent,
      ],
    ]);
    const hook = vi.fn();
    const result = await runPlanWithTools({
      ...baseArgs(llm, hook),
      maxTokens: 16000,
      escalatedMaxTokens: 64000,
    } as any);
    // Single call — no open <plan>, so the base cap terminates the round.
    expect((llm.stream as any)).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledWith({ outputTokens: 16000, round: 0, toolCallCount: 0, hasOpenPlan: false });
    expect(result).toBeNull();
  });

  it('does NOT escalate when escalatedMaxTokens is omitted (design-job parity)', async () => {
    const llm = makeLLMSeq([
      [
        { type: 'text', text: '<plan>{"task":"open but truncated' } as LLMStreamEvent,
        { type: 'done', done: true, usage: { inputTokens: 100, outputTokens: 32000, totalTokens: 32100 }, stopReason: 'max_tokens' } as LLMStreamEvent,
      ],
    ]);
    const hook = vi.fn();
    await runPlanWithTools({ ...baseArgs(llm, hook), maxTokens: 32000 } as any);
    expect((llm.stream as any)).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledWith({ outputTokens: 32000, round: 0, toolCallCount: 0, hasOpenPlan: true });
  });
});
