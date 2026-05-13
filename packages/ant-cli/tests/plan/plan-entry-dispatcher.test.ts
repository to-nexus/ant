/**
 * L1 — `resolvePlanEntry` dispatcher invariants.
 *
 * Post verification fix-책임 제거 리팩토링:
 *   - C14: verification fresh entry initialises `state.verification`
 *          (VerificationSession) via the plan hook.
 *   - Retry entry is uniform across all task types — bump `state.retries`,
 *     clear NODE_EXECUTE, preserve NODE_PLAN. Verification used to take a
 *     dedicated branch that reset NODE_PLAN and bumped `Session.attempts`;
 *     that branch was removed because verification never enters retry —
 *     every cycle ends in done:true (via explicit `batches[]` fan-out, the
 *     empty-impl shortcut, or `MAX_BATCH_SPLIT_CYCLES`).
 *   - Reverify entry retains its `isFirstVerifyEntry` NODE_PLAN reset for
 *     self-verify Tier 2's apply→verify transition (apply-phase plan
 *     messages would mix with the verify-mode prompt format otherwise).
 */

import { describe, it, expect, vi } from 'vitest';
import { __testing__ } from '../../src/agents/architect/graph/code/nodes/plan';
import { CONV_KEYS } from '../../src/agents/common/graph/conversations';

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

describe('resolvePlanEntry — fresh verification task', () => {
  it('pops the verification task from the queue and signals not-retry', async () => {
    const state = makeFreshVerificationState();
    const { context: ctx } = await resolvePlanEntry(state);

    expect(ctx.nextTask.name).toBe('verify');
    expect(ctx.isRetry).toBe(false);
    expect(ctx.skipKeywordAndRAG).toBe(false);
  });

  it('emits _planSearchWebCount: 0 in both delta (reducer commit) and state (same-turn read)', async () => {
    const state = makeFreshVerificationState();
    state._planSearchWebCount = 42;

    const { delta } = await resolvePlanEntry(state);
    expect(delta._planSearchWebCount).toBe(0);
    expect(state._planSearchWebCount).toBe(0);
  });

  it('flips _verifyEntered=true on first dedicated-verification fresh entry (regression: cleanup commit 4673ad7f dropped initSession without replacing the writer)', async () => {
    // Tier 3/4 dedicated verification task: must enter verify-mode at the
    // moment its plan node first runs, otherwise downstream readers
    // (`isVerifyModeActive`, the regression guards on `prePlanned` /
    // `resumeInterrupted` shortcuts, the `verifyModeActive` flag in tool
    // execution context) all see `false` for the entire verification
    // lifetime.
    const state = makeFreshVerificationState();
    state._verifyEntered = false;

    const { delta } = await resolvePlanEntry(state);

    expect(state._verifyEntered).toBe(true);
    expect(delta._verifyEntered).toBe(true);
  });

  it('does NOT flip _verifyEntered for non-verification fresh entry (apply-mode tasks stay in apply-mode)', async () => {
    const state = makeFreshVerificationState();
    state.taskQueue.pop = vi.fn(() => ({
      id: 'feat1',
      name: 'feature task',
      description: 'a feature',
      type: 'feature' as const,
      priority: 400,
    })) as any;
    state._verifyEntered = false;

    const { delta } = await resolvePlanEntry(state);

    expect(state._verifyEntered).toBe(false);
    expect(delta._verifyEntered).toBeUndefined();
  });

  it('does NOT flip _verifyEntered for Tier 2 self-verify fresh entry (apply-phase enters first; executeRouter <done> arm flips it later)', async () => {
    // selfVerifyOnDone tasks satisfy `requiresVerification(task)` but their
    // FIRST plan entry is in apply-mode. Only `isVerificationTask(task)`
    // (Tier 3/4) should auto-enter verify-mode here.
    const state = makeFreshVerificationState();
    state.taskQueue.pop = vi.fn(() => ({
      id: 'sv1',
      name: 'self-verify error',
      description: 'apply then verify',
      type: 'error' as const,
      priority: 100,
      selfVerifyOnDone: true,
    })) as any;
    state._verifyEntered = false;

    const { delta } = await resolvePlanEntry(state);

    expect(state._verifyEntered).toBe(false);
    expect(delta._verifyEntered).toBeUndefined();
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
    state.retries = 1;
    state.violations = [{ type: 'other', severity: 'critical', message: 'x' }];
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

  it('reverify entry preserves NODE_PLAN; only NODE_EXECUTE clears (Tier 2 self-verify)', async () => {
    // Apply-phase plan dialogue is preserved across the apply→verify
    // boundary so the LLM sees what it tried in conversation history;
    // only the per-cycle execute log is cleared.
    const state = makeFreshVerificationState();
    state.currentTask = {
      id: 'sv1',
      name: 'self-verify task',
      description: 'tier 2 self-verify',
      type: 'error',
      priority: 100,
      selfVerifyOnDone: true,
    } as any;
    state._nextPlanEntry = 'reverify';
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

    expect(delta.conversations?.[CONV_KEYS.NODE_PLAN]).toBeUndefined();
    expect(delta.conversations?.[CONV_KEYS.NODE_EXECUTE]).toEqual([]);
    expect(state.conversations[CONV_KEYS.NODE_PLAN]).toHaveLength(2);
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
