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

  it('bundle publishes verify-shared dispatch slots (composeBundle wired)', () => {
    // Post verify-shared refactor: feature is wired through `composeBundle`
    // so the hook surface includes verify-mode dispatch wrappers for the
    // function-shaped slots (initSession / checkRetryTermination /
    // command.guard / check.evaluate / tool.onEvent /
    // router.routeAfterDone / orchestrator.hasOwnAttemptCounter). The
    // wrappers are no-ops for Tier 3+ feature tasks — `requiresVerification`
    // returns false and the wrapped hooks delegate to apply (which is
    // undefined for feature today). Tier 2 self-verify feature tasks pick
    // up verify-mode behaviour once `_verifyEntered === true`.
    //
    // Static slots (`buildPrompt` / `execute`) stay apply-mode only here —
    // the phase layer (planGeneration.ts / buildMessages.ts) dispatches
    // verify-mode by reading `_shared/verify/buildPrompt` and
    // `_shared/verify/executeHook` directly when `isVerifyEntered(state)`
    // is true. Forwarding apply only here keeps the "no override → generic
    // plan/execute base path" fallback intact for Tier 3+ feature tasks.
    expect(typeof featureBundle.plan?.initSession).toBe('function');
    expect(typeof featureBundle.plan?.checkRetryTermination).toBe('function');
    expect(typeof featureBundle.check?.evaluate).toBe('function');
    expect(typeof featureBundle.tool?.onEvent).toBe('function');
    expect(typeof featureBundle.command?.guard).toBe('function');
    expect(typeof featureBundle.router?.routeAfterDone).toBe('function');
    // Apply-only static slots remain undefined for feature (no apply
    // hook wired in tasks/feature/index.ts).
    expect(featureBundle.plan?.buildPrompt).toBeUndefined();
    expect(featureBundle.execute).toBeUndefined();
    // hasOwnAttemptCounter is now a function (task-instance-aware) —
    // returns false for ordinary feature tasks (no selfVerifyOnDone), true
    // only for Tier 2 self-verify feature tasks that own a verification cycle.
    expect(typeof featureBundle.orchestrator?.hasOwnAttemptCounter).toBe('function');
    const ordinaryFeature = task('f-plain') as any;
    expect((featureBundle.orchestrator?.hasOwnAttemptCounter as any)(ordinaryFeature)).toBe(false);
    const selfVerifyFeature = task('f-sv', { selfVerifyOnDone: true } as any) as any;
    expect((featureBundle.orchestrator?.hasOwnAttemptCounter as any)(selfVerifyFeature)).toBe(true);
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
