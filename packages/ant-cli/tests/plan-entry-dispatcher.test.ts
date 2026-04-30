/**
 * L1 — `resolvePlanEntry` dispatcher invariants.
 *
 * Covers verification scenario matrix entries:
 *   - C14: verification fresh entry initialises `state.verification`
 *          (VerificationSession) via the plan hook.
 *   - C15: retry entry preserves already-passed gates and the required
 *          set while bumping `session.attempts()`. The retired
 *          `attemptedThisCycle` field is no longer a concern — `passed`
 *          is the single source for every command-policy guard.
 *
 * The dispatcher is a pure state transformer for these branches; this suite
 * exercises it directly without the full LangGraph harness.
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
    // Env probe in the test harness has no feature path → hasTests=false
    // and techTier is absent → isTs=false. Required therefore reduces to
    // the always-on `build` gate.
    expect(state.verification.required()).toEqual(['build']);
    expect(state.verification.passed()).toEqual([]);
    expect(state.verification.attempts()).toBe(0);
    // Session must surface in the delta so plan() return paths can commit
    // it via `mergeDelta` — without this, the channel keeps the pre-entry
    // (undefined) value when plan returns through tool_use / planText.
    expect(delta.verification).toBe(state.verification);
  });

  it('emits _planSearchWebCount: 0 in both delta (reducer commit) and state (same-turn read)', async () => {
    const state = makeFreshVerificationState();
    state._planSearchWebCount = 42;

    const { delta } = await resolvePlanEntry(state);
    // Counter resets are carried via:
    //   - delta: surfaces in plan()'s return-object via `mergeDelta` so
    //     the LangGraph reducer commits the reset to the channel.
    //   - state mutation: same-turn `plan()` body reads (RAG, LLM prompt
    //     composition, gate predicates) see the reset value before the
    //     reducer commit happens.
    expect(delta._planSearchWebCount).toBe(0);
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

    const { context: ctx, delta } = await resolvePlanEntry(state);

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

    // Violation clear flows through both surfaces:
    //   - delta.violations → mergeDelta → reducer commit
    //   - state.violations mutation → same-turn read by composeViolations
    //     Text / generatePlanText / runPlanRAG.extractFilesFromViolations.
    expect(delta.violations).toEqual([]);
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

    const { delta } = await resolvePlanEntry(state);

    // R2-P1: NODE_PLAN is reset at retry entry. The preserved-across-retry
    // policy documented earlier was never actually exercised — the retry
    // path's first plan-LLM call rebuilds the user message from scratch
    // and overwrites NODE_PLAN on the first round. Prior-attempt reasoning
    // now flows via (a) the Session-summary banner rendered in the
    // verification-variant plan template, and (b) LLM self-service
    // `read_file sessions/architect/code.json` when cascading failure
    // is suspected (see postmortem §4.1 / verification/rules.md).
    //
    // Mutation + delta contract:
    //   - delta carries the clears so `mergeDelta` propagates them to the
    //     LangGraph reducer (urban-fronting-faith Anthropic-400 fix).
    //   - mutation also clears `state.conversations` so the same plan()
    //     turn reads the reset value when running RAG / composing the
    //     plan-LLM prompt / gating tool-loop via `nodePlan.length`.
    //     Without the mutation, runMainPlanLLM would see a stale
    //     NODE_PLAN length ≥ PLAN_TOOL_LOOP_MAX and skip the diagnostic
    //     tool-loop entirely on the first retry plan-LLM call.
    expect(delta.conversations?.[CONV_KEYS.NODE_PLAN]).toEqual([]);
    expect(delta.conversations?.[CONV_KEYS.NODE_EXECUTE]).toEqual([]);
    expect(state.conversations[CONV_KEYS.NODE_PLAN]).toEqual([]);
    expect(state.conversations[CONV_KEYS.NODE_EXECUTE]).toEqual([]);
    expect(state.violations).toEqual([]);
    expect(state._executeCallIndex).toBe(0);
  });

  it('clears node:plan at fresh task entry (task boundary)', async () => {
    const state = makeFreshVerificationState();
    // Seed a prior conversation as if a previous task left chatter.
    state.conversations = {
      [CONV_KEYS.NODE_PLAN]: [{ role: 'user', content: 'stale from prior task' }],
      [CONV_KEYS.NODE_EXECUTE]: [{ role: 'user', content: 'stale' }],
    };

    const { delta } = await resolvePlanEntry(state);

    // Fresh task entry must wipe both conversation slots to isolate tasks.
    // Both `delta` (LangGraph reducer commit) and `state.conversations`
    // (same-turn read by plan() body) must reflect the clear.
    expect(delta.conversations?.[CONV_KEYS.NODE_PLAN]).toEqual([]);
    expect(delta.conversations?.[CONV_KEYS.NODE_EXECUTE]).toEqual([]);
    expect(state.conversations[CONV_KEYS.NODE_PLAN]).toEqual([]);
    expect(state.conversations[CONV_KEYS.NODE_EXECUTE]).toEqual([]);
  });
});
