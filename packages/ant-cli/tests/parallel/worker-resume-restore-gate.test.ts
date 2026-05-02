/**
 * Worker resume restore-gate truth table — `raw-clinging-beach` regression guard.
 *
 * Locks the contract that `TaskWorker.executeTask` restores
 * `planText` / `conversations` / `retries` / `violations` /
 * `enforcementHistory` from `task.resumeState` ONLY when BOTH:
 *
 *   - `task.interrupted === true`, AND
 *   - `task.resumeState != null`
 *
 * This AND-gate's two halves are independently necessary:
 *
 *   • The `interrupted` marker alone is not enough — an interrupted
 *     task with no snapshot has nothing to restore (the gate must
 *     short-circuit so the worker initializes `conversations: {}`).
 *
 *   • The snapshot alone is not enough — a freshly spawned task that
 *     happens to carry a snapshot but has `interrupted=false` MUST
 *     start with empty conversations. This is the half that matters
 *     for the `raw-clinging-beach` regression: a Path B Final
 *     Verification (`processDiagnosticBatchSplit` drop-and-replace)
 *     used to be spawned with `resumeState = snapshotFromState(state)`
 *     carrying the parent error task's `node:plan` conversation.
 *     A subsequent `saveCheckpoint` / `captureWorkerSnapshots` would
 *     flip `interrupted` to `true` on the queued FV, and the gate
 *     would then restore the parent's conversation into the FV —
 *     hijacking it away from `variants/verification/base.md` (and
 *     skipping the `priorErrorTasks` block). The fix is two-pronged:
 *       1. Path B no longer attaches `resumeState` to the spawned FV
 *          (`tasks/_shared/batchSplit/process.ts`, `resumeState: undefined`).
 *       2. This predicate makes the AND-gate explicit and exported so
 *          any future "carry conv into a fresh task" attempt collides
 *          with this test.
 */

import { describe, it, expect } from 'vitest';

import type { BaseTask } from '@ant/shared';
import { shouldRestoreFromResumeState } from '../../src/agents/architect/graph/code/parallel/TaskWorker';

function task(over: Partial<BaseTask> & Record<string, unknown> = {}): BaseTask {
  return {
    id: 't',
    name: 'task',
    type: 'verification',
    priority: 1000,
    ...over,
  } as BaseTask;
}

const SAMPLE_RESUME = {
  planText: 'parent plan text',
  conversations: { 'node:plan': { messages: [{ role: 'user', content: 'parent error prompt' }] } },
  retries: 2,
  violations: [],
  enforcementHistory: [],
};

describe('shouldRestoreFromResumeState — restore-gate truth table', () => {
  it('(interrupted=false, resumeState=undefined) → NO restore (fresh task, nothing to restore)', () => {
    expect(shouldRestoreFromResumeState(task({ interrupted: false }))).toBe(false);
  });

  it('(interrupted=undefined, resumeState=undefined) → NO restore (default fresh task)', () => {
    expect(shouldRestoreFromResumeState(task())).toBe(false);
  });

  it('(interrupted=true, resumeState=undefined) → NO restore (interrupted but nothing snapshotted)', () => {
    expect(shouldRestoreFromResumeState(task({ interrupted: true }))).toBe(false);
  });

  it('(interrupted=false, resumeState=present) → NO restore — raw-clinging-beach guard', () => {
    // This is the exact shape of the regression: a fresh Path B FV
    // carrying the parent's conversation snapshot. The gate MUST
    // refuse to restore it, even though the snapshot looks valid.
    expect(shouldRestoreFromResumeState(task({
      interrupted: false,
      resumeState: SAMPLE_RESUME,
    } as any))).toBe(false);
  });

  it('(interrupted=undefined, resumeState=present) → NO restore — same guard, undefined-shaped variant', () => {
    expect(shouldRestoreFromResumeState(task({
      resumeState: SAMPLE_RESUME,
    } as any))).toBe(false);
  });

  it('(interrupted=true, resumeState=present) → restore — Path A re-queue / Stop+Resume / transient retry', () => {
    expect(shouldRestoreFromResumeState(task({
      interrupted: true,
      resumeState: SAMPLE_RESUME,
    } as any))).toBe(true);
  });

  it('(interrupted=true, resumeState=null) → NO restore — null is treated as absent', () => {
    expect(shouldRestoreFromResumeState(task({
      interrupted: true,
      resumeState: null,
    } as any))).toBe(false);
  });

  it('AND semantics — flipping either half independently changes the outcome', () => {
    // Holding resumeState present, interrupted toggles outcome
    expect(shouldRestoreFromResumeState(task({ interrupted: false, resumeState: SAMPLE_RESUME } as any))).toBe(false);
    expect(shouldRestoreFromResumeState(task({ interrupted: true, resumeState: SAMPLE_RESUME } as any))).toBe(true);
    // Holding interrupted=true, resumeState toggles outcome
    expect(shouldRestoreFromResumeState(task({ interrupted: true } as any))).toBe(false);
    expect(shouldRestoreFromResumeState(task({ interrupted: true, resumeState: SAMPLE_RESUME } as any))).toBe(true);
  });
});
