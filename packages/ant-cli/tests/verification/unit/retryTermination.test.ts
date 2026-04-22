/**
 * L1 — verification `checkRetryTermination` hook invariants.
 *
 * The hook is the sole verification retry terminator. It throws `no_progress`
 * when the just-failed plan matches the trailing plan-history streak; runaway
 * is bounded by `state.recursionLimit` at the routing layer.
 */

import { describe, it, expect } from 'vitest';
import { checkRetryTermination } from '../../../src/agents/architect/graph/code/tasks/verification/hooks/plan';
import { VerificationSession } from '../../../src/agents/architect/graph/code/tasks/verification/model/Session';
import { VerificationTerminalError } from '../../../src/agents/architect/graph/code/tasks/verification/model/errors';
import type { ArchitectGraphState } from '../../../src/agents/architect/graph/code/state';

function makeState(overrides: Partial<ArchitectGraphState> = {}): ArchitectGraphState {
  return {
    currentTask: { id: 'verification', name: 'Build Verification', type: 'verification' } as any,
    violations: [],
    retries: 0,
    maxRetries: 3,
    recursionCount: 0,
    recursionLimit: 200,
    ...overrides,
  } as ArchitectGraphState;
}

const PLAN_A = JSON.stringify({ implementation: { modify: [{ file: 'a.ts' }] } });
const PLAN_B = JSON.stringify({ implementation: { modify: [{ file: 'b.ts' }] } });

describe('checkRetryTermination', () => {
  it('returns null when plan history is empty (first retry)', () => {
    const session = VerificationSession.createFresh({ isTs: true, hasTests: false });
    const state = makeState({ verification: session, planText: PLAN_A });
    expect(checkRetryTermination(state)).toBeNull();
  });

  it('returns null when the same plan appears only once in history', () => {
    const session = VerificationSession.createFresh({ isTs: true, hasTests: false });
    session.onPlanApplied(PLAN_A);
    const state = makeState({ verification: session, planText: PLAN_A });
    expect(checkRetryTermination(state)).toBeNull();
  });

  it('throws no_progress when the same plan appears twice in a row', () => {
    const session = VerificationSession.createFresh({ isTs: true, hasTests: false });
    session.onPlanApplied(PLAN_A);
    session.onPlanApplied(PLAN_A);
    const state = makeState({ verification: session, planText: PLAN_A });
    const result = checkRetryTermination(state);
    expect(result).toBeInstanceOf(VerificationTerminalError);
    expect(result?.kind).toBe('no_progress');
    expect(result?.message).toContain('stuck');
    expect(result?.carryOver?.planHistoryHashes.length).toBe(2);
  });

  it('does not fire when history contains the same plan but the current one differs', () => {
    const session = VerificationSession.createFresh({ isTs: true, hasTests: false });
    session.onPlanApplied(PLAN_A);
    session.onPlanApplied(PLAN_A);
    const state = makeState({ verification: session, planText: PLAN_B });
    expect(checkRetryTermination(state)).toBeNull();
  });

  it('does not fire when repetition is broken (A, A, B, A)', () => {
    const session = VerificationSession.createFresh({ isTs: true, hasTests: false });
    session.onPlanApplied(PLAN_A);
    session.onPlanApplied(PLAN_A);
    session.onPlanApplied(PLAN_B);
    session.onPlanApplied(PLAN_A);
    const state = makeState({ verification: session, planText: PLAN_A });
    expect(checkRetryTermination(state)).toBeNull();
  });

  it('returns null when the session is missing', () => {
    const state = makeState({ verification: undefined, planText: PLAN_A });
    expect(checkRetryTermination(state)).toBeNull();
  });

  it('does not fire when planText is empty but the trailing history is a non-empty plan', () => {
    // Fresh empty cycle after two recorded non-empty plans: the empty
    // planText hash does not match PLAN_A's hash, so the streak counter
    // is zero and no termination fires.
    const session = VerificationSession.createFresh({ isTs: true, hasTests: false });
    session.onPlanApplied(PLAN_A);
    session.onPlanApplied(PLAN_A);
    const state = makeState({ verification: session, planText: '' });
    expect(checkRetryTermination(state)).toBeNull();
  });

  it('throws no_progress when two consecutive empty plans register as a repeated-hash streak', () => {
    // Silent give-up regression — prior to the empty-plan-guard removal
    // a `!state.planText` early-return in `checkRetryTermination` and a
    // matching guard in `onPlanApplied` made this pattern invisible.
    // Now empty planText hashes to a stable SHA-1 value and participates
    // in the normal repetition detector.
    const session = VerificationSession.createFresh({ isTs: true, hasTests: false });
    session.onPlanApplied('');
    session.onPlanApplied('');
    const state = makeState({ verification: session, planText: '' });
    const result = checkRetryTermination(state);
    expect(result).toBeInstanceOf(VerificationTerminalError);
    expect(result?.kind).toBe('no_progress');
    expect(result?.message).toContain('empty plan');
    expect(result?.carryOver?.planHistoryHashes.length).toBe(2);
  });
});
