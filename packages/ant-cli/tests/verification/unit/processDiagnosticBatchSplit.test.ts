/**
 * L1 unit — verification batch-split + sibling diagnostic helpers SSOT.
 *
 *   1. processDiagnosticBatchSplit (plan node) — always-fan-out semantics:
 *        - top-level implementation entries → per-target batches
 *        - existing batches (any count) → fan-out as-is
 *        - 0 entries / non-verification task / short planText / bad JSON → noop
 *        - hard limit: MAX_BATCH_SPLIT_CYCLES → throw VerificationTerminalError
 *
 *   2. classifyTerminalError dispatcher — typed terminal errors are
 *      recognised by the orchestrator BEFORE the legacy regex-based
 *      `isDeterministicError` runs.
 *
 *   3. hasEmptyImplementation (Axis F-1) — detects empty modify/create/delete
 *      with no batches; treats markdown-fenced JSON, missing keys, and
 *      invalid JSON safely.
 */

import { describe, it, expect } from 'vitest';
import {
  processDiagnosticBatchSplit,
  MAX_BATCH_SPLIT_CYCLES,
} from '../../../src/agents/architect/graph/code/tasks/_shared/batchSplit';
import {
  VerificationTerminalError,
  classifyTerminalError,
} from '../../../src/agents/architect/graph/code/tasks/_shared/verify/terminal/errors';
import { hasEmptyImplementation } from '../../../src/agents/architect/graph/code/tasks/_shared/verify/emptyImpl';
import { TaskQueue } from '../../../src/agents/architect/types/task';
import type { CodeTask } from '../../../src/agents/architect/types/task';

interface StateOverrides {
  _batchSplitRequeued?: boolean;
}

function makeState(overrides: StateOverrides = {}): any {
  return {
    taskQueue: new TaskQueue<CodeTask>(),
    _batchSplitRequeued: overrides._batchSplitRequeued ?? false,
    context: { featurePath: undefined },
    _httpJobId: undefined,
  };
}

function makeTask(overrides: Partial<CodeTask> = {}): CodeTask {
  return {
    id: 'task-1',
    name: 'Final Verification',
    type: 'verification',
    priority: 1000,
    ...overrides,
  };
}

describe('processDiagnosticBatchSplit — always-fan-out', () => {
  describe('task type gating', () => {
    it('non-verification / non-error / non-test-code task → noop (returns original)', () => {
      const state = makeState();
      const task = makeTask({ type: 'feature', priority: 50, name: 'implement login form' });
      const planText = JSON.stringify({
        batches: [{ name: 'a', modify: ['f1.ts'] }, { name: 'b', modify: ['f2.ts'] }],
        implementation: { modify: ['f1.ts', 'f2.ts'] },
      });
      const out = processDiagnosticBatchSplit(state, planText, task);
      expect(out).toBe(planText);
      expect(state.taskQueue.size()).toBe(0);
      expect(state._batchSplitRequeued).toBe(false);
    });

    it('error task is a valid split target (decompose-emitted error without prePlanText)', () => {
      const state = makeState();
      const task = makeTask({ type: 'error', priority: 50, name: 'fix ts2307 import errors' });
      const planText = JSON.stringify({
        diagnostics: { totalErrors: 2 },
        implementation: { modify: [] },
        batches: [
          { name: 'fix a', modify: ['a.ts'] },
          { name: 'fix b', modify: ['b.ts'] },
        ],
      });
      const out = processDiagnosticBatchSplit(state, planText, task);
      expect(out).toBe('');
      expect(state._batchSplitRequeued).toBe(true);
    });
  });

  describe('guards', () => {
    it('short planText (<= 50 chars) → noop', () => {
      const state = makeState();
      const out = processDiagnosticBatchSplit(state, 'too short', makeTask());
      expect(out).toBe('too short');
    });

    it('unparseable JSON → returns original planText (no crash)', () => {
      const state = makeState();
      const plan = 'NOT_JSON_' + 'x'.repeat(60);
      const out = processDiagnosticBatchSplit(state, plan, makeTask());
      expect(out).toBe(plan);
    });

    it('plan with 0 implementation entries (no top-level, no batches) → noop', () => {
      const state = makeState();
      const plan = JSON.stringify({
        diagnostics: { totalErrors: 0 },
        implementation: { modify: [], create: [], delete: [] },
      });
      const out = processDiagnosticBatchSplit(state, plan, makeTask());
      expect(out).toBe(plan);
      expect(state._batchSplitRequeued).toBe(false);
    });

    it('strips markdown code fence before JSON parse', () => {
      const state = makeState();
      const inner = JSON.stringify({
        diagnostics: { totalErrors: 2 },
        implementation: { modify: [] },
        batches: [
          { name: 'fix a', modify: ['a.ts'] },
          { name: 'fix b', modify: ['b.ts'] },
        ],
      });
      const fenced = '```json\n' + inner + '\n```';
      const out = processDiagnosticBatchSplit(state, fenced, makeTask());
      expect(out).toBe('');
      expect(state._batchSplitRequeued).toBe(true);
    });
  });

  describe('always-fan-out: existing batches', () => {
    it('verification parent + 2 batches: re-enqueues original (Path A) + spawns 2 error sub-tasks + bumps batchSplitCount', () => {
      const state = makeState();
      const task = makeTask();
      const plan = JSON.stringify({
        diagnostics: { totalErrors: 3, rootCauses: ['type error'] },
        implementation: { modify: [] },
        batches: [
          { name: 'fix a', modify: ['a.ts'] },
          { name: 'fix b', modify: ['b.ts'] },
        ],
      });

      const out = processDiagnosticBatchSplit(state, plan, task);

      expect(out).toBe('');
      expect(state._batchSplitRequeued).toBe(true);
      const all = state.taskQueue.getAll();

      const errors = all.filter((t: any) => t.type === 'error');
      const verifications = all.filter((t: any) => t.type === 'verification');
      expect(errors.length).toBe(2);
      expect(verifications.length).toBe(1);

      // Counter is now on the re-queued task itself (Path A).
      const requeued = verifications[0] as any;
      expect(requeued.batchSplitCount).toBe(1);
      for (const e of errors) {
        expect((e as any).prePlanText).toBeTruthy();
      }
    });

    it('verification parent + single batch: still fans out (no length>=2 gate)', () => {
      const state = makeState();
      const task = makeTask();
      const plan = JSON.stringify({
        diagnostics: { totalErrors: 1 },
        implementation: { modify: [] },
        batches: [{ name: 'fix a', modify: ['a.ts'] }],
      });
      const out = processDiagnosticBatchSplit(state, plan, task);
      expect(out).toBe('');
      expect(state._batchSplitRequeued).toBe(true);
      const errors = state.taskQueue.getAll().filter((t: any) => t.type === 'error');
      expect(errors.length).toBe(1);
    });

    it('error parent (Tier 3/4): drops original, enqueues Final Verification, sub-tasks inherit error type', () => {
      const state = makeState();
      const task = makeTask({ type: 'error', priority: 100, name: 'fix compile errors' });
      const plan = JSON.stringify({
        diagnostics: { totalErrors: 2 },
        implementation: { modify: [] },
        batches: [
          { name: 'fix a', modify: ['a.ts'] },
          { name: 'fix b', modify: ['b.ts'] },
        ],
      });

      const out = processDiagnosticBatchSplit(state, plan, task);

      expect(out).toBe('');
      expect(state._batchSplitRequeued).toBe(true);
      const all = state.taskQueue.getAll();

      expect(all.some((t: any) => t.id === task.id)).toBe(false);
      const subTasks = all.filter((t: any) => t.priority === (task.priority! - 1));
      const finalVerifications = all.filter((t: any) => t.priority === 1000);
      expect(subTasks.length).toBe(2);
      expect(finalVerifications.length).toBe(1);
      for (const s of subTasks) {
        expect((s as any).type).toBe('error');
        expect((s as any).prePlanText).toBeTruthy();
      }
      expect(finalVerifications[0].type).toBe('verification');
      // raw-clinging-beach regression guard: Path B (drop-and-replace) MUST
      // spawn the new FV without `resumeState`, otherwise the parent error
      // task's `conversations` (rooted in `variants/error/base.md`) would be
      // restored into the FV via `TaskWorker.executeTask`'s
      // `task.interrupted && task.resumeState` gate, hijacking the FV away
      // from the `variants/verification/base.md` template (and skipping the
      // `priorErrorTasks` block).
      expect((finalVerifications[0] as any).resumeState).toBeUndefined();
    });

    it('test-code parent: drops original, spawns test-code sub-tasks with minimal shape, enqueues Final Verification', () => {
      const state = makeState();
      const task = makeTask({
        type: 'test-code',
        priority: 700,
        name: 'generate unit tests',
      });
      const plan = JSON.stringify({
        task: { id: 'parent', goal: 'generate tests' },
        batches: [
          {
            name: 'domain tests',
            rationale: 'independent of API layer',
            create: [{ target: 'src/domain/__tests__/order.test.ts', purpose: 'verify order logic' }],
            modify: [],
          },
          {
            name: 'api tests',
            rationale: 'independent of domain',
            create: [{ target: 'src/api/__tests__/routes.test.ts', purpose: 'verify routes' }],
            modify: [],
          },
        ],
      });

      const out = processDiagnosticBatchSplit(state, plan, task);

      expect(out).toBe('');
      expect(state._batchSplitRequeued).toBe(true);

      const all = state.taskQueue.getAll();
      expect(all.some((t: any) => t.id === task.id)).toBe(false);

      const subTasks = all.filter((t: any) => t.priority === (task.priority! - 1));
      const finalVerifications = all.filter((t: any) => t.priority === 1000);

      expect(subTasks.length).toBe(2);
      expect(finalVerifications.length).toBe(1);

      for (const s of subTasks) {
        const sub = s as any;
        expect(sub.type).toBe('test-code');
        expect(sub.prePlanText).toBeTruthy();
        const parsed = JSON.parse(sub.prePlanText);
        expect(parsed.implementation).toBeTruthy();
        expect(Array.isArray(parsed.implementation.create)).toBe(true);
        expect(Array.isArray(parsed.implementation.modify)).toBe(true);
        expect(parsed.diagnostics).toBeUndefined();
        expect(parsed.rootCauseSelfCheck).toBeUndefined();
        expect(parsed.slice).toBeTruthy();
        expect(sub.remediationMode).toBeUndefined();
        expect(sub.parallelGroup).toBeTruthy();
        expect(sub.exclusive).toBe(false);
        expect(sub.name.startsWith('Tests:')).toBe(true);
      }

      const groups = subTasks.map((t: any) => t.parallelGroup);
      expect(new Set(groups).size).toBe(2);

      // raw-clinging-beach regression guard (see error-parent case above):
      // Path B must spawn the FV without `resumeState` so the parent
      // test-code task's conversation cannot be restored into the FV.
      expect((finalVerifications[0] as any).resumeState).toBeUndefined();
    });

    it('test-code parent: single batch → also fans out under always-fan-out', () => {
      const state = makeState();
      const task = makeTask({ type: 'test-code', priority: 700, name: 'tests' });
      const plan = JSON.stringify({
        task: { id: 'parent', goal: 'tests' },
        batches: [
          { name: 'one slice only', create: [{ target: 'a.test.ts' }], modify: [] },
        ],
      });
      const out = processDiagnosticBatchSplit(state, plan, task);
      expect(out).toBe('');
      expect(state._batchSplitRequeued).toBe(true);
      const subs = state.taskQueue.getAll().filter((t: any) => t.type === 'test-code');
      expect(subs.length).toBe(1);
    });

    it('test-code parent: Final Verification already queued → dedup skips adding another', () => {
      const state = makeState();
      state.taskQueue.push({
        id: 'pre-existing-fv',
        name: 'Pre-existing FV',
        type: 'verification',
        priority: 1000,
      } as CodeTask);

      const task = makeTask({ type: 'test-code', priority: 700, name: 'tests' });
      const plan = JSON.stringify({
        task: { id: 'parent', goal: 'tests' },
        batches: [
          { name: 'slice a', create: [{ target: 'a.test.ts' }], modify: [] },
          { name: 'slice b', create: [{ target: 'b.test.ts' }], modify: [] },
        ],
      });

      processDiagnosticBatchSplit(state, plan, task);

      const finalVerifications = state.taskQueue
        .getAll()
        .filter((t: any) => t.priority === 1000);
      expect(finalVerifications.length).toBe(1);
      expect(finalVerifications[0].id).toBe('pre-existing-fv');
    });

    it('test-code parent: file overlap between batches forces exclusive:true on subs', () => {
      const state = makeState();
      const task = makeTask({ type: 'test-code', priority: 700, name: 'tests' });
      const plan = JSON.stringify({
        task: { id: 'parent', goal: 'tests' },
        batches: [
          {
            name: 'slice a',
            create: [{ target: 'shared.test.ts' }, { target: 'a.test.ts' }],
            modify: [],
          },
          {
            name: 'slice b',
            create: [{ target: 'shared.test.ts' }, { target: 'b.test.ts' }],
            modify: [],
          },
        ],
      });
      processDiagnosticBatchSplit(state, plan, task);
      const subs = state.taskQueue
        .getAll()
        .filter((t: any) => t.type === 'test-code');
      expect(subs.length).toBe(2);
      for (const s of subs) {
        expect((s as any).exclusive).toBe(true);
        expect((s as any).parallelGroup).toBeUndefined();
      }
    });
  });

  describe('always-fan-out: top-level → batches auto-conversion', () => {
    it('verification parent + 1 top-level modify → auto-converted into 1 per-target batch + fan-out', () => {
      
      const state = makeState();
      const plan = JSON.stringify({
        diagnostics: { totalErrors: 1 },
        implementation: { modify: [{ target: 'a.ts', action: 'fix import' }] },
      });
      const out = processDiagnosticBatchSplit(state, plan, makeTask());
      expect(out).toBe('');
      expect(state._batchSplitRequeued).toBe(true);
      const errors = state.taskQueue.getAll().filter((t: any) => t.type === 'error');
      expect(errors.length).toBe(1);
      const sub = errors[0] as any;
      const parsed = JSON.parse(sub.prePlanText);
      expect(parsed.implementation.modify).toHaveLength(1);
      expect(parsed.implementation.modify[0].target).toBe('a.ts');
    });

    it('verification parent + multiple top-level modify entries → one sub-task per target', () => {
      
      const state = makeState();
      const plan = JSON.stringify({
        diagnostics: { totalErrors: 3 },
        implementation: {
          modify: [
            { target: 'a.ts', action: 'edit' },
            { target: 'b.ts', action: 'edit' },
            { target: 'c.ts', action: 'edit' },
          ],
        },
      });
      const out = processDiagnosticBatchSplit(state, plan, makeTask());
      expect(out).toBe('');
      const errors = state.taskQueue.getAll().filter((t: any) => t.type === 'error');
      expect(errors.length).toBe(3);
      const targets = errors.map((e: any) => {
        const p = JSON.parse(e.prePlanText);
        return p.implementation.modify[0].target;
      });
      expect(targets.sort()).toEqual(['a.ts', 'b.ts', 'c.ts']);
    });

    it('verification parent + top-level mixed modify+create+delete → one sub-task per entry across all 3 buckets', () => {
      
      const state = makeState();
      const plan = JSON.stringify({
        diagnostics: { totalErrors: 3 },
        implementation: {
          modify: [{ target: 'a.ts', action: 'edit' }],
          create: [{ target: 'b.ts', purpose: 'new file' }],
          delete: [{ target: 'c.ts', reason: 'obsolete' }],
        },
      });
      const out = processDiagnosticBatchSplit(state, plan, makeTask());
      expect(out).toBe('');
      const errors = state.taskQueue.getAll().filter((t: any) => t.type === 'error');
      expect(errors.length).toBe(3);
    });

    it('plan with both batches[] and top-level entries: existing batches respected (no re-conversion)', () => {
      const state = makeState();
      const plan = JSON.stringify({
        diagnostics: { totalErrors: 5 },
        implementation: {
          modify: [{ target: 'top-level.ts', action: 'should be ignored' }],
        },
        batches: [
          { name: 'batch a', modify: [{ target: 'a.ts' }, { target: 'b.ts' }] },
          { name: 'batch b', modify: [{ target: 'c.ts' }] },
        ],
      });
      const out = processDiagnosticBatchSplit(state, plan, makeTask());
      expect(out).toBe('');
      const errors = state.taskQueue.getAll().filter((t: any) => t.type === 'error');
      expect(errors.length).toBe(2);
      // batch a stays grouped (2 modify entries), batch b stays grouped (1 modify entry).
      // top-level modify is ignored when batches are already provided.
    });
  });

  describe('Hard limit: MAX_BATCH_SPLIT_CYCLES', () => {
    it(`task.batchSplitCount at ceiling throws VerificationTerminalError('batch_cycle_limit')`, () => {
      const state = makeState();
      const task = makeTask({ batchSplitCount: MAX_BATCH_SPLIT_CYCLES });
      const plan = JSON.stringify({
        diagnostics: { totalErrors: 2 },
        implementation: { modify: [] },
        batches: [
          { name: 'fix a', modify: ['a.ts'] },
          { name: 'fix b', modify: ['b.ts'] },
        ],
      });
      let thrown: unknown;
      try {
        processDiagnosticBatchSplit(state, plan, task);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(VerificationTerminalError);
      expect((thrown as VerificationTerminalError).kind).toBe('batch_cycle_limit');
      expect((thrown as VerificationTerminalError).message).toMatch(/cycle limit/i);
      expect((task as any)._failed).toBeUndefined();
      expect(state._batchSplitRequeued).toBe(false);
    });
  });

});

// ════════════════════════════════════════════════════════════════════════════
// classifyTerminalError dispatcher (sibling helper)
// ════════════════════════════════════════════════════════════════════════════

describe('classifyTerminalError', () => {
  it('returns terminal:true with kind for VerificationTerminalError', () => {
    const err = new VerificationTerminalError(
      'max_retries_exceeded',
      'Task "X" failed after 3 attempts (max: 3).',
    );
    expect(classifyTerminalError(err)).toEqual({ terminal: true, kind: 'max_retries_exceeded' });
  });

  it('returns terminal:false for plain Error (regex fallback applies)', () => {
    expect(classifyTerminalError(new Error('some transient network issue'))).toEqual({ terminal: false });
  });

  it('works for all defined kinds', () => {
    const kinds = [
      'max_retries_exceeded',
      'unresolved_violations',
      'batch_cycle_limit',
      'orchestrator_fail_limit',
    ] as const;
    for (const k of kinds) {
      expect(classifyTerminalError(new VerificationTerminalError(k, 'msg'))).toEqual({ terminal: true, kind: k });
    }
  });

  it('preserves instanceof through throw/catch so callers can branch on type', () => {
    try {
      throw new VerificationTerminalError('batch_cycle_limit', 'loop detected');
    } catch (e) {
      expect(e instanceof VerificationTerminalError).toBe(true);
      expect((e as VerificationTerminalError).kind).toBe('batch_cycle_limit');
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// hasEmptyImplementation (Axis F-1) — sibling helper
// ════════════════════════════════════════════════════════════════════════════

describe('Axis F-1 — hasEmptyImplementation', () => {
  it('detects empty modify/create/delete with no batches', () => {
    const plan = JSON.stringify({
      task: { id: 'x', goal: 'y' },
      diagnostics: { totalErrors: 0 },
      implementation: { modify: [], create: [], delete: [] },
    });
    expect(hasEmptyImplementation(plan)).toBe(true);
  });

  it('treats missing implementation keys as empty', () => {
    const plan = JSON.stringify({
      task: { id: 'x', goal: 'y' },
      diagnostics: { totalErrors: 0 },
      implementation: {},
    });
    expect(hasEmptyImplementation(plan)).toBe(true);
  });

  it('non-empty modify list is NOT empty', () => {
    const plan = JSON.stringify({
      implementation: { modify: [{ target: 'src/a.ts' }], create: [], delete: [] },
    });
    expect(hasEmptyImplementation(plan)).toBe(false);
  });

  it('plan with batches is NOT empty', () => {
    const plan = JSON.stringify({
      implementation: { modify: [], create: [], delete: [] },
      batches: [{ name: 'one', modify: [{ target: 'src/a.ts' }] }],
    });
    expect(hasEmptyImplementation(plan)).toBe(false);
  });

  it('strips markdown fences before parsing', () => {
    const plan = '```json\n' + JSON.stringify({
      implementation: { modify: [], create: [], delete: [] },
    }) + '\n```';
    expect(hasEmptyImplementation(plan)).toBe(true);
  });

  it('invalid JSON returns false (not empty, so execute normally)', () => {
    expect(hasEmptyImplementation('not json at all')).toBe(false);
  });

  it('undefined/empty string return false', () => {
    expect(hasEmptyImplementation(undefined)).toBe(false);
    expect(hasEmptyImplementation('')).toBe(false);
  });
});
