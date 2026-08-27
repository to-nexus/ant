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
