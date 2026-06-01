/**
 * L2 — `tasks/feature/hooks/*` adapter invariants.
 *
 * Feature is the only multi-task type that is NOT exclusive by
 * default: the test pins `isExclusive === false` for ordinary feature
 * tasks and documents the `priority === FINAL_VERIFICATION` fallback
 * (priority-1000 feature tasks are re-typed to `'verification'` at
 * normalisation in `responseParser.ts` L393–394, but the fallback
 * defends against accidental retyping regressions — the hook runs
 * BEFORE the retype at L383–385).
 *
 * Feature is also the "thickest" scheduling bundle — it publishes 1
 * consumer flag + 4 producer flags (5/8 of the TaskSchedulingHook
 * surface). The regression-guard section below pins every unpublished
 * flag to `undefined` so a future author cannot silently flip feature
 * into consuming a barrier it actually produces (self-blocking sibling
 * feature tasks).
 *
 * Locks the contract for T6 call-site flips:
 *   - scheduling.preIntegrationBarrier — true (consumer)
 *   - scheduling.blocksUi              — true (producer)
 *   - scheduling.blocksTestgen         — true (producer)
 *   - scheduling.blocksDoc             — true (producer)
 *   - scheduling.blocksIntegration     — true (producer, paired with
 *                                         the orchestrator's priority-
 *                                         window check)
 *   - decompose.isExclusive            — false for feature, true only
 *                                         for priority === FINAL_VERIFICATION
 *   - conversations.convKey            — `node:execute:feature:<id>`
 */

import { describe, it, expect } from 'vitest';

import {
  preIntegrationBarrier,
  blocksUi,
  blocksTestgen,
  blocksDoc,
  blocksIntegration,
  classify as schedClassify,
} from '../../../src/agents/architect/graph/code/tasks/feature/hooks/scheduling';
import * as decompHook from '../../../src/agents/architect/graph/code/tasks/feature/hooks/decompose';
import * as convHook from '../../../src/agents/architect/graph/code/tasks/feature/hooks/conversations';
import { hooks as featureBundle } from '../../../src/agents/architect/graph/code/tasks/feature';
import { hooksForTaskType } from '../../../src/agents/architect/graph/code/tasks/_shared/registry';
import { TASK_PRIORITIES } from '../../../src/agents/architect/graph/code/state';

import type { CodeTask } from '../../../src/agents/architect/types/task';

function task(id: string, overrides: Partial<CodeTask> = {}): CodeTask {
  return {
    id,
    name: id,
    type: 'feature',
    priority: 300,
    description: `task ${id}`,
    ...overrides,
  } as CodeTask;
}

describe('tasks/_shared/registry — feature entry', () => {
  it('returns the feature bundle', () => {
    const hooks = hooksForTaskType('feature');
    expect(hooks).toBe(featureBundle);
    // Consumer flag
    expect(hooks?.scheduling?.preIntegrationBarrier).toBe(true);
    // Producer flags (T6b-ε): feature work activates ui / testgen / doc /
    // integration barriers for downstream tasks.
    expect(hooks?.scheduling?.blocksUi).toBe(true);
    expect(hooks?.scheduling?.blocksTestgen).toBe(true);
    expect(hooks?.scheduling?.blocksDoc).toBe(true);
    expect(hooks?.scheduling?.blocksIntegration).toBe(true);
    expect(hooks?.decompose?.isExclusive).toBe(decompHook.isExclusive);
    expect(hooks?.conversations?.convKey).toBe(convHook.convKey);
  });

  it('bundle publishes only the verify-mode router + parity-wrapped check (post Phase 4 SV parity)', () => {
    // composeBundle wires `router.routeAfterDone` (verify-mode routing
    // for tasks that own a verification cycle) AND `check.evaluate` (the
    // Service Virtualization parity wrapper that fires only when verify-
    // mode is entered AND business connections exist; pure no-op
    // otherwise). Apply-phase check is undefined for feature so the
    // wrapper composes only the parity tail.
    expect(featureBundle.plan?.initSession).toBeUndefined();
    expect(featureBundle.plan?.checkRetryTermination).toBeUndefined();
    expect(typeof featureBundle.check?.evaluate).toBe('function');
    expect(featureBundle.tool?.onEvent).toBeUndefined();
    expect(featureBundle.command?.guard).toBeUndefined();
    expect(typeof featureBundle.router?.routeAfterDone).toBe('function');
    // Apply-only static slots remain undefined for feature (no apply
    // hook wired in tasks/feature/index.ts).
    expect(featureBundle.plan?.buildPrompt).toBeUndefined();
    expect(featureBundle.execute).toBeUndefined();
    // hasOwnAttemptCounter slot retired; verification responsibility holders
    // share the orchestrator's `_failedAttempts` axis.
    expect((featureBundle.orchestrator as any)?.hasOwnAttemptCounter).toBeUndefined();
  });

  it('scheduling exposes integration-consumer + 4 producer flags — no other consumer flags', () => {
    // Consumer flags: only preIntegrationBarrier.
    // feature does NOT consume the testgen / doc / ui barriers — it
    // PRODUCES them (see blocks* above). Self-activation would make
    // sibling feature tasks block each other from parallel scheduling.
    // Regression guard.
    expect(featureBundle.scheduling?.preIntegrationBarrier).toBe(true);
    expect(featureBundle.scheduling?.preTestgenBarrier).toBeUndefined();
    expect(featureBundle.scheduling?.preDocBarrier).toBeUndefined();
    expect(featureBundle.scheduling?.preUiBarrier).toBeUndefined();
    // Producer flags: all 4 true. blocksIntegration=true is paired
    // with the orchestrator priority-window check in
    // `isPreIntegrationWork` (FEATURE_CRITICAL ≤ priority <
    // INTEGRATION_MIN) so integration-priority feature tasks do not
    // self-block.
    expect(featureBundle.scheduling?.blocksUi).toBe(true);
    expect(featureBundle.scheduling?.blocksTestgen).toBe(true);
    expect(featureBundle.scheduling?.blocksDoc).toBe(true);
    expect(featureBundle.scheduling?.blocksIntegration).toBe(true);
    // classify — per-task priority-band role, wired through
    // `TaskOrchestrator.schedClassify` (R1 SSOT).
    expect(typeof featureBundle.scheduling?.classify).toBe('function');
  });
});

describe('tasks/feature/hooks/scheduling', () => {
  it('preIntegrationBarrier — true', () => {
    expect(preIntegrationBarrier).toBe(true);
  });

  it('producer flags — feature work activates ui / testgen / doc / integration barriers', () => {
    expect(blocksUi).toBe(true);
    expect(blocksTestgen).toBe(true);
    expect(blocksDoc).toBe(true);
    expect(blocksIntegration).toBe(true);
  });

  describe('classify — band-driven scheduling role (Three-Axis SSOT)', () => {
    it('band==="foundation" ⇒ isFoundation + expandedRagQuota', () => {
      expect(schedClassify(task('sf-foundation', { band: 'foundation' }))).toEqual({
        isFoundation: true,
        isPlatform: false,
        producesIntegrationGate: false,
        consumesIntegrationGate: false,
        expandedRagQuota: true,
      });
    });

    it('band==="platform" ⇒ isPlatform + expandedRagQuota (shared runtime services)', () => {
      // Platform runs after foundation, before ordinary feature consumers.
      // It activates the hasPrePlatformWork barrier (isPlatform) and gets
      // expanded RAG, but does NOT produce/consume the integration gate.
      expect(schedClassify(task('platform-session', { band: 'platform' }))).toEqual({
        isFoundation: false,
        isPlatform: true,
        producesIntegrationGate: false,
        consumesIntegrationGate: false,
        expandedRagQuota: true,
      });
    });

    it('band===undefined ⇒ producesIntegrationGate (normal feature)', () => {
      expect(schedClassify(task('feat-normal'))).toEqual({
        isFoundation: false,
        isPlatform: false,
        producesIntegrationGate: true,
        consumesIntegrationGate: false,
        expandedRagQuota: false,
      });
    });

    it('band==="integration" ⇒ consumesIntegrationGate + expandedRagQuota', () => {
      expect(schedClassify(task('int', { band: 'integration' }))).toEqual({
        isFoundation: false,
        isPlatform: false,
        producesIntegrationGate: false,
        consumesIntegrationGate: true,
        expandedRagQuota: true,
      });
    });

    it('priority is ignored — band is the SSOT', () => {
      // Pre-three-axis classify read priority directly. Now band drives
      // every flag; priority is the sort key only. A priority that used
      // to map to the foundation window (200) classifies as ordinary
      // feature work UNLESS band is explicitly set to 'foundation'.
      expect(schedClassify(task('sneaky-priority', { priority: 250 }))).toEqual({
        isFoundation: false,
        isPlatform: false,
        producesIntegrationGate: true,
        consumesIntegrationGate: false,
        expandedRagQuota: false,
      });
    });
  });
});

describe('tasks/feature/hooks/decompose', () => {
  it('isExclusive — false for ordinary feature tasks', () => {
    expect(decompHook.isExclusive(task('f1'))).toBe(false);
    expect(decompHook.isExclusive(task('integration-1', { priority: TASK_PRIORITIES.INTEGRATION_MIN }))).toBe(false);
  });

  it('isExclusive — true fallback when priority === FINAL_VERIFICATION', () => {
    // priority 1000 feature tasks are re-typed to 'verification' in responseParser.
    // This fallback defends against a regression of that retyping.
    expect(decompHook.isExclusive(task('final', { priority: TASK_PRIORITIES.FINAL_VERIFICATION }))).toBe(true);
  });
});

describe('tasks/feature/hooks/conversations', () => {
  it('convKey — task-id-scoped', () => {
    expect(convHook.convKey(task('f1'))).toBe('node:execute:feature:f1');
    expect(convHook.convKey(task('auth-login'))).toBe('node:execute:feature:auth-login');
  });
});
