/**
 * Ordering invariant — the best-effort `distillAssistantTurn` LLM call MUST be
 * the last significant statement in each terminal `learn` node, after the
 * durable completion checkpoint AND every user-facing terminal signal
 * (idempotent-kazoo / rich-icing-mirth RCA).
 *
 * Why a source-order guard: `distillAssistantTurn` is an up-to-8s blocking LLM
 * `invoke` (best-effort, swallow-errors). Context Lens P2 originally inserted it
 * BEFORE the completion writes / terminal UX, so a mid-call SIGTERM (e.g. a
 * rolling deploy) left the job's graph internally complete but with its
 * completion + "Start Development" card un-emitted → recovery paused it into an
 * un-resumable limbo. The learn nodes have too many deps for a full behavioral
 * unit test (the repo extracts pure helpers instead — see learn-bc-gate.test),
 * so this locks the ordering statically: any future edit that moves distill back
 * ahead of the completion/terminal signals fails here.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = resolve(__dirname, '../../src/agents/architect/graph');

function read(rel: string): string {
  return readFileSync(resolve(SRC, rel), 'utf-8');
}

/** Index of the first occurrence of a marker; -1 if absent. */
const at = (src: string, marker: string) => src.indexOf(marker);

describe('learn node distill ordering — distill is last, after completion + terminal signals', () => {
  it('design learn: distillAssistantTurn runs after saveSessionRun, endJob, and the spec_complete card', () => {
    const src = read('design/nodes/learn/index.ts');

    const distill = at(src, 'distillAssistantTurn({');
    const saveRun = at(src, 'await saveSessionRun(state)');
    const endJob = at(src, 'workflowUpdate.endJob(');
    const specCard = at(src, "'spec_complete'");
    const ret = at(src, 'return {');

    // All markers present.
    expect(distill).toBeGreaterThan(-1);
    expect(saveRun).toBeGreaterThan(-1);
    expect(endJob).toBeGreaterThan(-1);
    expect(specCard).toBeGreaterThan(-1);

    // distill is after the completion write and every user-facing terminal signal.
    expect(distill).toBeGreaterThan(saveRun);
    expect(distill).toBeGreaterThan(endJob);
    expect(distill).toBeGreaterThan(specCard);

    // distill is the last thing before the terminal return.
    expect(distill).toBeLessThan(ret);

    // Exactly one distill call (the move must not have left a duplicate).
    expect(src.split('distillAssistantTurn({').length - 1).toBe(1);
  });

  it('code learn: distillAssistantTurn runs after the completion write and showChatStatus("learned")', () => {
    const src = read('code/nodes/learn/index.ts');

    const distill = at(src, 'distillAssistantTurn({');
    const learned = at(src, "showChatStatus('learned'");
    const terminalLogger = at(src, "clearPromptLogger('code'");
    const ret = at(src, 'return { ...state, branch');

    expect(distill).toBeGreaterThan(-1);
    expect(learned).toBeGreaterThan(-1);
    expect(terminalLogger).toBeGreaterThan(-1);

    // distill is after the "learned" chat signal and the terminal logger-flush block.
    expect(distill).toBeGreaterThan(learned);
    expect(distill).toBeGreaterThan(terminalLogger);

    // distill is the last thing before the terminal return.
    expect(distill).toBeLessThan(ret);

    // Exactly one distill call.
    expect(src.split('distillAssistantTurn({').length - 1).toBe(1);
  });
});
