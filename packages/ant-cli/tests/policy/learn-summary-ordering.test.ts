/**
 * Ordering invariant — the job final summary (`emitJobFinalSummary`) runs at
 * the terminal learn seam AFTER the durable completion checkpoint and the
 * workflow-lifecycle signals, and BEFORE `distillAssistantTurn` (which stays
 * last per learn-distill-ordering.test.ts and harvests the summary as the
 * turn's final prose).
 *
 * The design job's `spec_complete` CTA sits BETWEEN the two: "Start
 * Development with this spec" is the next action, so it must follow the job's
 * own wrap-up prose. Emitting it first (the original order) made the CTA read
 * as the conclusion and pushed the actual conclusion out of view
 * (zero-hunting-label).
 *
 * Source-order guard, same rationale as learn-distill-ordering: the learn
 * nodes have too many deps for a behavioral unit test, so the seam position
 * is locked statically. A mid-call SIGTERM during the summary must lose only
 * the summary and the CTA — never the completion checkpoint.
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

  it('design learn: emitJobFinalSummary is after endJob / exitNode, before the CTA card and distill', () => {
    const src = read('design/nodes/learn/index.ts');

    const summary = at(src, 'emitJobFinalSummary({');
    const endJob = at(src, 'workflowUpdate.endJob(');
    const exitNode = at(src, 'workflowUpdate.exitNode(');
    const specCard = at(src, 'await emitSpecCompleteCard(');
    const distill = at(src, 'distillAssistantTurn({');

    expect(summary).toBeGreaterThan(-1);
    expect(specCard).toBeGreaterThan(-1);
    expect(summary).toBeGreaterThan(endJob);
    expect(summary).toBeGreaterThan(exitNode);
    // The CTA is the turn's LAST user-facing signal — it follows the wrap-up
    // prose it refers to (zero-hunting-label), and distill still runs last.
    expect(specCard).toBeGreaterThan(summary);
    expect(specCard).toBeLessThan(distill);

    expect(src.split('emitJobFinalSummary({').length - 1).toBe(1);
    expect(src.split('await emitSpecCompleteCard(').length - 1).toBe(1);

    const gate = src.slice(Math.max(0, summary - 600), summary);
    expect(gate).toContain('isLastTask');
    expect(gate).toContain('!_isWorkerContext');
    expect(gate).toContain('!hasEarlyTermination');

    // The CTA keeps its own early-termination / worker gate.
    const cardGate = src.slice(Math.max(0, specCard - 300), specCard);
    expect(cardGate).toContain('!_isWorkerContext');
    expect(cardGate).toContain('!hasEarlyTermination');
  });

  it('universal respond: plan-complete CTA is after the artifact manifest, before the session seal', () => {
    // Same seam rationale as the design CTA: the card is the turn's last
    // chat signal (follows the manifest it refers to), and it precedes the
    // seal so a seal failure can't swallow it. `endJob` stays terminal.
    const src = readFileSync(
      resolve(__dirname, '../../src/agents/universal/graph/nodes/respond.ts'),
      'utf-8',
    );

    const manifest = at(src, 'Artifacts written this turn');
    const planCard = at(src, 'await emitPlanCompleteCard(');
    const seal = at(src, 'Session seal');
    const endJob = at(src, 'workflowUpdate.endJob(');

    expect(manifest).toBeGreaterThan(-1);
    expect(planCard).toBeGreaterThan(manifest);
    expect(planCard).toBeLessThan(seal);
    expect(endJob).toBeGreaterThan(seal);

    // Exactly one emission, gated on the pure deterministic predicate.
    expect(src.split('await emitPlanCompleteCard(').length - 1).toBe(1);
    const cardGate = src.slice(Math.max(0, planCard - 300), planCard);
    expect(cardGate).toContain('planCompleteCardWrites(state)');
  });
});
