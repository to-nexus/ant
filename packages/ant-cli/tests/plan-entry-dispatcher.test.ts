/**
 * L1 — `resolvePlanEntry` dispatcher invariants.
 *
 * Post verification fix-책임 제거 리팩토링:
 *   - C14: verification fresh entry initialises `state.verification`
 *          (VerificationSession) via the plan hook.
 *   - Retry entry is uniform across all task types — bump `state.retries`,
 *     clear NODE_EXECUTE, preserve NODE_PLAN. Verification used to take a
 *     dedicated branch that reset NODE_PLAN and bumped `Session.attempts`;
 *     that branch was removed because verification never enters retry under
 *     always-fan-out (every cycle ends in done:true via batch-split, the
 *     empty-impl shortcut, or `MAX_BATCH_SPLIT_CYCLES`).
 *   - Reverify entry retains its `isFirstVerifyEntry` NODE_PLAN reset for
 *     self-verify Tier 2's apply→verify transition (apply-phase plan
 *     messages would mix with the verify-mode prompt format otherwise).
 */

import { describe, it, expect, vi } from 'vitest';
import { __testing__ } from '../src/agents/architect/graph/code/nodes/plan';
import { VerificationSession } from '../src/agents/architect/graph/code/tasks/_shared/verify/Session';
import { CONV_KEYS } from '../src/agents/common/graph/conversations';

const { resolvePlanEntry } = __testing__;

function makeFreshVerificationState() {
  const taskQueue = {
    pop: vi.fn(() => ({
      id: 't1',
      name: 'verify',
      description: 'Verification task',
      type: 'verification' as const,
      priority: 1000,
    })),
    getAll: vi.fn(() => []),
    size: vi.fn(() => 0),
    push: vi.fn(),
  };

  return {
    taskQueue,
    currentTask: undefined,
    retries: 0,
    maxRetries: 3,
    conversations: {},
    completedTasksDetails: [],
    _httpJobId: undefined,
    deps: {} as any,
    context: { featurePath: undefined, featureFolder: undefined } as any,
    recursionCount: 0,
    recursionLimit: 200,
  } as any;
}

describe('resolvePlanEntry — fresh verification task (C14)', () => {
  it('initialises the verification session via the plan hook', async () => {
    const state = makeFreshVerificationState();
    const { context: ctx, delta } = await resolvePlanEntry(state);

    expect(ctx.nextTask.name).toBe('verify');
    expect(ctx.isRetry).toBe(false);
    expect(ctx.skipKeywordAndRAG).toBe(false);

    expect(state.verification).toBeInstanceOf(VerificationSession);
    expect(state.verification.required()).toEqual(['build']);
    expect(state.verification.passed()).toEqual([]);
    expect(state.verification.attempts()).toBe(0);
    expect(delta.verification).toBe(state.verification);
  });

  it('emits _planSearchWebCount: 0 in both delta (reducer commit) and state (same-turn read)', async () => {
    const state = makeFreshVerificationState();
    state._planSearchWebCount = 42;

    const { delta } = await resolvePlanEntry(state);
    expect(delta._planSearchWebCount).toBe(0);
    expect(state._planSearchWebCount).toBe(0);
  });
});

describe('resolvePlanEntry — uniform retry path (verification + non-verification share one branch)', () => {
  it('verification + retry: bumps state.retries (no Session.attempts increment, no NODE_PLAN reset)', async () => {
    const state = makeFreshVerificationState();
    state.currentTask = {
      id: 't1',
      name: 'verify',
      description: 'Verification task',
      type: 'verification',
      priority: 1000,
    };
    state._nextPlanEntry = 'retry';
    state.verification = VerificationSession.rehydrate({
      required: ['typecheck', 'build', 'test'],
      passed: ['typecheck', 'build'],
      attempts: 0,
      planHistoryHashes: [],
    });
    state.retries = 1;
    state.violations = [{ type: 'type_error' as any, severity: 'critical', message: 'x' }];
    state.planText = '{"task":{"id":"t1"},"diagnostics":{"totalErrors":1}}';
    state.conversations = {
      [CONV_KEYS.NODE_PLAN]: [
        { role: 'user', content: 'prior plan round 1' },
        { role: 'assistant', content: 'prior diagnostic observation' },
      ],
      [CONV_KEYS.NODE_EXECUTE]: [
        { role: 'user', content: 'prior execute round 1' },
      ],
    };

    const { context: ctx, delta } = await resolvePlanEntry(state);

    expect(ctx.isRetry).toBe(true);

    // Verification now follows the uniform retry path: state.retries bumped.
    expect(state.retries).toBe(2);

    // Session preserved — attempts NOT bumped at retry entry (verification
    // doesn't reach retry under always-fan-out, but if it did the counter
    // semantics are state.retries not Session.attempts).
    const snap = state.verification.snapshot();
    expect(snap.passed.sort()).toEqual(['build', 'typecheck'].sort());
    expect(snap.required.sort()).toEqual(['build', 'test', 'typecheck'].sort());
    expect(snap.attempts).toBe(0);

    // NODE_EXECUTE cleared, NODE_PLAN PRESERVED (uniform branch behaviour).
    expect(delta.conversations?.[CONV_KEYS.NODE_EXECUTE]).toEqual([]);
    expect(delta.conversations?.[CONV_KEYS.NODE_PLAN]).toBeUndefined();
    expect(state.conversations[CONV_KEYS.NODE_EXECUTE]).toEqual([]);
    expect(state.conversations[CONV_KEYS.NODE_PLAN]).toHaveLength(2);

    // Violation clear flows through both surfaces.
    expect(delta.violations).toEqual([]);
    expect(state.violations).toEqual([]);
  });

  it('non-verification + retry: same uniform behaviour (NODE_PLAN preserved, NODE_EXECUTE cleared)', async () => {
    const state = makeFreshVerificationState();
    state.currentTask = {
      id: 'err1',
      name: 'fix',
      description: 'Error task',
      type: 'error',
      priority: 100,
    };
    state._nextPlanEntry = 'retry';
    state.retries = 0;
    state.conversations = {
      [CONV_KEYS.NODE_PLAN]: [{ role: 'user', content: 'plan history' }],
      [CONV_KEYS.NODE_EXECUTE]: [{ role: 'user', content: 'execute history' }],
    };

    const { delta } = await resolvePlanEntry(state);

    expect(state.retries).toBe(1);
    expect(delta.conversations?.[CONV_KEYS.NODE_EXECUTE]).toEqual([]);
    expect(delta.conversations?.[CONV_KEYS.NODE_PLAN]).toBeUndefined();
    expect(state.conversations[CONV_KEYS.NODE_PLAN]).toHaveLength(1);
  });

  it('resets _finalTaskLoopCount at retry entry (regression: urban-fronting-faith p2 ping-pong)', async () => {
    // Pre-`urban-fronting-faith` the verification retry branch reset
    // `_executeCallIndex` and conversations but NOT `_finalTaskLoopCount`.
    // Post-refactor every retry path is the same uniform branch, so the
    // reset must propagate through the unified path.
    const state = makeFreshVerificationState();
    state.currentTask = {
      id: 'err1',
      name: 'fix',
      description: 'Error task',
      type: 'error',
      priority: 100,
    };
    state._nextPlanEntry = 'retry';
    state._finalTaskLoopCount = 2;

    const { delta } = await resolvePlanEntry(state);

    expect(delta._finalTaskLoopCount).toBe(0);
    expect(state._finalTaskLoopCount).toBe(0);
  });

  it('resets _finalTaskLoopCount at reverify entry', async () => {
    // Reverify is the verification cycle's "post-execute re-diagnosis"
    // path. Tier 2 self-verify task at apply→verify transition.
    const state = makeFreshVerificationState();
    state.currentTask = {
      id: 't1',
      name: 'verify',
      description: 'Verification task',
      type: 'verification',
      priority: 1000,
    };
    state._nextPlanEntry = 'reverify';
    state.verification = VerificationSession.rehydrate({
      required: ['build'],
      passed: [],
      attempts: 0,
      planHistoryHashes: [],
    });
    state._finalTaskLoopCount = 2;

    const { delta } = await resolvePlanEntry(state);

    expect(delta._finalTaskLoopCount).toBe(0);
    expect(state._finalTaskLoopCount).toBe(0);
  });

  it('reverify entry: isFirstVerifyEntry=true (no Session yet) resets BOTH NODE_PLAN and NODE_EXECUTE', async () => {
    // Self-verify Tier 2 apply→verify boundary protection. Apply-phase
    // plan messages are in non-verify prompt format and would mix with
    // the verify-mode template if not reset on first verify entry.
    const state = makeFreshVerificationState();
    state.currentTask = {
      id: 'sv1',
      name: 'self-verify task',
      description: 'tier 2 self-verify',
      type: 'error', // self-verify tasks can be any type
      priority: 100,
      selfVerifyOnDone: true,
    } as any;
    state._nextPlanEntry = 'reverify';
    state.verification = undefined; // first verify entry — Session not yet created
    state.conversations = {
      [CONV_KEYS.NODE_PLAN]: [
        { role: 'user', content: 'apply-phase plan round 1' },
        { role: 'assistant', content: 'apply-phase tool result' },
      ],
      [CONV_KEYS.NODE_EXECUTE]: [
        { role: 'user', content: 'apply-phase execute' },
      ],
    };

    const { delta } = await resolvePlanEntry(state);

    expect(delta.conversations?.[CONV_KEYS.NODE_PLAN]).toEqual([]);
    expect(delta.conversations?.[CONV_KEYS.NODE_EXECUTE]).toEqual([]);
    expect(state.conversations[CONV_KEYS.NODE_PLAN]).toEqual([]);
    expect(state.conversations[CONV_KEYS.NODE_EXECUTE]).toEqual([]);
  });

  it('clears node:plan at fresh task entry (task boundary)', async () => {
    const state = makeFreshVerificationState();
    state.conversations = {
      [CONV_KEYS.NODE_PLAN]: [{ role: 'user', content: 'stale from prior task' }],
      [CONV_KEYS.NODE_EXECUTE]: [{ role: 'user', content: 'stale' }],
    };

    const { delta } = await resolvePlanEntry(state);

    expect(delta.conversations?.[CONV_KEYS.NODE_PLAN]).toEqual([]);
    expect(delta.conversations?.[CONV_KEYS.NODE_EXECUTE]).toEqual([]);
    expect(state.conversations[CONV_KEYS.NODE_PLAN]).toEqual([]);
    expect(state.conversations[CONV_KEYS.NODE_EXECUTE]).toEqual([]);
  });
});
