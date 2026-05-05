/**
 * Three-Axis SSOT regression guards for `batchSplit/process.ts`.
 *
 * Locks the priority + band semantics that close the
 * `log-satin-feeling-orbit` deadlock:
 *
 *   - Path A (verification parent / requeue-parent)
 *       sub-task priority = parent priority − 1 (sub lands ahead of the
 *       still-queued parent).
 *
 *   - Path B (error / test-code / feature / ui — drop-and-replace)
 *       sub-task priority = parent priority. The parent is gone from
 *       the queue; preserving priority keeps band classification stable
 *       (a foundation parent at priority 200 spawns sub-tasks at
 *       priority 200, NOT 199).
 *
 *   - Band carry-over (feature parent only)
 *       Sub-tasks inherit `parent.band` verbatim. Foundation parent →
 *       foundation children; integration parent → integration children;
 *       undefined → undefined. This is what makes scheduling
 *       deadlock-immune across the priority decrement.
 *
 *   - Non-feature parents do not carry band (their type alone is the
 *       discriminator — band is type-bound to FeatureCodeTask).
 */

import { describe, it, expect } from 'vitest';
import { processDiagnosticBatchSplit } from '../../../src/agents/architect/graph/code/tasks/_shared/batchSplit';
import { TaskQueue } from '../../../src/agents/architect/types/task';
import type { CodeTask } from '../../../src/agents/architect/types/task';

function makeState(): any {
  return {
    taskQueue: new TaskQueue<CodeTask>(),
    _batchSplitRequeued: false,
    context: { featurePath: undefined },
    _httpJobId: undefined,
  };
}

describe('batchSplit — Three-Axis SSOT priority + band semantics', () => {
  it('Path A (verification parent): sub priority equals parent priority − 1', () => {
    const state = makeState();
    const parent: CodeTask = {
      id: 'final-v',
      name: 'Final Verification',
      type: 'verification',
      priority: 1000,
      description: '',
    } as CodeTask;
    const plan = JSON.stringify({
      diagnostics: { totalErrors: 2 },
      implementation: { modify: [] },
      batches: [
        { name: 'fix a', rationale: 'compile error in a', modify: ['a.ts'] },
        { name: 'fix b', rationale: 'compile error in b', modify: ['b.ts'] },
      ],
    });

    processDiagnosticBatchSplit(state, plan, parent);

    const all = state.taskQueue.getAll();
    const errors = all.filter((t: any) => t.type === 'error');
    expect(errors.length).toBe(2);
    for (const e of errors) {
      expect(e.priority).toBe(parent.priority - 1);
    }
    // Verification parent is re-queued (Path A) with its original priority.
    const verification = all.find((t: any) => t.type === 'verification') as any;
    expect(verification?.priority).toBe(parent.priority);
  });

  it('Path B (error parent): sub priority equals parent priority', () => {
    const state = makeState();
    const parent: CodeTask = {
      id: 'err-1',
      name: 'fix compile errors',
      type: 'error',
      priority: 905,
      description: '',
    } as CodeTask;
    const plan = JSON.stringify({
      diagnostics: { totalErrors: 2 },
      implementation: { modify: [] },
      batches: [
        { name: 'fix a', rationale: 'compile error in a', modify: ['a.ts'] },
        { name: 'fix b', rationale: 'compile error in b', modify: ['b.ts'] },
      ],
    });

    processDiagnosticBatchSplit(state, plan, parent);

    const all = state.taskQueue.getAll();
    const errors = all.filter((t: any) => t.type === 'error');
    expect(errors.length).toBe(2);
    for (const e of errors) {
      expect(e.priority).toBe(parent.priority);
    }
  });

  it('Path B (foundation feature parent): sub priority equals parent priority + band carries over', () => {
    // The deadlock signature: foundation parent at priority 200 used to
    // produce priority-199 sub-tasks classified as ordinary feature
    // work — orchestrator's foundation gate then rejected them while
    // hasPreFeatureWork stayed true.
    const state = makeState();
    const parent: CodeTask = {
      id: 'feat-foundation',
      name: 'shared foundation',
      type: 'feature',
      priority: 200,
      band: 'foundation',
      description: '',
    } as CodeTask;
    const plan = JSON.stringify({
      task: { id: 'parent', goal: 'split foundation work' },
      parentReasoning: 'shared types span N modules.',
      batches: [
        { name: 'a', rationale: 'unit a', modify: [{ target: 'a.ts' }], create: [], delete: [] },
        { name: 'b', rationale: 'unit b', modify: [{ target: 'b.ts' }], create: [], delete: [] },
      ],
    });

    processDiagnosticBatchSplit(state, plan, parent);

    const subs = state.taskQueue.getAll().filter((t: any) => t.type === 'feature');
    expect(subs.length).toBe(2);
    for (const s of subs) {
      expect(s.priority).toBe(parent.priority);
      expect((s as any).band).toBe('foundation');
    }
  });

  it('Path B (integration feature parent): band="integration" carries to children', () => {
    const state = makeState();
    const parent: CodeTask = {
      id: 'feat-integration',
      name: 'wire integration',
      type: 'feature',
      priority: 600,
      band: 'integration',
      description: '',
    } as CodeTask;
    const plan = JSON.stringify({
      batches: [
        { name: 'a', rationale: 'wire a', modify: [{ target: 'a.ts' }], create: [], delete: [] },
        { name: 'b', rationale: 'wire b', modify: [{ target: 'b.ts' }], create: [], delete: [] },
      ],
    });

    processDiagnosticBatchSplit(state, plan, parent);

    const subs = state.taskQueue.getAll().filter((t: any) => t.type === 'feature');
    expect(subs.length).toBe(2);
    for (const s of subs) {
      expect(s.priority).toBe(parent.priority);
      expect((s as any).band).toBe('integration');
    }
  });

  it('Path B (ordinary feature parent): band undefined carries to children', () => {
    const state = makeState();
    const parent: CodeTask = {
      id: 'feat-normal',
      name: 'normal feature',
      type: 'feature',
      priority: 400,
      description: '',
    } as CodeTask;
    const plan = JSON.stringify({
      batches: [
        { name: 'a', rationale: 'unit a', modify: [{ target: 'a.ts' }], create: [], delete: [] },
        { name: 'b', rationale: 'unit b', modify: [{ target: 'b.ts' }], create: [], delete: [] },
      ],
    });

    processDiagnosticBatchSplit(state, plan, parent);

    const subs = state.taskQueue.getAll().filter((t: any) => t.type === 'feature');
    expect(subs.length).toBe(2);
    for (const s of subs) {
      expect((s as any).band).toBeUndefined();
    }
  });

  it('non-feature sub-tasks (error parent → error children) MUST NOT carry band', () => {
    // Three-Axis SSOT: band is type-bound to FeatureCodeTask. Non-
    // feature sub-tasks must not surface a `band` field, even if the
    // discriminated-union compile guard were bypassed at runtime.
    const state = makeState();
    const parent: CodeTask = {
      id: 'err-1',
      name: 'fix errors',
      type: 'error',
      priority: 905,
      description: '',
    } as CodeTask;
    const plan = JSON.stringify({
      batches: [
        { name: 'fix a', rationale: 'error in a', modify: [{ target: 'a.ts' }] },
      ],
    });

    processDiagnosticBatchSplit(state, plan, parent);

    const subs = state.taskQueue.getAll().filter((t: any) => t.type === 'error');
    expect(subs.length).toBe(1);
    expect(Object.prototype.hasOwnProperty.call(subs[0] as object, 'band')).toBe(false);
  });
});
