/**
 * Ordering invariant — the job final summary (`emitJobFinalSummary`) runs at
 * the terminal learn seam AFTER the durable completion checkpoint and the
 * user-facing terminal signals, and BEFORE `distillAssistantTurn` (which
 * stays last per learn-distill-ordering.test.ts and harvests the summary as
 * the turn's final prose).
 *
 * Source-order guard, same rationale as learn-distill-ordering: the learn
 * nodes have too many deps for a behavioral unit test, so the seam position
 * is locked statically. A mid-call SIGTERM during the summary must lose only
 * the summary — never the completion checkpoint.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = resolve(__dirname, '../../src/agents/architect/graph');

function read(rel: string): string {
  return readFileSync(resolve(SRC, rel), 'utf-8');
}

const at = (src: string, marker: string) => src.indexOf(marker);

describe('learn node job-summary ordering — after terminal signals, before distill', () => {
  it('code learn: emitJobFinalSummary is after the learned signal / logger flush and before distill', () => {
    const src = read('code/nodes/learn/index.ts');

    const summary = at(src, 'emitJobFinalSummary({');
    const learned = at(src, "showChatStatus('learned'");
    const terminalLogger = at(src, "clearPromptLogger('code'");
    const distill = at(src, 'distillAssistantTurn({');

    expect(summary).toBeGreaterThan(-1);
    expect(summary).toBeGreaterThan(learned);
    expect(summary).toBeGreaterThan(terminalLogger);
    expect(summary).toBeLessThan(distill);

    // Exactly one summary call.
    expect(src.split('emitJobFinalSummary({').length - 1).toBe(1);

    // Failure/pause paths are gated off.
    const gate = src.slice(Math.max(0, summary - 600), summary);
    expect(gate).toContain('isLastTask');
    expect(gate).toContain('!isWorkerContext');
    expect(gate).toContain('!hasOrchestratorFailure');
    expect(gate).toContain('!taskFailed');
    expect(gate).toContain('!state.interruption');
  });

  it('design learn: emitJobFinalSummary is after endJob / spec_complete card and before distill', () => {
    const src = read('design/nodes/learn/index.ts');

    const summary = at(src, 'emitJobFinalSummary({');
    const endJob = at(src, 'workflowUpdate.endJob(');
    const specCard = at(src, "'spec_complete'");
    const distill = at(src, 'distillAssistantTurn({');

    expect(summary).toBeGreaterThan(-1);
    expect(summary).toBeGreaterThan(endJob);
    expect(summary).toBeGreaterThan(specCard);
    expect(summary).toBeLessThan(distill);

    expect(src.split('emitJobFinalSummary({').length - 1).toBe(1);

    const gate = src.slice(Math.max(0, summary - 600), summary);
    expect(gate).toContain('isLastTask');
    expect(gate).toContain('!_isWorkerContext');
    expect(gate).toContain('!hasEarlyTermination');
  });
});
