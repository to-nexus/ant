/**
 * L1 unit — processDiagnosticBatchSplit (plan node).
 *
 *   C6  batches >= 2 → split into error sub-tasks, re-enqueue original
 *   C7  forceByRepeat (Session.isPlanRepeated) → force split
 *   C9  overErrorBudget / overFileBudget → force split
 *   Edge: non-verification/error task → noop
 *   Edge: short planText (<= 50 chars) → noop
 *   Edge: unparseable JSON → noop (returns original)
 *   Hard limit: MAX_BATCH_SPLIT_CYCLES exceeded → throw VerificationTerminalError('batch_cycle_limit')
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { __testing__ } from '../../../src/agents/architect/graph/code/nodes/plan/index';
import { VerificationSession } from '../../../src/agents/architect/graph/code/tasks/verification/model/Session';
import { VerificationTerminalError } from '../../../src/agents/architect/graph/code/tasks/verification/model/errors';
import { TaskQueue } from '../../../src/agents/architect/types/task';
import type { CodeTask } from '../../../src/agents/architect/types/task';

const { processDiagnosticBatchSplit, normalizePlanForHash, MAX_BATCH_SPLIT_CYCLES } = __testing__;

interface StateOverrides {
  verification?: VerificationSession;
  _batchSplitRequeued?: boolean;
}

function makeState(overrides: StateOverrides = {}): any {
  return {
    taskQueue: new TaskQueue<CodeTask>(),
    verification: overrides.verification ?? VerificationSession.createFresh({ isTs: true, hasTests: false }),
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

describe('processDiagnosticBatchSplit — batch split decisions', () => {
  beforeEach(() => {
    delete process.env.ANT_VERIFICATION_SPLIT_ERRORS;
    delete process.env.ANT_VERIFICATION_SPLIT_FILES;
  });

  describe('task type gating', () => {
    it('non-verification / non-error task → noop (returns original)', () => {
      const state = makeState();
      // Realistic feature task — priority in the feature band and a
      // non-verification-keyword name so neither the priority fallback nor
      // the name fallback on `isVerificationTask` fires. T6b-η: since the
      // type-only `isDiagnosticTask` helper was deleted, the gate is now
      // `isVerificationTask(t) || isErrorTask(t)`; the predicate layer
      // uses the richer verification discriminator, so this test must use
      // unambiguous inputs.
      const task = makeTask({ type: 'feature', priority: 50, name: 'implement login form' });
      const planText = JSON.stringify({ batches: [{ name: 'a' }, { name: 'b' }], implementation: { modify: ['f1.ts', 'f2.ts'] } });
      const out = processDiagnosticBatchSplit(state, planText, task);
      expect(out).toBe(planText);
      expect(state.taskQueue.size()).toBe(0);
      expect(state._batchSplitRequeued).toBe(false);
    });

    it('error task is a valid split target (decompose-emitted error without prePlanText)', () => {
      const state = makeState();
      // Error-band priority + unambiguous name — batch-split-spawned error
      // tasks use `prePlanText` fast-path and never reach this function,
      // so the realistic split-target scenario is a decompose-emitted
      // error task without prePlanText.
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

    it('batches array of length 1 and no force conditions → noop', () => {
      const state = makeState();
      const plan = JSON.stringify({
        diagnostics: { totalErrors: 1 },
        implementation: { modify: ['a.ts'] },
        batches: [{ name: 'single', modify: ['a.ts'] }],
      });
      const out = processDiagnosticBatchSplit(state, plan, makeTask());
      expect(out).toBe(plan);
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

  describe('C6: batches >= 2 → split', () => {
    it('creates sub-tasks, re-enqueues original, and bumps Session.batchSplitCount', () => {
      const session = VerificationSession.createFresh({ isTs: true, hasTests: false });
      const state = makeState({ verification: session });
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
      // The Session now owns the cycle counter — the re-queued task's
      // resumeState carries the snapshot with batchSplitCount=1.
      expect(session.batchSplitCount()).toBe(1);
      const requeued = verifications[0] as any;
      expect(requeued.resumeState?.verification?.batchSplitCount).toBe(1);
      for (const e of errors) {
        expect((e as any).prePlanText).toBeTruthy();
      }
    });
  });

  describe('C7: forceByRepeat (Session.isPlanRepeated)', () => {
    it('same plan previously applied + single batch + modify present → force split', () => {
      const plan = JSON.stringify({
        diagnostics: { totalErrors: 1 },
        implementation: { modify: ['a.ts', 'b.ts'] },
      });
      // Session records the plan as applied so the next identical plan
      // fires the repeated-plan detector.
      const session = VerificationSession.createFresh({ isTs: true, hasTests: false });
      session.onPlanApplied(plan);
      const state = makeState({ verification: session });
      const task = makeTask();

      const out = processDiagnosticBatchSplit(state, plan, task);

      expect(out).toBe('');
      expect(state._batchSplitRequeued).toBe(true);
      const errors = state.taskQueue.getAll().filter((t: any) => t.type === 'error');
      expect(errors.length).toBe(2);
    });

    it('different plan in history → does not force by repeat', () => {
      const plan = JSON.stringify({
        diagnostics: { totalErrors: 1 },
        implementation: { modify: ['a.ts'] },
      });
      const otherPlan = JSON.stringify({
        diagnostics: { totalErrors: 1 },
        implementation: { modify: ['different.ts'] },
      });
      const session = VerificationSession.createFresh({ isTs: true, hasTests: false });
      session.onPlanApplied(otherPlan);
      const state = makeState({ verification: session });
      const task = makeTask();

      const out = processDiagnosticBatchSplit(state, plan, task);
      expect(out).toBe(plan);
    });
  });

  describe('C9: overErrorBudget / overFileBudget', () => {
    it('totalErrors >= threshold (default 6) → force split', () => {
      const plan = JSON.stringify({
        diagnostics: { totalErrors: 7 },
        implementation: { modify: ['a.ts', 'b.ts'] },
      });
      const state = makeState();
      const out = processDiagnosticBatchSplit(state, plan, makeTask());
      expect(out).toBe('');
      expect(state._batchSplitRequeued).toBe(true);
    });

    it('modify files >= threshold (default 4) → force split', () => {
      const plan = JSON.stringify({
        diagnostics: { totalErrors: 1 },
        implementation: { modify: ['a.ts', 'b.ts', 'c.ts', 'd.ts'] },
      });
      const state = makeState();
      const out = processDiagnosticBatchSplit(state, plan, makeTask());
      expect(out).toBe('');
      expect(state._batchSplitRequeued).toBe(true);
    });

    it('env override ANT_VERIFICATION_SPLIT_ERRORS honored', () => {
      process.env.ANT_VERIFICATION_SPLIT_ERRORS = '2';
      const plan = JSON.stringify({
        diagnostics: { totalErrors: 3 },
        implementation: { modify: ['a.ts', 'b.ts'] },
      });
      const state = makeState();
      const out = processDiagnosticBatchSplit(state, plan, makeTask());
      expect(out).toBe('');
      expect(state._batchSplitRequeued).toBe(true);
    });
  });

  describe('Hard limit: MAX_BATCH_SPLIT_CYCLES', () => {
    // T8 — throw typed terminal error instead of mutating `task._failed`.
    // Orchestrator classifyTerminalError handles it at `reportFailure`, so
    // the plan node no longer side-effects permanent-fail state.
    it(`Session.batchSplitCount at ceiling throws VerificationTerminalError('batch_cycle_limit')`, () => {
      // Drive the Session to one-less-than the cycle limit so the next
      // would-be split produces splitCount > MAX and throws.
      const session = VerificationSession.createFresh({ isTs: true, hasTests: false });
      for (let i = 0; i < MAX_BATCH_SPLIT_CYCLES; i++) {
        session.onBatchSplit(JSON.stringify({ cycle: i + 1 }));
      }
      const state = makeState({ verification: session });
      const task = makeTask();
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
      // The throw path no longer mutates `_failed` / `_batchSplitRequeued`
      // — the orchestrator's permanent-fail branch owns that transition.
      expect((task as any)._failed).toBeUndefined();
      expect(state._batchSplitRequeued).toBe(false);
    });
  });

  describe('normalizePlanForHash', () => {
    it('returns same hash for semantically identical JSON with different key order', () => {
      const a = JSON.stringify({ a: 1, b: 2 });
      const b = JSON.stringify({ b: 2, a: 1 });
      expect(normalizePlanForHash(a)).toBe(normalizePlanForHash(b));
    });

    it('returns different hash for different content', () => {
      const a = JSON.stringify({ a: 1 });
      const b = JSON.stringify({ a: 2 });
      expect(normalizePlanForHash(a)).not.toBe(normalizePlanForHash(b));
    });

    it('handles markdown code fence wrappers', () => {
      const body = JSON.stringify({ a: 1 });
      const fenced = '```json\n' + body + '\n```';
      expect(normalizePlanForHash(body)).toBe(normalizePlanForHash(fenced));
    });

    it('falls back to whitespace-collapsed hash for invalid JSON', () => {
      expect(() => normalizePlanForHash('not json')).not.toThrow();
      const h1 = normalizePlanForHash('not   json');
      const h2 = normalizePlanForHash('not json');
      expect(h1).toBe(h2);
    });
  });
});
