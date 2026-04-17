/**
 * L1 unit — processDiagnosticBatchSplit (plan node).
 *
 * Covers (see docs/testing/verification-scenarios.md, matrix C6-C9):
 *   C6  batches >= 2 → split into error sub-tasks, re-enqueue original
 *   C7  forceByRepeat (_lastPlanHash repeat) → force split
 *   C8  budgetExhausted (_verificationBudget=0) → force split
 *   C9  overErrorBudget / overFileBudget → force split
 *   Edge: non-verification/error task → noop
 *   Edge: short planText (<= 50 chars) → noop
 *   Edge: unparseable JSON → noop (returns original)
 *   Hard limit: MAX_BATCH_SPLIT_CYCLES exceeded → mark failed, return ''
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { __testing__ } from '../../../src/agents/architect/graph/code/nodes/plan/index';
import { TaskQueue } from '../../../src/agents/architect/types/task';
import type { CodeTask } from '../../../src/agents/architect/types/task';

const { processDiagnosticBatchSplit, normalizePlanForHash, MAX_BATCH_SPLIT_CYCLES } = __testing__;

function makeState(overrides: Record<string, any> = {}): any {
  return {
    taskQueue: new TaskQueue<CodeTask>(),
    _verificationBudget: 5,
    _lastPlanHash: undefined,
    _batchSplitRequeued: false,
    context: { featurePath: undefined },
    _httpJobId: undefined,
    ...overrides,
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
      const task = makeTask({ type: 'feature' });
      const planText = JSON.stringify({ batches: [{ name: 'a' }, { name: 'b' }], implementation: { modify: ['f1.ts', 'f2.ts'] } });
      const out = processDiagnosticBatchSplit(state, planText, task);
      expect(out).toBe(planText);
      expect(state.taskQueue.size()).toBe(0);
      expect(state._batchSplitRequeued).toBe(false);
    });

    it('error task is a valid split target (same behavior as verification)', () => {
      const state = makeState();
      const task = makeTask({ type: 'error' });
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
    it('creates sub-tasks and re-enqueues original', () => {
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
      expect((verifications[0] as any)._batchSplitCount).toBe(1);
      for (const e of errors) {
        expect((e as any).prePlanText).toBeTruthy();
      }
    });
  });

  describe('C7: forceByRepeat (_lastPlanHash repeat)', () => {
    it('same plan hash twice + single batch + modify present → force split', () => {
      const plan = JSON.stringify({
        diagnostics: { totalErrors: 1 },
        implementation: { modify: ['a.ts', 'b.ts'] },
      });
      const state = makeState({ _lastPlanHash: normalizePlanForHash(plan) });
      const task = makeTask();

      const out = processDiagnosticBatchSplit(state, plan, task);

      expect(out).toBe('');
      expect(state._batchSplitRequeued).toBe(true);
      const errors = state.taskQueue.getAll().filter((t: any) => t.type === 'error');
      expect(errors.length).toBe(2);
    });

    it('different plan hash → does not force by repeat', () => {
      const plan = JSON.stringify({
        diagnostics: { totalErrors: 1 },
        implementation: { modify: ['a.ts'] },
      });
      const state = makeState({ _lastPlanHash: 'different-hash' });
      const task = makeTask();

      const out = processDiagnosticBatchSplit(state, plan, task);
      expect(out).toBe(plan);
    });
  });

  describe('C8: budgetExhausted (_verificationBudget <= 0)', () => {
    it('budget=0 + multiple modify files → force split', () => {
      // Force split rebuilds `batches` from `implementation.modify`, then the
      // "batches.length <= 1" guard blocks single-file cases. Splitting only
      // actually occurs when there are >= 2 files to split across batches.
      const plan = JSON.stringify({
        diagnostics: { totalErrors: 1 },
        implementation: { modify: ['a.ts', 'b.ts'] },
      });
      const state = makeState({ _verificationBudget: 0 });
      const out = processDiagnosticBatchSplit(state, plan, makeTask());
      expect(out).toBe('');
      expect(state._batchSplitRequeued).toBe(true);
      const errors = state.taskQueue.getAll().filter((t: any) => t.type === 'error');
      expect(errors.length).toBe(2);
    });

    it('budget=0 + single modify file → noop (not enough to split)', () => {
      const plan = JSON.stringify({
        diagnostics: { totalErrors: 1 },
        implementation: { modify: ['a.ts'] },
      });
      const state = makeState({ _verificationBudget: 0 });
      const out = processDiagnosticBatchSplit(state, plan, makeTask());
      expect(out).toBe(plan);
    });

    it('budget > 0 and no other force condition → noop', () => {
      const plan = JSON.stringify({
        diagnostics: { totalErrors: 1 },
        implementation: { modify: ['a.ts'] },
      });
      const state = makeState({ _verificationBudget: 5 });
      const out = processDiagnosticBatchSplit(state, plan, makeTask());
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
    it(`splitCount > ${MAX_BATCH_SPLIT_CYCLES} marks task failed and returns ''`, () => {
      const state = makeState();
      const task = makeTask({ _batchSplitCount: MAX_BATCH_SPLIT_CYCLES } as any);
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
      expect((task as any)._failed).toBe(true);
      expect((task as any)._failureReason).toMatch(/batch_split_cycle_limit_exceeded/);
      expect(state._batchSplitRequeued).toBe(true);
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
