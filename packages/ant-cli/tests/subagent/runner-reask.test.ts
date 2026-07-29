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
