/**
 * L2 — `tasks/verification/hooks/*` adapter invariants.
 *
 * Locks the contract the hook layer promises to the phase layer (T6 callers)
 * and the orchestrator. Scope matches the T5 handoff checklist:
 *
 *   - plan.decideOutcome   — every `VerificationOutcome.kind`
 *   - plan.maybeSplit      — force-split boundary + no-split passthrough
 *   - plan.makeTerminalError — typed VerificationTerminalError with snapshot
 *   - plan.onEntry / plan.classifyEntry
 *   - check.evaluate       — session path + legacy-tracker fallback
 *   - router.shortCircuitAfterPlan / routeAfterDone
 *   - command.guard        — execute/plan-phase loop guards
 *   - tool.onEvent         — side-effect → session mutation
 *   - orchestrator.attemptCount / attachSnapshot / restoreIntoWorkerState
 *   - decompose.isExclusive + conversations.convKey
 *   - tasks/_shared/registry.ts — verification entry is the bundle
 */

import { describe, it, expect } from 'vitest';

import {
  VerificationSession,
  MAX_VERIFICATION_ATTEMPTS,
} from '../../../src/agents/architect/graph/code/tasks/verification/model/Session';
import { VerificationTerminalError } from '../../../src/agents/architect/graph/code/tasks/verification/model/errors';
import type { VerificationSnapshot } from '../../../src/agents/architect/graph/code/tasks/verification/model/snapshot';

import * as planHook from '../../../src/agents/architect/graph/code/tasks/verification/hooks/plan';
import * as toolHook from '../../../src/agents/architect/graph/code/tasks/verification/hooks/tool';
import * as commandHook from '../../../src/agents/architect/graph/code/tasks/verification/hooks/command';
import * as checkHook from '../../../src/agents/architect/graph/code/tasks/verification/hooks/check';
import * as routerHook from '../../../src/agents/architect/graph/code/tasks/verification/hooks/router';
import * as orchHook from '../../../src/agents/architect/graph/code/tasks/verification/hooks/orchestrator';
import * as decompHook from '../../../src/agents/architect/graph/code/tasks/verification/hooks/decompose';
import * as convHook from '../../../src/agents/architect/graph/code/tasks/verification/hooks/conversations';

import { hooks as verificationBundle } from '../../../src/agents/architect/graph/code/tasks/verification';
import { hooksForTaskType } from '../../../src/agents/architect/graph/code/tasks/_shared/registry';

import type { ArchitectGraphState } from '../../../src/agents/architect/graph/code/state';
import type { CodeTask } from '../../../src/agents/architect/types/task';
import type {
  ToolExecutionEvent,
  ToolExecutionContext,
} from '../../../src/agents/common/tool/types';

// ────────────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────────────

function stateWith(session: VerificationSession | undefined, extras: Partial<ArchitectGraphState> = {}): ArchitectGraphState {
  return {
    ...(extras as ArchitectGraphState),
    verification: session,
  } as ArchitectGraphState;
}

function task(id: string, overrides: Partial<CodeTask> = {}): CodeTask {
  return {
    id,
    name: id,
    type: 'verification',
    priority: 1000,
    description: `task ${id}`,
    ...overrides,
  } as CodeTask;
}

function plan(opts: {
  modify?: number;
  batches?: number;
  totalErrors?: number;
  seed?: string;
}): string {
  const body: Record<string, unknown> = {
    implementation: {
      modify: Array.from({ length: opts.modify ?? 0 }, (_, i) => ({
        file: `src/${opts.seed ?? 'x'}-${i}.ts`,
        change: 'edit',
      })),
    },
    diagnostics: { totalErrors: opts.totalErrors ?? 0 },
  };
  if (opts.batches && opts.batches > 1) {
    (body as any).batches = Array.from({ length: opts.batches }, (_, i) => ({
      modify: [{ file: `src/batch-${i}.ts`, change: 'edit' }],
    }));
  }
  return JSON.stringify(body);
}

function mkCtx(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    fileSystem: {} as any,
    chatStatus: {} as any,
    workingDir: '/tmp',
    activePhase: 'plan',
    currentTaskType: 'verification',
    verificationTracker: {
      buildPassed: false,
      testPassed: false,
      testsRequired: false,
      typecheckRequired: true,
    },
    ...overrides,
  } as ToolExecutionContext;
}

// ────────────────────────────────────────────────────────────────────────────
// Registry wiring
// ────────────────────────────────────────────────────────────────────────────

describe('tasks/_shared/registry — verification entry', () => {
  it('returns the verification bundle', () => {
    const hooks = hooksForTaskType('verification');
    expect(hooks).toBe(verificationBundle);
    expect(hooks?.plan?.decideOutcome).toBe(planHook.decideOutcome);
    // T6b-β — plan.buildPrompt lands here so planGeneration.ts dispatches
    // the verification-variant render via the hook.
    expect(hooks?.plan?.buildPrompt).toBe(planHook.buildPrompt);
    expect(hooks?.plan?.toolLoopLogTemplate).toBe('jobs/code/nodes/plan/variants/verification/rules');
    expect(hooks?.tool?.onEvent).toBe(toolHook.onEvent);
    expect(hooks?.command?.guard).toBe(commandHook.guard);
    expect(hooks?.check?.evaluate).toBe(checkHook.evaluate);
    expect(hooks?.router?.shortCircuitAfterPlan).toBe(routerHook.shortCircuitAfterPlan);
    expect(hooks?.orchestrator?.hasOwnAttemptCounter).toBe(true);
    expect(hooks?.orchestrator?.captureOnFailure).toBe(true);
    expect(hooks?.decompose?.isExclusive).toBe(decompHook.isExclusive);
    expect(hooks?.conversations?.convKey).toBe(convHook.convKey);
  });

  it('explain task type remains placeholder', () => {
    // explain has no scheduling/conversation surface in code jobs; it is
    // intentionally left unwired until a concrete use case emerges.
    expect(hooksForTaskType('explain')).toEqual({});
  });
});

// ────────────────────────────────────────────────────────────────────────────
// plan hook
// ────────────────────────────────────────────────────────────────────────────

describe('hooks/plan', () => {
  it('onEntry forwards retry/reverify to Session (bumps attempts)', () => {
    const session = VerificationSession.createFresh({ isTs: true, hasTests: false });
    const state = stateWith(session);
    expect(session.attempts()).toBe(0);
    planHook.onEntry(state, 'retry');
    expect(session.attempts()).toBe(1);
    planHook.onEntry(state, 'reverify');
    expect(session.attempts()).toBe(2);
  });

  it('onEntry fresh/resumed/toolLoop are no-ops', () => {
    const session = VerificationSession.createFresh({ isTs: true, hasTests: false });
    planHook.onEntry(stateWith(session), 'fresh');
    planHook.onEntry(stateWith(session), 'resumed');
    planHook.onEntry(stateWith(session), 'toolLoop');
    expect(session.attempts()).toBe(0);
  });

  it('classifyEntry returns retry/reverify from _nextPlanEntry; null otherwise', () => {
    expect(planHook.classifyEntry(stateWith(undefined, { _nextPlanEntry: 'retry' }))).toBe('retry');
    expect(planHook.classifyEntry(stateWith(undefined, { _nextPlanEntry: 'reverify' }))).toBe('reverify');
    expect(planHook.classifyEntry(stateWith(undefined, { _nextPlanEntry: 'fresh' }))).toBeNull();
    expect(planHook.classifyEntry(stateWith(undefined))).toBeNull();
  });

  it('decideOutcome — continue when plan is modest and within budget', () => {
    const session = VerificationSession.createFresh({ isTs: true, hasTests: true });
    const outcome = planHook.decideOutcome(stateWith(session), plan({ modify: 1, totalErrors: 1 }));
    expect(outcome.kind).toBe('continue');
  });

  it('decideOutcome — short_circuit on already_complete', () => {
    const session = VerificationSession.createFresh({ isTs: false, hasTests: false });
    session.onCommand('build', true);
    const outcome = planHook.decideOutcome(stateWith(session), plan({ modify: 0 }));
    expect(outcome.kind).toBe('short_circuit');
  });

  it('decideOutcome — never returns force_split (that is maybeSplit\'s domain)', () => {
    // Handoff §6.2 boundary: decideOutcome sees only planText, so
    // `Session.evaluate` never receives parsed fan-out metadata and
    // therefore cannot surface a force_split verdict. The same plan that
    // would trigger force_split through maybeSplit (see below) must
    // resolve to `continue` here.
    const session = VerificationSession.createFresh({ isTs: true, hasTests: false });
    const outcome = planHook.decideOutcome(stateWith(session), plan({ modify: 5, totalErrors: 2 }));
    expect(outcome.kind).toBe('continue');
  });

  it('decideOutcome — terminal when budget is exhausted', () => {
    const session = VerificationSession.createFresh({ isTs: true, hasTests: false });
    for (let i = 0; i < MAX_VERIFICATION_ATTEMPTS; i++) session.onPlanEntry('retry');
    const outcome = planHook.decideOutcome(stateWith(session), plan({ modify: 1, totalErrors: 1 }));
    expect(outcome.kind).toBe('terminal');
    if (outcome.kind === 'terminal') {
      expect(outcome.errorKind).toBe('budget_exhausted');
    }
  });

  it('decideOutcome — returns continue when session missing', () => {
    const outcome = planHook.decideOutcome(stateWith(undefined), plan({ modify: 5 }));
    expect(outcome.kind).toBe('continue');
  });

  it('maybeSplit — returns envelope when outcome is force_split and bumps cycle counter', () => {
    const session = VerificationSession.createFresh({ isTs: true, hasTests: false });
    const before = session.batchSplitCount();
    const result = planHook.maybeSplit(
      stateWith(session),
      plan({ modify: 5, totalErrors: 2 }),
    );
    expect(result).not.toBeNull();
    expect(result?.reason).toBe('too_many_files');
    expect(session.batchSplitCount()).toBe(before + 1);
  });

  it('maybeSplit — returns null on continue outcome', () => {
    const session = VerificationSession.createFresh({ isTs: true, hasTests: false });
    const result = planHook.maybeSplit(stateWith(session), plan({ modify: 1, totalErrors: 1 }));
    expect(result).toBeNull();
  });

  it('makeTerminalError — typed error with snapshot', () => {
    const session = VerificationSession.createFresh({ isTs: true, hasTests: false });
    session.onPlanEntry('retry');
    const err = planHook.makeTerminalError(stateWith(session), {
      kind: 'terminal',
      errorKind: 'budget_exhausted',
      message: 'out of attempts',
    });
    expect(err).toBeInstanceOf(VerificationTerminalError);
    const typed = err as VerificationTerminalError;
    expect(typed.kind).toBe('budget_exhausted');
    expect(typed.message).toBe('out of attempts');
    expect(typed.carryOver?.attempts).toBe(1);
  });

  it('makeTerminalError — unknown errorKind falls back to unresolved_violations', () => {
    const err = planHook.makeTerminalError(stateWith(undefined), {
      kind: 'terminal',
      errorKind: 'not-a-kind',
      message: 'mystery',
    });
    expect((err as VerificationTerminalError).kind).toBe('unresolved_violations');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// plan.buildPrompt — verification variant (T6b-β)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Capturing mock for PromptBuilder. Records each `render` / `renderBasis`
 * invocation so assertions can inspect which template paths are requested
 * and what variables the hook forwards. Returns deterministic marker strings
 * so the composed prompt output is testable.
 */
function makePromptBuilderStub() {
  const renderCalls: Array<{ template: string; vars: Record<string, unknown> }> = [];
  const basisCalls: Array<{ basis: unknown; job: string; techTiers: unknown }> = [];
  const render = async (template: string, vars: Record<string, unknown>) => {
    renderCalls.push({ template, vars });
    if (template.endsWith('/base')) return `BODY:${template}`;
    if (template.endsWith('/hints')) return `HINT:${template}`;
    if (template.endsWith('/constraints')) return `CONSTRAINTS:${template}`;
    return `RENDERED:${template}`;
  };
  const renderBasis = async (basis: unknown, job: string, techTiers: unknown) => {
    basisCalls.push({ basis, job, techTiers });
    return basis ? 'BASIS_SECTION' : '';
  };
  return {
    promptBuilder: { render, renderBasis } as any,
    renderCalls,
    basisCalls,
  };
}

describe('hooks/plan.buildPrompt (verification variant)', () => {
  it('renders the verification base template and prepends basis when present', async () => {
    const { promptBuilder, renderCalls } = makePromptBuilderStub();
    const out = await planHook.buildPrompt({
      state: stateWith(undefined, {
        deps: { promptBuilder } as any,
        resolvedAction: { basis: { techTier: { stack: 'ts' } } } as any,
        directive: 'ship diagnostics',
      } as Partial<ArchitectGraphState>),
      task: task('v1'),
      projectCodeContext: { files: [{ path: 'src/a.ts' }] },
      violationsText: undefined,
      uiDoc: undefined,
      remainingTasks: undefined,
      options: { hasTools: true },
    });
    expect(out).toContain('BASIS_SECTION');
    expect(out).toContain('BODY:jobs/code/nodes/plan/variants/verification/base');

    const base = renderCalls.find(c => c.template === 'jobs/code/nodes/plan/variants/verification/base');
    expect(base).toBeDefined();
    expect(base?.vars.isErrorTask).toBe(false);
    expect(base?.vars.runTests).toBe(true);
    expect(base?.vars.hasTools).toBe(true);
  });

  it('forwards installNeeded=true into dependencyStatus and includes deep-diagnostic injections', async () => {
    const { promptBuilder, renderCalls } = makePromptBuilderStub();
    await planHook.buildPrompt({
      state: stateWith(undefined, {
        deps: { promptBuilder } as any,
        _installNeeded: true,
        _verificationAttempts: 3, // >= DEEP_DIAGNOSTIC_THRESHOLD → deep mode
      } as Partial<ArchitectGraphState>),
      task: task('v2'),
      projectCodeContext: { files: [] },
      violationsText: 'earlier failure',
      uiDoc: undefined,
      remainingTasks: undefined,
    });
    const base = renderCalls.find(c => c.template === 'jobs/code/nodes/plan/variants/verification/base');
    expect(base?.vars.dependencyStatus).toMatch(/Run the project's install command/);
    expect(base?.vars.isDeepDiagnostic).toBe(true);
    expect(base?.vars.diagnosticAttempts).toBe(3);
    expect(base?.vars.isRetry).toBe(true);
  });

  it('omits dependencyStatus when _installNeeded is undefined', async () => {
    const { promptBuilder, renderCalls } = makePromptBuilderStub();
    await planHook.buildPrompt({
      state: stateWith(undefined, { deps: { promptBuilder } as any } as Partial<ArchitectGraphState>),
      task: task('v3'),
      projectCodeContext: undefined,
      violationsText: undefined,
      uiDoc: undefined,
      remainingTasks: undefined,
    });
    const base = renderCalls.find(c => c.template === 'jobs/code/nodes/plan/variants/verification/base');
    expect(base?.vars.dependencyStatus).toBeUndefined();
    expect(base?.vars.isDeepDiagnostic).toBe(false);
  });

  it('throws when promptBuilder is unavailable', async () => {
    await expect(() =>
      planHook.buildPrompt({
        state: stateWith(undefined),
        task: task('v4'),
        projectCodeContext: undefined,
        violationsText: undefined,
        uiDoc: undefined,
        remainingTasks: undefined,
      }),
    ).rejects.toThrow(/PromptBuilder not available/);
  });

  it('Session takes precedence over legacy fields for attempts/deep/dependency/cached (SSOT guard)', async () => {
    // Locks in the coexistence policy: when state.verification is
    // populated the hook MUST read from it, never from the legacy
    // `_verificationAttempts` / `_installNeeded` / `_verificationTracker`
    // fields. The legacy state below is deliberately set to values that
    // would produce a visibly different prompt so a silent bypass would
    // fail this test.
    const session = VerificationSession.createFresh({ isTs: true, hasTests: true });
    for (let i = 0; i < 4; i++) session.onPlanEntry('retry'); // attempts=4, deep mode
    session.onFileChanged('all', true);                        // installNeeded=true, clears gates
    session.onCommand('typecheck', true);                     // 'typecheck' re-passes AFTER the invalidation

    const { promptBuilder, renderCalls } = makePromptBuilderStub();
    await planHook.buildPrompt({
      state: stateWith(session, {
        deps: { promptBuilder } as any,
        // Legacy state is deliberately inconsistent with Session — the
        // hook must ignore it.
        _verificationAttempts: 0,
        _installNeeded: false,
        _verificationTracker: { buildPassed: true, testPassed: true, testsRequired: false } as any,
      } as Partial<ArchitectGraphState>),
      task: task('v-ssot'),
      projectCodeContext: { files: [] },
      violationsText: undefined,
      uiDoc: undefined,
      remainingTasks: undefined,
    });

    const base = renderCalls.find(c => c.template === 'jobs/code/nodes/plan/variants/verification/base');
    expect(base?.vars.diagnosticAttempts).toBe(4);            // from Session, NOT legacy 0
    expect(base?.vars.isDeepDiagnostic).toBe(true);           // from Session.inDeepMode
    expect(base?.vars.dependencyStatus).toMatch(/have changed/); // from Session.dependencyStatus
    // cachedPassedSteps renders only gates Session.passed() reports —
    // typecheck. Legacy tracker's build/test passed flags must be ignored.
    expect(base?.vars.cachedPassedSteps).toContain('typecheck');
    expect(base?.vars.cachedPassedSteps).not.toContain('build');
    expect(base?.vars.cachedPassedSteps).not.toContain('test');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// tool hook
// ────────────────────────────────────────────────────────────────────────────

describe('hooks/tool', () => {
  const event = (sideEffects: any[]): ToolExecutionEvent => ({
    toolCallId: 'tc1',
    toolName: 'run_command',
    args: {},
    result: { content: '', sideEffects },
    cached: false,
  });

  it('onEvent — commandExecuted flips gate on success', () => {
    const session = VerificationSession.createFresh({ isTs: true, hasTests: false });
    toolHook.onEvent(stateWith(session), event([
      { type: 'commandExecuted', command: 'pnpm build', exitCode: 0, success: true, hasWarnings: false },
    ]));
    expect(session.passed()).toContain('build');
  });

  it('onEvent — policy-rejected command (exitCode -1) does not flip gate', () => {
    const session = VerificationSession.createFresh({ isTs: true, hasTests: false });
    toolHook.onEvent(stateWith(session), event([
      { type: 'commandExecuted', command: 'pnpm build', exitCode: -1, success: false, hasWarnings: false },
    ]));
    expect(session.passed()).not.toContain('build');
  });

  it('onEvent — verificationInvalidated clears gate', () => {
    const session = VerificationSession.createFresh({ isTs: true, hasTests: false });
    session.onCommand('build', true);
    toolHook.onEvent(stateWith(session), event([
      { type: 'verificationInvalidated', scope: 'all', reason: 'src/main.ts edited' },
    ]));
    expect(session.passed()).not.toContain('build');
  });

  it('onEvent — depFileHashChanged resolves install', () => {
    const session = VerificationSession.createFresh({ isTs: true, hasTests: false });
    session.onFileChanged('all', true);
    expect(session.installNeeded()).toBe(true);
    toolHook.onEvent(stateWith(session), event([
      { type: 'depFileHashChanged', newHash: 'deadbeef' },
    ]));
    expect(session.installNeeded()).toBe(false);
    expect(session.depHash()).toBe('deadbeef');
  });

  it('onEvent — no session is a no-op', () => {
    expect(() => toolHook.onEvent(stateWith(undefined), event([
      { type: 'commandExecuted', command: 'pnpm build', exitCode: 0, success: true, hasWarnings: false },
    ]))).not.toThrow();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// command hook
// ────────────────────────────────────────────────────────────────────────────

describe('hooks/command', () => {
  it('guard — diagnostic inspect always bypasses', () => {
    const res = commandHook.guard(mkCtx(), { command: 'cat package.json' });
    expect(res).toBeNull();
  });

  it('guard — execute-phase blocks build/test/typecheck', () => {
    const res = commandHook.guard(
      mkCtx({ activePhase: 'execute' }),
      { command: 'pnpm build' },
    );
    expect(res?.error).toContain('execute phase');
  });

  it('guard — plan-phase blocks already-passed typecheck', () => {
    const res = commandHook.guard(
      mkCtx({
        verificationTracker: { buildPassed: false, testPassed: false, testsRequired: false, typecheckPassed: true },
      }),
      { command: 'tsc --noEmit' },
    );
    expect(res?.error).toContain('ALREADY PASSED');
  });

  it('guard — plan-phase requires typecheck before build', () => {
    const res = commandHook.guard(
      mkCtx(),
      { command: 'pnpm build' },
    );
    expect(res?.error).toContain('Run tsc --noEmit first');
  });

  it('guard — deep-diagnostic relaxes failed-in-cycle block', () => {
    const ctx = mkCtx({
      isDeepDiagnostic: true,
      verificationTracker: { buildPassed: false, testPassed: false, testsRequired: false, typecheckRequired: true, typecheckAttempted: true, buildAttempted: true },
    });
    // Build after failed typecheck is still ordered, but "already failed" block lifts.
    const res = commandHook.guard(ctx, { command: 'pnpm build' });
    expect(res).toBeNull();
  });

  it('guard — test requires buildPassed', () => {
    const res = commandHook.guard(
      mkCtx({ verificationTracker: { buildPassed: false, testPassed: false, testsRequired: true } }),
      { command: 'pnpm test' },
    );
    expect(res?.error).toContain('run the build command');
  });

  it('guard — marks typecheck/build/test as attempted on pass-through', () => {
    const tracker: any = { buildPassed: false, testPassed: false, testsRequired: false, typecheckRequired: false };
    commandHook.guard(mkCtx({ verificationTracker: tracker }), { command: 'tsc --noEmit' });
    expect(tracker.typecheckAttempted).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// check hook
// ────────────────────────────────────────────────────────────────────────────

describe('hooks/check', () => {
  it('evaluate — returns null when session is complete', () => {
    const session = VerificationSession.createFresh({ isTs: false, hasTests: false });
    session.onCommand('build', true);
    const v = checkHook.evaluate(stateWith(session));
    expect(v).toBeNull();
  });

  it('evaluate — returns verification_incomplete violation when gate missing', () => {
    const session = VerificationSession.createFresh({ isTs: false, hasTests: false });
    const v = checkHook.evaluate(stateWith(session));
    expect(v?.type).toBe('verification_incomplete');
    expect(v?.severity).toBe('critical');
  });

  it('evaluate — legacy tracker fallback when session missing', () => {
    const v = checkHook.evaluate(stateWith(undefined, {
      _verificationTracker: { buildPassed: false, testPassed: false, testsRequired: false } as any,
    }));
    expect(v?.type).toBe('verification_incomplete');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// router hook
// ────────────────────────────────────────────────────────────────────────────

describe('hooks/router', () => {
  it('shortCircuitAfterPlan — true when session already complete', () => {
    const session = VerificationSession.createFresh({ isTs: false, hasTests: false });
    session.onCommand('build', true);
    expect(routerHook.shortCircuitAfterPlan(stateWith(session))).toBe(true);
  });

  it('shortCircuitAfterPlan — true when plan is empty', () => {
    expect(routerHook.shortCircuitAfterPlan(
      stateWith(undefined, { planText: JSON.stringify({ implementation: {} }) }),
    )).toBe(true);
  });

  it('shortCircuitAfterPlan — false when plan has modify entries', () => {
    expect(routerHook.shortCircuitAfterPlan(
      stateWith(undefined, { planText: plan({ modify: 1 }) }),
    )).toBe(false);
  });

  it('routeAfterDone — checkTaskStatus when plan is empty', () => {
    expect(routerHook.routeAfterDone(stateWith(undefined, { planText: '' }))).toBe('checkTaskStatus');
  });

  it('routeAfterDone — checkTaskStatus when no file changes were made', () => {
    expect(routerHook.routeAfterDone(stateWith(undefined, {
      planText: 'something',
      _executeModifiedFiles: false,
    }))).toBe('checkTaskStatus');
  });

  it('routeAfterDone — reverify path when changes applied and gates still missing', () => {
    const session = VerificationSession.createFresh({ isTs: true, hasTests: false });
    expect(routerHook.routeAfterDone(stateWith(session, {
      planText: 'something',
      _executeModifiedFiles: true,
    }))).toBe('plan');
  });

  it('routeAfterDone — checkTaskStatus when gates complete after execute', () => {
    const session = VerificationSession.createFresh({ isTs: false, hasTests: false });
    session.onCommand('build', true);
    expect(routerHook.routeAfterDone(stateWith(session, {
      planText: 'something',
      _executeModifiedFiles: true,
    }))).toBe('checkTaskStatus');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// orchestrator hook
// ────────────────────────────────────────────────────────────────────────────

describe('hooks/orchestrator', () => {
  it('hasOwnAttemptCounter + captureOnFailure are true', () => {
    expect(orchHook.hasOwnAttemptCounter).toBe(true);
    expect(orchHook.captureOnFailure).toBe(true);
  });

  it('attemptCount reads from resumeState.verification snapshot', () => {
    const t = task('t1', { resumeState: { verification: { attempts: 3 } as VerificationSnapshot } } as any);
    expect(orchHook.attemptCount(t)).toBe(3);
  });

  it('attemptCount falls back to legacy _verificationAttempts', () => {
    const t = task('t1', { resumeState: { _verificationAttempts: 5 } } as any);
    expect(orchHook.attemptCount(t)).toBe(5);
  });

  it('attemptCount — zero when no resume', () => {
    expect(orchHook.attemptCount(task('fresh'))).toBe(0);
  });

  it('attachSnapshot writes to task.resumeState.verification', () => {
    const t = task('t1');
    const snap: VerificationSnapshot = {
      required: ['build'],
      passed: [],
      attemptedThisCycle: [],
      attempts: 2,
      planHistoryHashes: [],
    };
    orchHook.attachSnapshot(t, snap);
    expect((t as any).resumeState.verification).toBe(snap);
  });

  it('restoreIntoWorkerState rehydrates session from snapshot', () => {
    const ws: Record<string, unknown> = {};
    orchHook.restoreIntoWorkerState(ws, {
      required: ['build', 'typecheck'],
      passed: ['typecheck'],
      attemptedThisCycle: [],
      attempts: 1,
      planHistoryHashes: [],
    });
    const session = ws.verification as VerificationSession;
    expect(session).toBeInstanceOf(VerificationSession);
    expect(session.attempts()).toBe(1);
    expect(session.passed()).toContain('typecheck');
  });

  it('restoreIntoWorkerState — ignores non-object resume', () => {
    const ws: Record<string, unknown> = {};
    orchHook.restoreIntoWorkerState(ws, undefined);
    expect(ws.verification).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// decompose + conversations
// ────────────────────────────────────────────────────────────────────────────

describe('hooks/decompose + conversations', () => {
  it('isExclusive — verification is always exclusive', () => {
    expect(decompHook.isExclusive(task('v1'))).toBe(true);
    expect(decompHook.isExclusive(task('v2', { priority: 100 } as any))).toBe(true);
  });

  it('convKey — task-id-scoped', () => {
    expect(convHook.convKey(task('v1'))).toBe('node:execute:verification:v1');
    expect(convHook.convKey(task('another-id'))).toBe('node:execute:verification:another-id');
  });
});
