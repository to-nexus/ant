/**
 * L1 unit — verification batch-split + sibling diagnostic helpers SSOT.
 *
 *   1. processDiagnosticBatchSplit (plan node) — always-fan-out semantics:
 *        - top-level implementation entries → per-target batches
 *        - existing batches (any count) → fan-out as-is
 *        - 0 entries / non-verification task / short planText / bad JSON → noop
 *        - hard limit: MAX_BATCH_SPLIT_CYCLES → throw VerificationTerminalError
 *
 *   2. Schema-violation channel — LLM-authored semantic fields are SSOT
 *      for child task name/description (the system MUST NOT fabricate).
 *      Missing `create.name` / `modify.action` / `delete.reason` /
 *      `batches[].name` / `batches[].rationale` throws
 *      `BatchSplitSchemaViolation` for the plan-node retry loop to
 *      catch and re-issue with framing.
 *
 *   3. classifyTerminalError dispatcher — typed terminal errors are
 *      recognised by the orchestrator BEFORE the legacy regex-based
 *      `isDeterministicError` runs.
 *
 *   4. hasEmptyImplementation (Axis F-1) — detects empty modify/create/delete
 *      with no batches; treats markdown-fenced JSON, missing keys, and
 *      invalid JSON safely.
 */

import { describe, it, expect } from 'vitest';
import {
  processDiagnosticBatchSplit,
  MAX_BATCH_SPLIT_CYCLES,
  BatchSplitSchemaViolation,
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
    it('task type without a policy entry (e.g. setup) → noop (returns original)', () => {
      const state = makeState();
      const task = makeTask({ type: 'setup', priority: 100, name: 'init project' });
      const planText = JSON.stringify({
        batches: [
          { name: 'a', rationale: 'a slice', modify: ['f1.ts'] },
          { name: 'b', rationale: 'b slice', modify: ['f2.ts'] },
        ],
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
          { name: 'fix a', rationale: 'fix import errors in a', modify: ['a.ts'] },
          { name: 'fix b', rationale: 'fix import errors in b', modify: ['b.ts'] },
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
          { name: 'fix a', rationale: 'fix import errors in a', modify: ['a.ts'] },
          { name: 'fix b', rationale: 'fix import errors in b', modify: ['b.ts'] },
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
          { name: 'fix a', rationale: 'remediate type error in a', modify: ['a.ts'] },
          { name: 'fix b', rationale: 'remediate type error in b', modify: ['b.ts'] },
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
        batches: [{ name: 'fix a', rationale: 'remediate failure in a', modify: ['a.ts'] }],
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
          { name: 'fix a', rationale: 'compile error in a', modify: ['a.ts'] },
          { name: 'fix b', rationale: 'compile error in b', modify: ['b.ts'] },
        ],
      });

      const out = processDiagnosticBatchSplit(state, plan, task);

      expect(out).toBe('');
      expect(state._batchSplitRequeued).toBe(true);
      const all = state.taskQueue.getAll();

      expect(all.some((t: any) => t.id === task.id)).toBe(false);
      // Path B: sub-task priority equals parent priority (Three-Axis SSOT —
      // the parent is gone, so preserving priority keeps the band
      // classification stable and prevents foundation-window drift).
      const subTasks = all.filter((t: any) => t.priority === task.priority);
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
            create: [{ name: 'order-test', target: 'src/domain/__tests__/order.test.ts', purpose: 'verify order logic' }],
            modify: [],
          },
          {
            name: 'api tests',
            rationale: 'independent of domain',
            create: [{ name: 'routes-test', target: 'src/api/__tests__/routes.test.ts', purpose: 'verify routes' }],
            modify: [],
          },
        ],
      });

      const out = processDiagnosticBatchSplit(state, plan, task);

      expect(out).toBe('');
      expect(state._batchSplitRequeued).toBe(true);

      const all = state.taskQueue.getAll();
      expect(all.some((t: any) => t.id === task.id)).toBe(false);

      // Path B: sub-task priority equals parent priority.
      const subTasks = all.filter((t: any) => t.priority === task.priority);
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
        // Child name is `batch.name` verbatim — no system-side prefix.
        expect(sub.name === 'domain tests' || sub.name === 'api tests').toBe(true);
        expect(sub.description === 'independent of API layer' || sub.description === 'independent of domain').toBe(true);
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
          { name: 'one slice only', rationale: 'sole slice', create: [{ target: 'a.test.ts' }], modify: [] },
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
          { name: 'slice a', rationale: 'a slice', create: [{ target: 'a.test.ts' }], modify: [] },
          { name: 'slice b', rationale: 'b slice', create: [{ target: 'b.test.ts' }], modify: [] },
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
            rationale: 'a tests with shared',
            create: [{ target: 'shared.test.ts' }, { target: 'a.test.ts' }],
            modify: [],
          },
          {
            name: 'slice b',
            rationale: 'b tests with shared',
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
          create: [{ name: 'new-module', target: 'b.ts', purpose: 'new file' }],
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
          { name: 'batch a', rationale: 'a slice', modify: [{ target: 'a.ts' }, { target: 'b.ts' }] },
          { name: 'batch b', rationale: 'b slice', modify: [{ target: 'c.ts' }] },
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

  describe('feature parent (Tier 3 deep-think fan-out)', () => {
    it('drops original, spawns feature sub-tasks with parentReasoning, enqueues Final Verification', () => {
      const state = makeState();
      const task = makeTask({
        type: 'feature',
        priority: 300,
        name: 'add wallet connect button',
        parallelGroup: 'fe-main',
      });
      const plan = JSON.stringify({
        task: { id: 'parent', goal: 'wallet connect button across header + checkout' },
        parentReasoning: 'Header and checkout share the same wallet adapter; both call connectWallet() then signMessage(payload).',
        batches: [
          {
            name: 'header button',
            rationale: 'header navbar entry point',
            modify: [{ target: 'src/header/Nav.tsx', action: 'add ConnectButton' }],
            create: [],
            delete: [],
          },
          {
            name: 'checkout button',
            rationale: 'checkout flow entry point',
            modify: [{ target: 'src/checkout/Confirm.tsx', action: 'add ConnectButton' }],
            create: [],
            delete: [],
          },
        ],
      });

      const out = processDiagnosticBatchSplit(state, plan, task);

      expect(out).toBe('');
      expect(state._batchSplitRequeued).toBe(true);
      const all = state.taskQueue.getAll();
      expect(all.some((t: any) => t.id === task.id)).toBe(false);

      // Path B (drop-and-replace): sub-task priority equals parent priority.
      const subs = all.filter((t: any) => t.priority === task.priority);
      const fvs = all.filter((t: any) => t.priority === 1000);
      expect(subs.length).toBe(2);
      expect(fvs.length).toBe(1);

      for (const s of subs) {
        const sub = s as any;
        expect(sub.type).toBe('feature');
        expect(sub.prePlanText).toBeTruthy();
        const parsed = JSON.parse(sub.prePlanText);
        expect(parsed.parentReasoning).toMatch(/wallet adapter/i);
        expect(parsed.implementation).toBeTruthy();
        expect(parsed.diagnostics).toBeUndefined();
        expect(sub.batchSplitCount).toBe(1);
        // parallelGroup inherits parent's group name when files are disjoint.
        expect(sub.parallelGroup).toMatch(/^fe-main-/);
      }
    });

    it('Tier 2 escalate: selfVerifyOnDone feature parent + batches[] → drop-and-replace + FV', () => {
      const state = makeState();
      state.executionTier = 2;
      const task = makeTask({
        type: 'feature',
        priority: 300,
        name: 'tier-2 feature',
        selfVerifyOnDone: true,
      });
      const plan = JSON.stringify({
        task: { id: 'parent', goal: 'split a Tier-2 feature across packages' },
        parentReasoning: 'Plan discovered the unit truly spans BE + FE and must escalate.',
        batches: [
          { name: 'be slice', rationale: 'backend handler implementation', modify: [{ target: 'be/handler.ts' }], create: [], delete: [] },
          { name: 'fe slice', rationale: 'frontend page implementation', modify: [{ target: 'fe/page.tsx' }], create: [], delete: [] },
        ],
      });

      const out = processDiagnosticBatchSplit(state, plan, task);
      expect(out).toBe('');
      expect(state._batchSplitRequeued).toBe(true);

      const all = state.taskQueue.getAll();
      expect(all.some((t: any) => t.id === task.id)).toBe(false);
      const subs = all.filter((t: any) => t.type === 'feature');
      const fvs = all.filter((t: any) => t.priority === 1000);
      expect(subs.length).toBe(2);
      expect(fvs.length).toBe(1);
      // Tier 2 escalate sub-tasks MUST NOT carry the flag — gate moves to FV.
      for (const s of subs) {
        expect((s as any).selfVerifyOnDone).toBeUndefined();
      }
    });

    it('children carry batchSplitCount = parent + 1 (lineage cycle protection)', () => {
      const state = makeState();
      const task = makeTask({
        type: 'feature',
        priority: 300,
        name: 'grandchild test',
        batchSplitCount: 3,
      });
      const plan = JSON.stringify({
        batches: [
          { name: 'a', rationale: 'a unit', modify: [{ target: 'a.ts' }], create: [], delete: [] },
          { name: 'b', rationale: 'b unit', modify: [{ target: 'b.ts' }], create: [], delete: [] },
        ],
      });
      processDiagnosticBatchSplit(state, plan, task);
      // Path B (feature parent = drop-and-replace): sub priority = parent priority.
      const subs = state.taskQueue
        .getAll()
        .filter((t: any) => t.priority === task.priority);
      for (const s of subs) {
        expect((s as any).batchSplitCount).toBe(4);
      }
    });
  });

  describe('ui parent fan-out', () => {
    it('drops original, spawns ui sub-tasks (acceptsPrePlanText:false → still goes through plan-tool-loop)', () => {
      const state = makeState();
      const task = makeTask({
        type: 'ui',
        priority: 660,
        name: 'render dashboard widgets',
      });
      const plan = JSON.stringify({
        task: { id: 'parent', goal: 'split dashboard widgets' },
        parentReasoning: 'Each widget is independent; share Card/Widget primitives.',
        batches: [
          { name: 'metrics widget', rationale: 'metrics widget unit', modify: [{ target: 'src/dashboard/Metrics.tsx' }], create: [], delete: [] },
          { name: 'chart widget', rationale: 'chart widget unit', modify: [{ target: 'src/dashboard/Chart.tsx' }], create: [], delete: [] },
        ],
      });

      const out = processDiagnosticBatchSplit(state, plan, task);
      expect(out).toBe('');
      expect(state._batchSplitRequeued).toBe(true);

      const all = state.taskQueue.getAll();
      const subs = all.filter((t: any) => t.type === 'ui');
      const fvs = all.filter((t: any) => t.priority === 1000);
      expect(subs.length).toBe(2);
      expect(fvs.length).toBe(1);
      for (const s of subs) {
        const sub = s as any;
        expect(sub.prePlanText).toBeTruthy();
        const parsed = JSON.parse(sub.prePlanText);
        expect(parsed.parentReasoning).toMatch(/widget/i);
      }
    });
  });

  describe('Schema-violation throw → plan-node retry signal', () => {
    it('top-level modify entry missing `action` throws BatchSplitSchemaViolation(modify, missingField=action)', () => {
      const state = makeState();
      const plan = JSON.stringify({
        diagnostics: { totalErrors: 1 },
        implementation: {
          modify: [{ target: 'a.ts' }], // ← `action` 누락
        },
      });
      let thrown: unknown;
      try {
        processDiagnosticBatchSplit(state, plan, makeTask());
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(BatchSplitSchemaViolation);
      const v = thrown as BatchSplitSchemaViolation;
      expect(v.detail.entryKind).toBe('modify');
      expect(v.detail.ordinal).toBe(0);
      expect(v.detail.missingField).toBe('action');
    });

    it('top-level create entry missing `name` throws BatchSplitSchemaViolation(create, missingField=name)', () => {
      const state = makeState();
      const plan = JSON.stringify({
        diagnostics: { totalErrors: 1 },
        implementation: {
          create: [{ target: 'b.ts', purpose: 'new module' }], // ← `name` 누락
        },
      });
      let thrown: unknown;
      try {
        processDiagnosticBatchSplit(state, plan, makeTask());
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(BatchSplitSchemaViolation);
      const v = thrown as BatchSplitSchemaViolation;
      expect(v.detail.entryKind).toBe('create');
      expect(v.detail.missingField).toBe('name');
    });

    it('top-level delete entry missing `reason` throws BatchSplitSchemaViolation(delete, missingField=reason)', () => {
      const state = makeState();
      const plan = JSON.stringify({
        diagnostics: { totalErrors: 1 },
        implementation: {
          delete: [{ target: 'c.ts' }], // ← `reason` 누락
        },
      });
      let thrown: unknown;
      try {
        processDiagnosticBatchSplit(state, plan, makeTask());
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(BatchSplitSchemaViolation);
      const v = thrown as BatchSplitSchemaViolation;
      expect(v.detail.entryKind).toBe('delete');
      expect(v.detail.missingField).toBe('reason');
    });

    it('explicit batches[] entry missing `name` throws BatchSplitSchemaViolation(batch, missingField=name)', () => {
      const state = makeState();
      const plan = JSON.stringify({
        diagnostics: { totalErrors: 2 },
        implementation: { modify: [] },
        batches: [
          { rationale: 'unit a', modify: ['a.ts'] }, // ← `name` 누락
          { name: 'fix b', rationale: 'unit b', modify: ['b.ts'] },
        ],
      });
      let thrown: unknown;
      try {
        processDiagnosticBatchSplit(state, plan, makeTask());
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(BatchSplitSchemaViolation);
      const v = thrown as BatchSplitSchemaViolation;
      expect(v.detail.entryKind).toBe('batch');
      expect(v.detail.ordinal).toBe(0);
      expect(v.detail.missingField).toBe('name');
    });

    it('explicit batches[] entry missing `rationale` throws BatchSplitSchemaViolation(batch, missingField=rationale)', () => {
      const state = makeState();
      const plan = JSON.stringify({
        diagnostics: { totalErrors: 2 },
        implementation: { modify: [] },
        batches: [
          { name: 'fix a', rationale: 'unit a', modify: ['a.ts'] },
          { name: 'fix b', modify: ['b.ts'] }, // ← `rationale` 누락
        ],
      });
      let thrown: unknown;
      try {
        processDiagnosticBatchSplit(state, plan, makeTask());
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(BatchSplitSchemaViolation);
      const v = thrown as BatchSplitSchemaViolation;
      expect(v.detail.entryKind).toBe('batch');
      expect(v.detail.ordinal).toBe(1);
      expect(v.detail.missingField).toBe('rationale');
    });

    it('empty-string `action` is treated as missing (whitespace-only too)', () => {
      const state = makeState();
      const plan = JSON.stringify({
        implementation: {
          modify: [{ target: 'a.ts', action: '   ' }],
        },
      });
      let thrown: unknown;
      try {
        processDiagnosticBatchSplit(state, plan, makeTask());
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(BatchSplitSchemaViolation);
    });
  });

  describe('Child task name/description == LLM-authored verbatim', () => {
    it('explicit batches[] → child name === batch.name (no system prefix)', () => {
      const state = makeState();
      const task = makeTask({ type: 'feature', priority: 300, name: 'parent feat' });
      const plan = JSON.stringify({
        batches: [
          {
            name: 'firebase-web-singleton',
            rationale: 'Firebase Web SDK client singleton with Google OAuth popup',
            create: [{ name: 'fb', target: 'firebase.ts', purpose: 'firebase singleton' }],
            modify: [],
            delete: [],
          },
        ],
      });
      processDiagnosticBatchSplit(state, plan, task);
      const subs = state.taskQueue.getAll().filter((t: any) => t.type === 'feature');
      expect(subs).toHaveLength(1);
      const sub = subs[0] as any;
      expect(sub.name).toBe('firebase-web-singleton');
      expect(sub.description).toBe('Firebase Web SDK client singleton with Google OAuth popup');
      // Regression guard — historical "Fix: " / "Tests: " / "Add: " prefixes
      // MUST NOT appear at the start of any LLM-authored name.
      expect(sub.name.startsWith('Fix: ')).toBe(false);
      expect(sub.name.startsWith('Tests: ')).toBe(false);
    });

    it('auto-convert create → child name === entry.name (LLM module name verbatim)', () => {
      const state = makeState();
      const plan = JSON.stringify({
        implementation: {
          create: [
            { name: 'axios-http-client', target: 'http.ts', purpose: 'axios instance' },
            { name: 'firebase-web-singleton', target: 'fb.ts', purpose: 'firebase singleton' },
          ],
        },
      });
      processDiagnosticBatchSplit(state, plan, makeTask());
      const subs = state.taskQueue.getAll().filter((t: any) => t.type === 'error');
      const names = subs.map((s: any) => s.name).sort();
      expect(names).toEqual(['axios-http-client', 'firebase-web-singleton']);
      // No path-as-name leakage.
      for (const n of names) {
        expect(n).not.toMatch(/\.ts$/);
        expect(n).not.toMatch(/^Fix /);
      }
    });

    it('auto-convert modify → child name === entry.action (LLM verb phrase verbatim); description joins changes', () => {
      const state = makeState();
      const plan = JSON.stringify({
        implementation: {
          modify: [
            {
              target: 'package.json',
              action: 'Add runtime dependencies for shared layer',
              changes: ['Add firebase ^10.12', 'Add axios ^1.0', 'Add next-intl ^3.0'],
            },
          ],
        },
      });
      processDiagnosticBatchSplit(state, plan, makeTask());
      const subs = state.taskQueue.getAll().filter((t: any) => t.type === 'error');
      expect(subs).toHaveLength(1);
      const sub = subs[0] as any;
      expect(sub.name).toBe('Add runtime dependencies for shared layer');
      expect(sub.description).toBe('Add firebase ^10.12; Add axios ^1.0; Add next-intl ^3.0');
    });

    it('auto-convert delete → child name === entry.reason (LLM verbatim)', () => {
      const state = makeState();
      const plan = JSON.stringify({
        implementation: {
          delete: [{ target: 'old.ts', reason: 'Replace with new implementation in shared/' }],
        },
      });
      processDiagnosticBatchSplit(state, plan, makeTask());
      const subs = state.taskQueue.getAll().filter((t: any) => t.type === 'error');
      expect(subs).toHaveLength(1);
      const sub = subs[0] as any;
      expect(sub.name).toBe('Replace with new implementation in shared/');
    });

    it('regression guard — no system-side prefix or placeholder shape leaks into any sub-task name', () => {
      const state = makeState();
      const task = makeTask({ type: 'feature', priority: 300, name: 'parent' });
      const plan = JSON.stringify({
        batches: [
          { name: 'unit-a', rationale: 'a slice', create: [{ target: 'a.ts' }], modify: [], delete: [] },
          { name: 'unit-b', rationale: 'b slice', create: [{ target: 'b.ts' }], modify: [], delete: [] },
        ],
      });
      processDiagnosticBatchSplit(state, plan, task);
      const subs = state.taskQueue.getAll().filter((t: any) => t.type === 'feature');
      const FORBIDDEN = /^(Fix: |Tests: |Add: |Update: |Remove: |Create create-|modify-|delete-|create-\d+|modify-\d+|delete-\d+)/;
      for (const s of subs) {
        expect((s as any).name).not.toMatch(FORBIDDEN);
      }
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
          { name: 'fix a', rationale: 'remediate a', modify: ['a.ts'] },
          { name: 'fix b', rationale: 'remediate b', modify: ['b.ts'] },
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
