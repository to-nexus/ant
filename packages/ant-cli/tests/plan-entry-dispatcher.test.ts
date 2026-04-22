/**
 * L1 — `resolvePlanEntry` dispatcher invariants.
 *
 * Covers verification scenario matrix entries:
 *   - C14: verification fresh entry initialises `state.verification`
 *          (VerificationSession) via the plan hook.
 *   - C15: retry entry clears per-cycle `attemptedThisCycle` while
 *          preserving already-passed gates and the required set.
 *
 * The dispatcher is a pure state transformer for these branches; this suite
 * exercises it directly without the full LangGraph harness.
 */

import { describe, it, expect, vi } from 'vitest';
import { __testing__ } from '../src/agents/architect/graph/code/nodes/plan';
import { VerificationSession } from '../src/agents/architect/graph/code/tasks/verification/model/Session';
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
    const ctx = await resolvePlanEntry(state);

    expect(ctx.nextTask.name).toBe('verify');
    expect(ctx.isRetry).toBe(false);
    expect(ctx.skipKeywordAndRAG).toBe(false);

    expect(state.verification).toBeInstanceOf(VerificationSession);
    // Env probe in the test harness has no feature path → hasTests=false
    // and techTier is absent → isTs=false. Required therefore reduces to
    // the always-on `build` gate.
    expect(state.verification.required()).toEqual(['build']);
    expect(state.verification.passed()).toEqual([]);
    expect(state.verification.attempts()).toBe(0);
  });

  it('resets _planSearchWebCount to 0', async () => {
    const state = makeFreshVerificationState();
    state._planSearchWebCount = 42;

    await resolvePlanEntry(state);
    expect(state._planSearchWebCount).toBe(0);
  });
});

describe('resolvePlanEntry — verification retry (C15)', () => {
  it('preserves passed + required gates and bumps session attempts', async () => {
    const state = makeFreshVerificationState();
    state.currentTask = {
      id: 't1',
      name: 'verify',
      description: 'Verification task',
      type: 'verification',
      priority: 1000,
    };
    state._nextPlanEntry = 'retry';
    // Seed a rehydrated session with two gates already passed — the retry
    // branch must preserve `passed` (gate cache is authoritative across
    // retry / reverify / batch-split boundaries). The retired
    // `attemptedThisCycle` field is intentionally absent from the seed;
    // rehydrate silently drops any legacy value.
    state.verification = VerificationSession.rehydrate({
      required: ['typecheck', 'build', 'test'],
      passed: ['typecheck', 'build'],
      attempts: 0,
      planHistoryHashes: [],
    });
    state.retries = 1;
    state.violations = [{ type: 'type_error' as any, severity: 'critical', message: 'x' }];
    state.planText = '{"task":{"id":"t1"},"diagnostics":{"totalErrors":1}}';

    const ctx = await resolvePlanEntry(state);

    expect(ctx.isRetry).toBe(true);

    // Verification delegates retry accounting to the Session via the
    // `checkRetryTermination` hook; the phase layer does NOT bump
    // `state.retries` for verification task types. The pre-entry value
    // (1) is preserved unchanged — the authoritative retry counter is
    // `session.attempts()`.
    expect(state.retries).toBe(1);

    const snap = state.verification.snapshot();
    // passed / required preserved
    expect(snap.passed.sort()).toEqual(['build', 'typecheck'].sort());
    expect(snap.required.sort()).toEqual(['build', 'test', 'typecheck'].sort());
    // attempts bumped via session.onPlanEntry('retry')
    expect(snap.attempts).toBe(1);

    expect(state.violations).toEqual([]);
  });

  it('resets both node:plan and node:execute at verification retry entry', async () => {
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
      required: ['build'],
      passed: [],
      attempts: 0,
      planHistoryHashes: [],
    });
    state.conversations = {
      [CONV_KEYS.NODE_PLAN]: [
        { role: 'user', content: 'prior plan round 1' },
        { role: 'assistant', content: 'prior diagnostic observation' },
      ],
      [CONV_KEYS.NODE_EXECUTE]: [
        { role: 'user', content: 'prior execute round 1' },
      ],
    };

    await resolvePlanEntry(state);

    // R2-P1: NODE_PLAN is reset at retry entry. The preserved-across-retry
    // policy documented earlier was never actually exercised — the retry
    // path's first plan-LLM call rebuilds the user message from scratch
    // and overwrites NODE_PLAN on the first round. Prior-attempt reasoning
    // now flows via (a) the Session-summary banner rendered in the
    // verification-variant plan template, and (b) LLM self-service
    // `read_file sessions/architect/code.json` when cascading failure
    // is suspected (see postmortem §4.1 / verification/rules.md).
    expect(state.conversations[CONV_KEYS.NODE_PLAN]).toEqual([]);
    // Execute tool-loop always restarts fresh.
    expect(state.conversations[CONV_KEYS.NODE_EXECUTE]).toEqual([]);
  });

  it('clears node:plan at fresh task entry (task boundary)', async () => {
    const state = makeFreshVerificationState();
    // Seed a prior conversation as if a previous task left chatter.
    state.conversations = {
      [CONV_KEYS.NODE_PLAN]: [{ role: 'user', content: 'stale from prior task' }],
      [CONV_KEYS.NODE_EXECUTE]: [{ role: 'user', content: 'stale' }],
    };

    await resolvePlanEntry(state);

    // Fresh task entry must wipe both conversation slots to isolate tasks.
    expect(state.conversations[CONV_KEYS.NODE_PLAN]).toEqual([]);
    expect(state.conversations[CONV_KEYS.NODE_EXECUTE]).toEqual([]);
  });
});
