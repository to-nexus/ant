/**
 * L2 — `tasks/verification/hooks/plan::initSession`
 *
 * Locks the idempotent population semantics introduced in T4b-α so the
 * plan-node fresh entry populates `state.verification` alongside (later:
 * instead of) the legacy `_verification*` fields.
 *
 * Coverage:
 *   1. Fresh state: creates a VerificationSession from env (isTs / hasTests).
 *   2. Idempotent: when `state.verification` already exists (rehydrated
 *      resume / worker restore) the call is a no-op and the existing
 *      instance is preserved.
 *   3. Env flags drive the Session's required-gate set (`createFresh`
 *      parity — build always required, typecheck iff isTs, test iff hasTests).
 *   4. Registered on the verification bundle + consumable via
 *      `hooksForTaskType('verification')`.
 *   5. Integration with `VerificationSession.fromLegacyState` — runner's
 *      scenario harness bridge produces a functionally equivalent session.
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

  it('is idempotent — subsequent calls preserve the existing session', () => {
    const state = blankState() as ArchitectGraphState;
    planHook.initSession(state, { isTs: true, hasTests: true });
    const first = state.verification;

    // Bump something mutable so we can detect instance replacement.
    state.verification!.onPlanEntry('retry');
    expect(state.verification!.attempts()).toBe(1);

    // Second call with a DIFFERENT env must still be a no-op when session
    // is already populated. This is the contract: callers cannot overwrite
    // a rehydrated session by accident.
    planHook.initSession(state, { isTs: false, hasTests: false });

    expect(state.verification).toBe(first);
    expect(state.verification!.attempts()).toBe(1);
    expect(state.verification!.required()).toContain('typecheck');
  });

  it('is wired on the verification bundle and registry', () => {
    expect(verificationBundle.plan?.initSession).toBe(planHook.initSession);

    const registryHooks = hooksForTaskType('verification');
    expect(registryHooks?.plan?.initSession).toBe(planHook.initSession);
  });

  it('VerificationSession.fromLegacyState reconstructs an equivalent session', () => {
    // Simulates a scenario seed authored pre-T4b-β: legacy fields only.
    // The bridge must yield the same observable state the plan node would
    // have derived on a fresh entry + subsequent events.
    const legacy = {
      _verificationTracker: {
        buildPassed: true,
        testPassed: false,
        testsRequired: true,
        typecheckPassed: true,
        typecheckAttempted: true,
        typecheckRequired: true,
        buildAttempted: true,
        testAttempted: false,
      },
      _verificationAttempts: 2,
      _appliedPlanHistory: ['{"implementation":{"modify":[{"file":"a.ts"}]}}'],
      _depFileHash: 'abcdef',
      _installNeeded: false,
    };
    const s = VerificationSession.fromLegacyState(legacy);

    expect(s.attempts()).toBe(2);
    expect(s.required().sort()).toEqual(['build', 'test', 'typecheck'].sort());
    expect(s.passed().sort()).toEqual(['build', 'typecheck'].sort());
    expect(s.depHash()).toBe('abcdef');
    expect(s.installNeeded()).toBe(false);
    // planHistoryBodies is exposed read-only via snapshot; hashes are
    // synthesised from bodies so `isPlanRepeated` still fires.
    const repeat = s.isPlanRepeated(legacy._appliedPlanHistory[0]);
    expect(repeat.repeated).toBe(true);
    expect(repeat.count).toBe(1);
  });
});
