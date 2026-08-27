/**
 * SubagentRunner — corrective re-ask after a degenerate round
 * (sage-causing-rover RCA).
 *
 * A degenerate round used to discard the WHOLE exploration (11 rounds of real
 * evidence) behind a failure notice. Now the runner issues ONE corrective
 * re-ask on the accumulated history (minus the degenerate turn), inside the
 * same wall-clock deadline; only a second degeneration falls back to the
 * failure notice.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setLLMClientFactory } from '../../src/periphery/adapters/llm/LLMClientFactory';
import { runExploreSubagent } from '../../src/agents/common/subagent/SubagentRunner';
import { ToolRegistry } from '../../src/agents/common/tool/registry';
import { ToolName } from '../../src/agents/common/tool/toolCatalog';
import type { SubagentSeamInternals } from '../../src/agents/common/subagent/types';

type StreamEvent = Record<string, any>;

const text = (t: string): StreamEvent => ({ type: 'text', text: t });
const LOOP = 'Let me read the update method that animates the ringFragments. ';
const degenerateBatch = (): StreamEvent[] => Array.from({ length: 60 }, () => text(LOOP));

function internals(): SubagentSeamInternals {
  const registry = new ToolRegistry();
  registry.register(ToolName.READ_FILE, async (_ctx, args) => ({ content: `contents of ${args.path}` }));
  return {
    jobKind: 'code',
    llmJobType: 'code',
    baseCtx: { fileSystem: {} as any, chatStatus: {} as any, workingDir: '/tmp' } as any,
    registry,
    childTools: [{ name: 'read_file', description: 'read', input_schema: { type: 'object', properties: {} } }] as any,
    promptBuilder: { render: async () => 'child system prompt' },
  };
}

beforeEach(() => {
  setLLMClientFactory(() => { throw new Error('unexpected factory call'); });
});

afterEach(async () => {
  setLLMClientFactory(null);
  const { clearAllReports } = await import('../../src/agents/common/subagent/reportStore');
  clearAllReports();
});

describe('runExploreSubagent — corrective re-ask', () => {
  it('recovers a clean report from the re-ask after a degenerate first attempt', async () => {
    const clean =
      'Direct answer: the gate system lives in zone-gate-renderer.ts. ' +
      'Evidence: create() at L355 injects the Third instance; update() at L376 diffs snapshots. ' +
      'Absence finding: no per-enemy freeze status exists in the domain model.';
    let call = 0;
    const batches: StreamEvent[][] = [degenerateBatch(), [text(clean), { type: 'done', stopReason: 'end_turn' }]];
    setLLMClientFactory(() => ({
      modelName: 'mock-child',
      async *stream(messages: any[]) {
        const batch = batches[Math.min(call, batches.length - 1)];
        call++;
        // The re-ask must carry the corrective note as its final user turn.
        if (call === 2) {
          const last = messages[messages.length - 1];
          expect(String(last.content)).toContain('degenerated into repeating');
        }
        for (const ev of batch) yield ev;
      },
    }) as any);

    const result = await runExploreSubagent({ id: 'reask1', goal: 'g', internals: internals() });

    expect(call).toBe(2);
    // The re-ask is a single forced-final round → `exhausted` → 'partial':
    // honest semantics (the original exploration WAS severed mid-way, so the
    // drain's "non-exhaustive, absence is not evidence" note applies).
    expect(result.state).toBe('partial');
    expect(result.report).toContain('Direct answer');
    expect(result.report).not.toContain('degenerate repetitive output');
  });

  it('recovers via re-ask when the report round is starved by the output-token cap', async () => {
    // local-nursing-churn RCA: adaptive thinking consumed the whole output
    // budget before any report text — zero text, stopReason max_tokens.
    const clean =
      'Direct answer: all 23 work docs read; triggers and rules tabulated below. ' +
      'Evidence: work-weekly-mail.md, work-expense-processing.md (5 sub-triggers).';
    let call = 0;
    const starvedBatch: StreamEvent[] = [
      { thinking: 'drafting the whole report in reasoning' },
      { type: 'done', stopReason: 'max_tokens' },
    ];
    const batches: StreamEvent[][] = [starvedBatch, [text(clean), { type: 'done', stopReason: 'end_turn' }]];
    setLLMClientFactory(() => ({
      modelName: 'mock-child',
      async *stream(messages: any[]) {
        const batch = batches[Math.min(call, batches.length - 1)];
        call++;
        // The re-ask must name the truncation cause in its final user turn.
        if (call === 2) {
          const last = messages[messages.length - 1];
          expect(String(last.content)).toContain('cut off by the output token cap');
        }
        for (const ev of batch) yield ev;
      },
    }) as any);

    const result = await runExploreSubagent({ id: 'reask3', goal: 'g', internals: internals() });

    expect(call).toBe(2);
    // Same honest semantics as the degenerate re-ask: single forced-final
    // round → exhausted → 'partial'.
    expect(result.state).toBe('partial');
    expect(result.report).toContain('Direct answer');
    expect(result.report).not.toContain('produced no report');
  });

  it('reports the token-cap cause when the starved re-ask ALSO returns no text (exactly one re-ask)', async () => {
    let call = 0;
    setLLMClientFactory(() => ({
      modelName: 'mock-child',
      async *stream() {
        call++;
        yield { thinking: 'still deliberating' };
        yield { type: 'done', stopReason: 'max_tokens' };
      },
    }) as any);

    const result = await runExploreSubagent({ id: 'reask4', goal: 'g', internals: internals() });

    expect(call).toBe(2); // main loop + ONE re-ask, never more
    expect(result.state).toBe('error');
    expect(result.report).toContain('truncated at the output-token cap');
  });

  it('falls back to the failure notice when the re-ask ALSO degenerates (exactly one re-ask)', async () => {
    let call = 0;
    setLLMClientFactory(() => ({
      modelName: 'mock-child',
      async *stream() {
        call++;
        for (const ev of degenerateBatch()) yield ev;
      },
    }) as any);

    const result = await runExploreSubagent({ id: 'reask2', goal: 'g', internals: internals() });

    expect(call).toBe(2); // main loop + ONE re-ask, never more
    expect(result.state).toBe('error');
    expect(result.report).toContain('degenerate repetitive output');
    expect(result.report).toContain('severed by the repetition breaker');
  });
});

describe('runExploreSubagent — exhausted-unfinished re-ask (slow-fleeing-camel RCA)', () => {
  afterEach(() => {
    delete process.env.ANT_SUBAGENT_MAX_ROUNDS;
  });

  const toolUse = (id: string): StreamEvent => ({
    type: 'tool_use',
    toolUse: { id, name: 'read_file', input: { path: 'src/a.ts' } },
  });
  const done = (): StreamEvent => ({ type: 'done', stopReason: 'end_turn' });
  const clean =
    'Direct answer: llmInfo is dropped at respond.ts:107. ' +
    'Evidence: agent.ts:227 passes extractLLMInfo(llm); respond.ts passes undefined. ' +
    'Absence finding: no caller of startJob exists.';

  function scripted(batches: StreamEvent[][], onCall?: (call: number, messages: any[]) => void): { calls: () => number } {
    let call = 0;
    setLLMClientFactory(() => ({
      modelName: 'mock-child',
      async *stream(messages: any[]) {
        call++;
        onCall?.(call, messages);
        for (const ev of batches[Math.min(call - 1, batches.length - 1)]) yield ev;
      },
    }) as any);
    return { calls: () => call };
  }

  it('re-asks once when the cap-forced final response leaked textual tool-call markup', async () => {
    process.env.ANT_SUBAGENT_MAX_ROUNDS = '2';
    const counter = scripted(
      [
        [toolUse('t1')],
        [
          text(
            'This is the key. Let me read the callers.<tool_call>read_file<arg_key>path</arg_key><arg_value>b.ts</arg_value>',
          ),
          done(),
        ],
        [text(clean), done()],
      ],
      (call, messages) => {
        if (call === 3) {
          const last = messages[messages.length - 1];
          expect(String(last.content)).toContain('ran out of tool rounds');
        }
      },
    );

    const result = await runExploreSubagent({ id: 'reask5', goal: 'g', internals: internals() });

    expect(counter.calls()).toBe(3); // 2 loop rounds + ONE re-ask
    expect(result.state).toBe('partial'); // exploration WAS cut short — honest label
    expect(result.report).toContain('Direct answer');
    expect(result.report).not.toContain('<tool_call>');
  });

  it('re-asks once when the cap-forced final response is short mid-exploration narration', async () => {
    process.env.ANT_SUBAGENT_MAX_ROUNDS = '2';
    const counter = scripted([
      [toolUse('t1')],
      [text('Now let me read the LLMClientFactory to understand model selection.'), done()],
      [text(clean), done()],
    ]);

    const result = await runExploreSubagent({ id: 'reask6', goal: 'g', internals: internals() });

    expect(counter.calls()).toBe(3);
    expect(result.state).toBe('partial');
    expect(result.report).toContain('Direct answer');
    expect(result.report).not.toContain('Now let me read');
  });

  it('does NOT re-ask when the cap-forced final response is already a substantive report', async () => {
    process.env.ANT_SUBAGENT_MAX_ROUNDS = '2';
    const longReport =
      'Direct answer: the model flows through three layers. ' +
      Array.from({ length: 60 }, (_, i) => `Evidence ${i}: module-${i}.ts:${i + 10} carries field f${i}.`).join(' ');
    expect(longReport.length).toBeGreaterThan(2000);
    const counter = scripted([[toolUse('t1')], [text(longReport), done()]]);

    const result = await runExploreSubagent({ id: 'reask7', goal: 'g', internals: internals() });

    expect(counter.calls()).toBe(2); // no re-ask
    expect(result.state).toBe('partial');
    expect(result.report).toContain('[partial]');
    expect(result.report).toContain('Direct answer');
  });
});
