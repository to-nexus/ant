/**
 * SubagentRunner — never-throw contract: happy path report, tool error as
 * result content, round exhaustion → [partial], over-budget compaction
 * (lead + outline + drill-down, state stays done), empty → error.
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

  it('over-budget report is compacted (lead + outline + drill-down notice), stays done, keeps full text', async () => {
    process.env.ANT_SUBAGENT_MAX_REPORT_CHARS = '400';
    const full =
      `## Answer\n${'a'.repeat(300)}\n## Details\n${'b'.repeat(300)}\n## Open questions\n${'c'.repeat(300)}`;
    withLLM([[text(full)]]);
    const result = await runExploreSubagent({ id: 'sub4', goal: 'g', internals: internals() });
    // Compaction is recoverable delivery compression, NOT an incomplete run.
    expect(result.state).toBe('done');
    expect(result.report.startsWith('[partial]')).toBe(false);
    expect(result.reportFull).toBe(full);
    // Inline form: lead answer + structural outline + notice naming the tool.
    expect(result.report).toContain('## Answer');
    expect(result.report).toContain('Document outline');
    expect(result.report).toContain('## Open questions');
    expect(result.report).toContain('subagent_report');
    expect(result.report).toContain('not inlined');
    // Ack↔marker pairing invariant: the notice must never contain the marker literal.
    expect(result.report).not.toMatch(/\[SUBAGENT REPORT/);
    // Drill-down store holds the complete text.
    const { readFullReport, clearAllReports } = await import('../../src/agents/common/subagent/reportStore');
    const slice = readFullReport('sub4', 0, 10_000);
    expect(slice?.total).toBe(full.length);
    expect(slice?.slice).toBe(full);
    clearAllReports();
  });

  it('unstructured over-budget report falls back to head+tail without overlap', async () => {
    process.env.ANT_SUBAGENT_MAX_REPORT_CHARS = '400';
    const full = 'x'.repeat(150) + '\n' + 'y'.repeat(150) + '\n' + 'z'.repeat(300);
    withLLM([[text(full)]]);
    const result = await runExploreSubagent({ id: 'sub4b', goal: 'g', internals: internals() });
    expect(result.state).toBe('done');
    expect(result.report).toContain('not inlined');
    expect(result.report.length).toBeLessThan(full.length);
    const { clearAllReports } = await import('../../src/agents/common/subagent/reportStore');
    clearAllReports();
  });

  it('empty final response is an error-shaped report (never-throw)', async () => {
    withLLM([[text('   ')]]);
    const result = await runExploreSubagent({ id: 'sub5', goal: 'g', internals: internals() });
    expect(result.state).toBe('error');
    expect(result.report).toContain('no report');
  });

  it('strips leaked textual tool-call markup from the report; raw kept on reportFull', async () => {
    // GLM shape (slow-fleeing-camel RCA): tool-call syntax streamed as text.
    withLLM([
      [
        text(
          'Answer: found at a.ts:3.\n<tool_call>read_file<arg_key>path</arg_key><arg_value>b.ts</arg_value>',
        ),
      ],
    ]);
    const result = await runExploreSubagent({ id: 'sub-markup', goal: 'g', internals: internals() });
    expect(result.state).toBe('done');
    expect(result.report).toBe('Answer: found at a.ts:3.');
    expect(result.reportFull).toContain('<tool_call>');
  });

  it('a response that is ONLY leaked tool-call markup degrades to the error shape', async () => {
    withLLM([[text('<tool_call>read_file<arg_key>path</arg_key><arg_value>b.ts</arg_value>')]]);
    const result = await runExploreSubagent({ id: 'sub-markup2', goal: 'g', internals: internals() });
    expect(result.state).toBe('error');
    expect(result.report).toContain('only leaked tool-call syntax');
  });

  it("unknown tool call is answered with the child's actual tool inventory", async () => {
    // A parent-authored goal can prescribe tools from the PARENT's wider set
    // (slow-fleeing-camel: "use search_ant_code" against a child without it).
    let secondCallMessages: any[] | null = null;
    let call = 0;
    const batches: StreamEvent[][] = [
      [{ type: 'tool_use', toolUse: { id: 'u1', name: 'search_ant_code', input: { query: 'x' } } }],
      [text('Answer: adapted using my own tools.')],
    ];
    setLLMClientFactory(() => ({
      modelName: 'mock-child-model',
      async *stream(messages: any[]) {
        call++;
        if (call === 2) secondCallMessages = messages;
        for (const ev of batches[Math.min(call - 1, batches.length - 1)]) yield ev;
      },
    }) as any);

    const result = await runExploreSubagent({ id: 'sub-unknown', goal: 'g', internals: internals() });
    expect(result.state).toBe('done');
    const history = JSON.stringify(secondCallMessages);
    expect(history).toContain("unknown tool 'search_ant_code'");
    expect(history).toContain('Your available tools: read_file');
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
