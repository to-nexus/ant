/**
 * SubagentRunner — never-throw contract: happy path report, tool error as
 * result content, round exhaustion → [partial], truncation, empty → error.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setLLMClientFactory } from '../../src/periphery/adapters/llm/LLMClientFactory';
import { runExploreSubagent } from '../../src/agents/common/subagent/SubagentRunner';
import { ToolRegistry } from '../../src/agents/common/tool/registry';
import { ToolName } from '../../src/agents/common/tool/toolCatalog';
import type { SubagentSeamInternals } from '../../src/agents/common/subagent/types';

type StreamEvent = Record<string, any>;

/** Mock LLM: yields the scripted event batches round by round. */
function mockLLM(rounds: StreamEvent[][]): any {
  let call = 0;
  return {
    modelName: 'mock-child-model',
    provider: 'mock',
    async *stream() {
      const batch = rounds[Math.min(call, rounds.length - 1)];
      call++;
      for (const ev of batch) yield ev;
    },
  };
}

function internals(overrides: Partial<SubagentSeamInternals> = {}): SubagentSeamInternals {
  const registry = new ToolRegistry();
  registry.register(ToolName.READ_FILE, async (_ctx, args) => {
    if (args.path === 'throw.ts') throw new Error('handler exploded');
    return { content: `contents of ${args.path}` };
  });
  return {
    jobKind: 'code',
    llmJobType: 'code',
    baseCtx: { fileSystem: {} as any, chatStatus: {} as any, workingDir: '/tmp' } as any,
    registry,
    childTools: [{ name: 'read_file', description: 'read', input_schema: { type: 'object', properties: {} } }] as any,
    promptBuilder: { render: async () => 'child system prompt' },
    ...overrides,
  };
}

const text = (t: string): StreamEvent => ({ type: 'text', text: t });
const toolUse = (id: string, path: string): StreamEvent => ({
  type: 'tool_use',
  toolUse: { id, name: 'read_file', input: { path } },
});

beforeEach(() => {
  setLLMClientFactory(() => { throw new Error('unexpected factory call'); });
});

afterEach(() => {
  setLLMClientFactory(null);
  delete process.env.ANT_SUBAGENT_MAX_ROUNDS;
  delete process.env.ANT_SUBAGENT_MAX_REPORT_CHARS;
});

function withLLM(rounds: StreamEvent[][]): void {
  const llm = mockLLM(rounds);
  setLLMClientFactory(() => llm);
}

describe('runExploreSubagent', () => {
  it('happy path: explores then returns the final text as a done report', async () => {
    withLLM([
      [toolUse('t1', 'src/a.ts')],
      [text('Answer: found it at src/a.ts:12')],
    ]);
    const result = await runExploreSubagent({ id: 'sub1', goal: 'find it', internals: internals() });
    expect(result.state).toBe('done');
    expect(result.report).toBe('Answer: found it at src/a.ts:12');
    expect(result.modelId).toBe('mock-child-model');
    expect(result.rounds).toBeGreaterThanOrEqual(1);
  });

  it('tool handler throw becomes an error tool result, run still completes', async () => {
    withLLM([
      [toolUse('t1', 'throw.ts')],
      [text('Could not read throw.ts — reporting without it.')],
    ]);
    const result = await runExploreSubagent({ id: 'sub2', goal: 'g', internals: internals() });
    expect(result.state).toBe('done');
    expect(result.report).toContain('reporting without it');
  });

  it('round exhaustion produces a [partial] report', async () => {
    process.env.ANT_SUBAGENT_MAX_ROUNDS = '2';
    withLLM([
      [toolUse('t1', 'src/a.ts')],
      // Final round: tools stripped — model must answer with text.
      [text('partial findings so far')],
    ]);
    const result = await runExploreSubagent({ id: 'sub3', goal: 'g', internals: internals() });
    expect(result.state).toBe('partial');
    expect(result.report.startsWith('[partial] ')).toBe(true);
  });

  it('report is truncated at the configured ceiling', async () => {
    process.env.ANT_SUBAGENT_MAX_REPORT_CHARS = '20';
    withLLM([[text('x'.repeat(200))]]);
    const result = await runExploreSubagent({ id: 'sub4', goal: 'g', internals: internals() });
    expect(result.state).toBe('partial');
    expect(result.report).toContain('[... report truncated]');
  });

  it('empty final response is an error-shaped report (never-throw)', async () => {
    withLLM([[text('   ')]]);
    const result = await runExploreSubagent({ id: 'sub5', goal: 'g', internals: internals() });
    expect(result.state).toBe('error');
    expect(result.report).toContain('no report');
  });

  it('missing promptBuilder degrades to an error report, not a throw', async () => {
    withLLM([[text('unused')]]);
    const result = await runExploreSubagent({
      id: 'sub6', goal: 'g',
      internals: internals({ promptBuilder: undefined }),
    });
    expect(result.state).toBe('error');
    expect(result.report).toContain('prompt renderer unavailable');
  });
});
