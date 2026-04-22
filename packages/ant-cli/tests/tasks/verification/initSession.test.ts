/**
 * L2 — `tasks/verification/hooks/plan::initSession`
 *
 * Locks the merge-aware population semantics so the plan-node fresh entry
 * populates `state.verification` as the sole SSOT for verification cycle
 * state.
 *
 * Coverage:
 *   1. Fresh state: creates a VerificationSession from env (isTs / hasTests).
 *   2. Merge-aware: when `state.verification` exists with an empty required
 *      set (scenario seed carrying only attempts metadata), the hook
 *      hydrates the gate set from env while preserving attempts/history.
 *   3. Fully-populated session is left untouched (resume / rehydrate path
 *      is authoritative).
 *   4. Env flags drive the Session's required-gate set (`createFresh`
 *      parity — build always required, typecheck iff isTs, test iff hasTests).
 *   5. Registered on the verification bundle + consumable via
 *      `hooksForTaskType('verification')`.
 */

import { describe, it, expect } from 'vitest';

import { VerificationSession } from '../../../src/agents/architect/graph/code/tasks/verification/model/Session';
import * as planHook from '../../../src/agents/architect/graph/code/tasks/verification/hooks/plan';
import { hooks as verificationBundle } from '../../../src/agents/architect/graph/code/tasks/verification';
import { hooksForTaskType } from '../../../src/agents/architect/graph/code/tasks/_shared/registry';

import type { ArchitectGraphState } from '../../../src/agents/architect/graph/code/state';

function blankState(): Pick<ArchitectGraphState, 'verification'> {
  return { verification: undefined };
}

describe('verification.plan.initSession', () => {
  it('creates a fresh VerificationSession on first call', () => {
    const state = blankState() as ArchitectGraphState;
    planHook.initSession(state, { isTs: true, hasTests: true });

    expect(state.verification).toBeInstanceOf(VerificationSession);
    // isTs=true → typecheck required; hasTests=true → test required;
    // build is always required (createFresh invariant).
    expect(state.verification!.required().sort()).toEqual(
      ['build', 'test', 'typecheck'].sort(),
    );
    expect(state.verification!.attempts()).toBe(0);
    expect(state.verification!.passed()).toEqual([]);
  });

  it('produces the correct required-gate set for each env combination', () => {
    const cases: Array<{
      env: { isTs: boolean; hasTests: boolean };
      expected: string[];
    }> = [
      { env: { isTs: false, hasTests: false }, expected: ['build'] },
      { env: { isTs: true, hasTests: false }, expected: ['build', 'typecheck'] },
      { env: { isTs: false, hasTests: true }, expected: ['build', 'test'] },
      { env: { isTs: true, hasTests: true }, expected: ['build', 'test', 'typecheck'] },
    ];
    for (const { env, expected } of cases) {
      const state = blankState() as ArchitectGraphState;
      planHook.initSession(state, env);
      expect(state.verification!.required().sort()).toEqual(expected.sort());
    }
  });

  it('leaves a fully-populated session untouched', () => {
    const state = blankState() as ArchitectGraphState;
    planHook.initSession(state, { isTs: true, hasTests: true });
    const first = state.verification;

    state.verification!.onPlanEntry('retry');
    expect(state.verification!.attempts()).toBe(1);

    // Second call with a DIFFERENT env must not stomp the session: required
    // set is already populated, so the hydrate branch is a no-op.
    planHook.initSession(state, { isTs: false, hasTests: false });

    expect(state.verification).toBe(first);
    expect(state.verification!.attempts()).toBe(1);
    expect(state.verification!.required()).toContain('typecheck');
  });

  it('hydrates env onto a seeded partial session (empty required set)', () => {
    // Mirrors the scenario-seed shape used by S05: attempts is carried but
    // the gate set is intentionally empty so the plan-entry env probe fills
    // it in. The hook must preserve attempts / history while populating
    // required/passed from env.
    const partial = VerificationSession.rehydrate({
      required: [],
      passed: [],
      attempts: 3,
      planHistoryHashes: [],
    });
    const state = { verification: partial } as ArchitectGraphState;

    planHook.initSession(state, { isTs: true, hasTests: true });

    expect(state.verification).toBe(partial);
    expect(state.verification!.attempts()).toBe(3);
    expect(state.verification!.required().sort()).toEqual(
      ['build', 'test', 'typecheck'].sort(),
    );
    expect(state.verification!.passed()).toEqual([]);
  });

  it('is wired on the verification bundle and registry', () => {
    expect(verificationBundle.plan?.initSession).toBe(planHook.initSession);

    const registryHooks = hooksForTaskType('verification');
    expect(registryHooks?.plan?.initSession).toBe(planHook.initSession);
  });
});
