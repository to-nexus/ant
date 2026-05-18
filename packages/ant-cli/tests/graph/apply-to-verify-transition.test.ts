/**
 * Regression — Tier-2 self-verify apply→verify transition.
 *
 * Reproduces the architectural defect from job `ultra-fusing-scone`:
 * `executeRouter` used to mutate `state._nextPlanEntry='reverify'` and
 * call `markVerifyEntered(state)` from inside the conditional-edge
 * function. LangGraph TS 1.0.1 reads conditional-edge state fresh from
 * channels (via `ChannelRead.doRead` with `fresh=true`) and discards
 * mutations made during routing, so the next plan-node entry never saw
 * the flag and `resolvePlanEntry` silently fell through to
 * `handleFreshTaskEntry` — clearing NODE_PLAN, logging a duplicate
 * `task_start`, and re-running the apply-mode plan prompt.
 *
 * This test fuses both function-level boundaries into one scenario:
 *
 *   1. State as committed by execute's return delta on the apply phase
 *      done-tick (`_activePhase:'execute'`, `llmResponse.done:true`,
 *      non-empty `planText`, `_verifyEntered:false`).
 *   2. `routeAfterExecute(state)` must route to `'plan'` and must NOT
 *      mutate `_nextPlanEntry` / `_verifyEntered` (purity contract).
 *   3. `resolvePlanEntry(state)` must detect the boundary from
 *      observable state and dispatch to `handleReverifyEntry`, which
 *      commits `_verifyEntered:true` and preserves NODE_PLAN.
 *
 * The test FAILS on the unfixed code: either the router would mutate
 * state (assertion 2 fails) or `resolvePlanEntry` would fall through to
 * `handleFreshTaskEntry` and clear NODE_PLAN (assertion 3 fails).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { routeAfterExecute } from '../../src/agents/architect/graph/code/routers/executeRouter';
import { __testing__ as planTesting } from '../../src/agents/architect/graph/code/nodes/plan';
import { CONV_KEYS } from '../../src/agents/common/graph/conversations';
import type { ArchitectGraphState } from '../../src/agents/architect/graph/code/state';

const { resolvePlanEntry } = planTesting;

function makeApplyDoneState(): ArchitectGraphState {
  // Mirror of the channel snapshot LangGraph would hand the next node
  // after execute returns `done:true` from a Tier-2 self-verify apply
  // phase. Every field is one that execute's `Partial<State>` return
  // already commits (or that survives from upstream commits).
  //
  // `workerId: 0` puts the dispatch in worker context so
  // `handleFreshTaskEntry` reuses `state.currentTask` instead of popping
  // from a queue (parity with the real parallel-orchestrator wiring; the
  // ultra-fusing-scone job ran in worker context).
  return {
    workerId: 0,
    currentTask: {
      id: 'sv-tier2',
      name: 'Mock 어댑터 선택 실패 수정',
      description: 'tier 2 self-verify error task',
      type: 'error',
      priority: 900,
      selfVerifyOnDone: true,
    } as any,
    _activePhase: 'execute',
    llmResponse: {
      done: true,
      thinking: '',
      textResponse: '',
      toolCalls: [],
    } as any,
    planText: 'apply-phase remediation plan body',
    _verifyEntered: false,
    _nextPlanEntry: undefined,
    conversations: {
      [CONV_KEYS.NODE_PLAN]: [
        { role: 'user', content: 'apply-phase plan round 1' } as any,
        { role: 'assistant', content: 'apply-phase plan reasoning' } as any,
      ],
      [CONV_KEYS.NODE_EXECUTE]: [
        { role: 'user', content: 'apply-phase execute' } as any,
        { role: 'assistant', content: '<done>true</done>' } as any,
      ],
    } as any,
    retries: 0,
    maxRetries: 3,
    recursionCount: 5,
    recursionLimit: 200,
    commandHistory: [],
    completedTasksDetails: [],
    _httpJobId: undefined,
    deps: {} as any,
    context: { featurePath: undefined, featureFolder: undefined } as any,
  } as any;
}

describe('apply→verify transition — Tier-2 self-verify (ultra-fusing-scone regression)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('routeAfterExecute routes to "plan" when execute emits done with a non-empty plan for a Tier-2 self-verify task', () => {
    const state = makeApplyDoneState();
    const next = routeAfterExecute(state);
    expect(next).toBe('plan');
  });

  it('routeAfterExecute is PURE — does not mutate _nextPlanEntry / _verifyEntered (architectural contract)', () => {
    // The prior implementation mutated `state._nextPlanEntry='reverify'`
    // and `state._verifyEntered=true` inside this conditional edge.
    // LangGraph TS reads conditional-edge state fresh from channels and
    // silently drops such mutations, so the next plan node never saw
    // them. The router is now pure; the apply→verify dispatch lives in
    // `resolvePlanEntry`/`handleReverifyEntry`.
    const state = makeApplyDoneState();
    const beforeNextPlanEntry = state._nextPlanEntry;
    const beforeVerifyEntered = state._verifyEntered;

    const next = routeAfterExecute(state);

    expect(next).toBe('plan');
    expect(state._nextPlanEntry).toBe(beforeNextPlanEntry);
    expect(state._verifyEntered).toBe(beforeVerifyEntered);
  });

  it('resolvePlanEntry on the post-route channel snapshot dispatches to reverify-entry and commits _verifyEntered:true', async () => {
    const state = makeApplyDoneState();

    // Sanity: the router decision matches what executeRouter would emit
    // for this state; we then exercise the next plan entry directly.
    expect(routeAfterExecute(state)).toBe('plan');

    const { context, delta } = await resolvePlanEntry(state);

    // Reverify-entry preserves the apply-phase task; no fresh-task pop.
    expect(context.nextTask.id).toBe('sv-tier2');

    // Verify-mode dispatch axis committed via the plan-node return delta.
    // This is the assertion that catches the original incident: under the
    // broken design, `_verifyEntered` stayed false here, leaving the
    // task in apply-mode for the next plan-execute cycle and producing
    // an infinite re-investigation loop.
    expect(delta._verifyEntered).toBe(true);
    expect(state._verifyEntered).toBe(true);

    // NODE_PLAN and NODE_EXECUTE are BOTH preserved on reverify entry so
    // `plan/index.ts` can spread them into the plan-LLM messages array
    // (via compactRun) as conversation history. Plan-finalize later clears
    // NODE_EXECUTE on its return to execute, so the next execute cycle still
    // starts fresh. Under the original (cool-mossing-jewel) bug,
    // `handleFreshTaskEntry` ran and cleared NODE_PLAN, severing the
    // apply-phase plan dialogue.
    expect(delta.conversations).toBeUndefined();
    expect(state.conversations[CONV_KEYS.NODE_PLAN]).toHaveLength(2);
    expect(state.conversations[CONV_KEYS.NODE_EXECUTE]).toHaveLength(2);
  });

  it('subsequent reverify cycles are idempotent — re-entering with _verifyEntered already true still commits _verifyEntered:true', async () => {
    // Cycle 2+ of a multi-cycle verify (verify plan emitted a fix plan,
    // execute applied it, now we re-enter plan for the next verify cycle).
    const state = makeApplyDoneState();
    state._verifyEntered = true;
    state.planText = 'cycle-2 fix plan body';

    const { delta } = await resolvePlanEntry(state);

    // Idempotent: the delta still commits `_verifyEntered:true` so the
    // reducer's last-write-wins behaviour keeps the channel stable. The
    // body mutation also remains true.
    expect(delta._verifyEntered).toBe(true);
    expect(state._verifyEntered).toBe(true);
  });

  it('Tier-3/4 verification task fall-through is unchanged — reverify cycles still go through handleFreshTaskEntry', async () => {
    // The observable-state predicate excludes `isVerificationTask(task)`
    // by design, so Tier-3/4 verification tasks continue to reset NODE_PLAN
    // each cycle via the fresh-entry path.
    const state = makeApplyDoneState();
    state.currentTask = {
      id: 'verif-tier34',
      name: 'verification cycle',
      description: 'tier 3 dedicated verification task',
      type: 'verification',
      priority: 1000,
    } as any;
    state._verifyEntered = true; // already in verify-mode from cycle 1

    const { delta } = await resolvePlanEntry(state);

    // Fresh entry path: NODE_PLAN cleared (Tier-3/4 each cycle is fresh).
    expect(delta.conversations?.[CONV_KEYS.NODE_PLAN]).toEqual([]);
    // _verifyEntered re-set by handleFreshTaskEntry's isVerificationTask
    // branch (idempotent — already true).
    expect(state._verifyEntered).toBe(true);
  });
});
