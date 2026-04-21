/**
 * L2 — `tasks/verification/hooks/*` adapter invariants.
 *
 * Locks the contract the hook layer promises to the phase layer (T6 callers)
 * and the orchestrator. Scope (post T11 follow-up review — `onEntry` /
 * `classifyEntry` / `shortCircuitAfterPlan` were retired as dead surface;
 * the phase layer calls `Session.onPlanEntry` / reads `_nextPlanEntry` /
 * short-circuits via `llmResponse.done` directly. Earlier T7/T8 follow-ups
 * removed `attachSnapshot` / `captureOnFailure` and `decideOutcome` /
 * `maybeSplit` / `makeTerminalError` on the same grounds):
 *
 *   - plan.initSession / plan.buildPrompt
 *   - check.evaluate       — session path
 *   - router.routeAfterDone
 *   - command.guard        — execute/plan-phase loop guards
 *   - tool.onEvent         — side-effect → session mutation
 *   - orchestrator.attemptCount / restoreIntoWorkerState
 *   - decompose.isExclusive + conversations.convKey
 *   - tasks/_shared/registry.ts — verification entry is the bundle
 */

import { describe, it, expect } from 'vitest';

import {
  VerificationSession,
} from '../../../src/agents/architect/graph/code/tasks/verification/model/Session';
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

/**
 * Build a minimal VerificationSessionSurface for command-guard tests. The
 * shape mirrors what `VerificationSession` publishes but lets each test
 * seed just the state it needs without rehydrating a full session.
 */
function mkSession(opts: {
  required?: Array<'typecheck' | 'build' | 'test'>;
  passed?: Array<'typecheck' | 'build' | 'test'>;
  attempted?: Array<'typecheck' | 'build' | 'test'>;
  deep?: boolean;
} = {}) {
  const required = new Set(opts.required ?? ['build']);
  const passed = new Set(opts.passed ?? []);
  const attempted = new Set(opts.attempted ?? []);
  const attemptLog: Array<'typecheck' | 'build' | 'test'> = [];
  return {
    required: () => [...required] as Array<'typecheck' | 'build' | 'test'>,
    missing: () => [...required].filter(g => !passed.has(g)) as Array<'typecheck' | 'build' | 'test'>,
    passed: () => [...passed] as Array<'typecheck' | 'build' | 'test'>,
    attemptedThisCycle: () => [...attempted] as Array<'typecheck' | 'build' | 'test'>,
    isComplete: () => [...required].every(g => passed.has(g)),
    dependencyStatus: () => 'unknown' as const,
    depHash: () => undefined,
    inDeepMode: () => opts.deep === true,
    markAttempted: (gate: 'typecheck' | 'build' | 'test') => {
      attemptLog.push(gate);
      attempted.add(gate);
    },
    // Test-only introspection of preemptive markAttempted calls.
    _markedAttempts: attemptLog,
  };
}

function mkCtx(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    fileSystem: {} as any,
    chatStatus: {} as any,
    workingDir: '/tmp',
    activePhase: 'plan',
    currentTaskType: 'verification',
    verificationSession: mkSession({ required: ['typecheck', 'build'] }),
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
    // T6b-β — plan.buildPrompt lands here so planGeneration.ts dispatches
    // the verification-variant render via the hook.
    expect(hooks?.plan?.buildPrompt).toBe(planHook.buildPrompt);
    expect(hooks?.plan?.toolLoopLogTemplate).toBe('jobs/code/nodes/plan/variants/verification/rules');
    expect(hooks?.tool?.onEvent).toBe(toolHook.onEvent);
    expect(hooks?.command?.guard).toBe(commandHook.guard);
    expect(hooks?.check?.evaluate).toBe(checkHook.evaluate);
    expect(hooks?.router?.routeAfterDone).toBe(routerHook.routeAfterDone);
    expect(hooks?.orchestrator?.hasOwnAttemptCounter).toBe(true);
    expect(hooks?.orchestrator?.attemptCount).toBe(orchHook.attemptCount);
    expect(hooks?.orchestrator?.restoreIntoWorkerState).toBe(orchHook.restoreIntoWorkerState);
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

// plan.initSession + plan.buildPrompt tests live below in dedicated
// describe blocks. Earlier `onEntry` / `classifyEntry` tests were
// removed in the T11 post-review along with the hook slots — the phase
// layer now calls `Session.onPlanEntry` / reads `_nextPlanEntry`
// directly from `nodes/plan/parts/entry.ts` (tests covering that path
// live in `tests/plan-entry-dispatcher.test.ts`).

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
    const session = VerificationSession.createFresh({ isTs: true, hasTests: false });
    for (let i = 0; i < 3; i++) session.onPlanEntry('retry'); // attempts=3 → deep mode
    session.markInstallNeeded(true);
    await planHook.buildPrompt({
      state: stateWith(session, {
        deps: { promptBuilder } as any,
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

  it('omits dependencyStatus when Session has no dep-hash observation yet', async () => {
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

  it('Session drives attempts / deep / dependency / cached-steps vars', async () => {
    // Session is the sole authority for verification prompt vars (T4b-β).
    // The test stages a session with a deep-mode attempt count, a
    // dependency change, and one gate re-passed after invalidation, and
    // checks the resulting prompt vars all come from those Session
    // observations.
    const session = VerificationSession.createFresh({ isTs: true, hasTests: true });
    for (let i = 0; i < 4; i++) session.onPlanEntry('retry'); // attempts=4, deep mode
    session.onFileChanged('all', true);                        // installNeeded=true, clears gates
    session.onCommand('typecheck', true);                     // typecheck re-passes

    const { promptBuilder, renderCalls } = makePromptBuilderStub();
    await planHook.buildPrompt({
      state: stateWith(session, {
        deps: { promptBuilder } as any,
      } as Partial<ArchitectGraphState>),
      task: task('v-ssot'),
      projectCodeContext: { files: [] },
      violationsText: undefined,
      uiDoc: undefined,
      remainingTasks: undefined,
    });

    const base = renderCalls.find(c => c.template === 'jobs/code/nodes/plan/variants/verification/base');
    expect(base?.vars.diagnosticAttempts).toBe(4);
    expect(base?.vars.isDeepDiagnostic).toBe(true);
    expect(base?.vars.dependencyStatus).toMatch(/have changed/);
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
        verificationSession: mkSession({
          required: ['typecheck', 'build'],
          passed: ['typecheck'],
        }),
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
      verificationSession: mkSession({
        required: ['typecheck', 'build'],
        attempted: ['typecheck', 'build'],
        deep: true,
      }),
    });
    // Build after failed typecheck is still ordered, but "already failed" block lifts.
    const res = commandHook.guard(ctx, { command: 'pnpm build' });
    expect(res).toBeNull();
  });

  it('guard — test requires buildPassed', () => {
    const res = commandHook.guard(
      mkCtx({ verificationSession: mkSession({ required: ['build', 'test'] }) }),
      { command: 'pnpm test' },
    );
    expect(res?.error).toContain('run the build command');
  });

  it('guard — marks typecheck/build/test as attempted on pass-through', () => {
    const session = mkSession({ required: ['typecheck'] });
    commandHook.guard(mkCtx({ verificationSession: session }), { command: 'tsc --noEmit' });
    expect((session as any)._markedAttempts).toContain('typecheck');
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

  it('evaluate — no session returns null (non-verification tasks)', () => {
    // Outside verification tasks `state.verification` is undefined and the
    // hook must decline to raise a violation — the check-task-status
    // layer is blind to task type and only consults the task-specific
    // hook, so `null` means "I have no objection".
    expect(checkHook.evaluate(stateWith(undefined))).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// router hook
// ────────────────────────────────────────────────────────────────────────────

describe('hooks/router', () => {
  // `shortCircuitAfterPlan` was retired in the T11 post-review as dead
  // surface — the plan node already flips `llmResponse.done = true` on
  // its own short-circuit paths (batch split, diagnostic pass, empty
  // implementation) so `routeAfterPlan` reads the flag directly and
  // never consults a task-type hook.

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
  it('hasOwnAttemptCounter is true', () => {
    expect(orchHook.hasOwnAttemptCounter).toBe(true);
  });

  it('attemptCount reads from resumeState.verification snapshot', () => {
    const t = task('t1', { resumeState: { verification: { attempts: 3 } as VerificationSnapshot } } as any);
    expect(orchHook.attemptCount(t)).toBe(3);
  });

  it('attemptCount — zero when no resume', () => {
    expect(orchHook.attemptCount(task('fresh'))).toBe(0);
  });

  it('attemptCount — zero when resumeState carries no verification snapshot', () => {
    // Pre-T4b this case would have fallen back to the legacy
    // `_verificationAttempts` field; post-T4b-β the snapshot is the sole
    // source and missing data reports zero.
    const t = task('t1', { resumeState: {} } as any);
    expect(orchHook.attemptCount(t)).toBe(0);
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
