/**
 * L2 — `tasks/error/hooks/*` adapter invariants.
 *
 * Locks the contract for T6 call-site flips:
 *   - decompose.isExclusive   — always true
 *   - conversations.convKey   — task-id-scoped, `node:execute:error:<id>`
 *   - model/is.isErrorTask    — narrow discriminator (no verification leak)
 *   - registry entry          — `hooksForTaskType('error')` returns the bundle
 */

import { describe, it, expect } from 'vitest';

import * as decompHook from '../../../src/agents/architect/graph/code/tasks/error/hooks/decompose';
import * as convHook from '../../../src/agents/architect/graph/code/tasks/error/hooks/conversations';
import * as planHook from '../../../src/agents/architect/graph/code/tasks/error/hooks/plan';
import * as commandHook from '../../../src/agents/architect/graph/code/tasks/error/hooks/command';
import * as orchestratorHook from '../../../src/agents/architect/graph/code/tasks/error/hooks/orchestrator';
import { hooks as errorBundle } from '../../../src/agents/architect/graph/code/tasks/error';
import { isErrorTask } from '../../../src/agents/architect/graph/code/tasks/error/model/is';
import { hooksForTaskType } from '../../../src/agents/architect/graph/code/tasks/_shared/registry';
import { TASK_PRIORITIES } from '../../../src/agents/architect/graph/code/state';

import type { CodeTask } from '../../../src/agents/architect/types/task';
import type { TaskCompleteCtx } from '../../../src/agents/architect/graph/code/tasks/_shared/types';

function task(id: string, overrides: Partial<CodeTask> = {}): CodeTask {
  return {
    id,
    name: id,
    type: 'error',
    priority: 50,
    description: `task ${id}`,
    ...overrides,
  } as CodeTask;
}

describe('tasks/_shared/registry — error entry', () => {
  it('returns the error bundle (not the placeholder)', () => {
    const hooks = hooksForTaskType('error');
    expect(hooks).toBe(errorBundle);
    expect(hooks?.decompose?.isExclusive).toBe(decompHook.isExclusive);
    expect(hooks?.conversations?.convKey).toBe(convHook.convKey);
    // plan.buildPrompt landed at T6b-β. Post verify-shared refactor the
    // bundle is wired through `composeBundle` which forwards apply-phase
    // buildPrompt unchanged (verify-mode buildPrompt is dispatched by the
    // phase layer in planGeneration.ts directly via _shared/verify).
    expect(hooks?.plan?.buildPrompt).toBe(planHook.buildPrompt);
    expect(hooks?.plan?.toolLoopLogTemplate).toBe('jobs/code/nodes/plan/variants/error/base');
    // T6b-η — error bundle publishes `command.guard`. Post composeBundle
    // refactor the guard is wrapped with apply-vs-verify dispatch (the
    // wrapper delegates to apply's guard when `ctx.verificationSession` is
    // undefined, to `_shared/verify/commandGuard` otherwise).
    expect(typeof hooks?.command?.guard).toBe('function');
    // T6b-γ — error bundle publishes `orchestrator.onTaskComplete` so the
    // Final-Verification auto-add lives in tasks/, not graph.ts.
    expect(hooks?.orchestrator?.onTaskComplete).toBe(orchestratorHook.onTaskComplete);
  });

  it('bundle publishes verify-mode router dispatch + parity-wrapped check (post Phase 4 SV parity)', () => {
    // composeBundle wires `router.routeAfterDone` (verify-mode routing
    // for tasks that own a verification cycle) AND `check.evaluate` (the
    // Service Virtualization parity wrapper). The wrapper composes the
    // apply-phase check (undefined for error today) with the parity
    // tail; the parity tail self-gates on verify-mode entry + business
    // connection presence so apply-phase fire stays a no-op.
    expect(typeof errorBundle.router?.routeAfterDone).toBe('function');
    expect(typeof errorBundle.check?.evaluate).toBe('function');
    expect(errorBundle.tool?.onEvent).toBeUndefined();
    expect((errorBundle.orchestrator as any)?.hasOwnAttemptCounter).toBeUndefined();
    expect(errorBundle.scheduling).toBeUndefined();
    expect(errorBundle.check?.budgetExhaustedHint).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// command.guard — execute-phase build/test/typecheck block (T6b-η)
// ────────────────────────────────────────────────────────────────────────────

function guardCtx(opts: { activePhase?: 'plan' | 'execute' } = {}): any {
  return {
    activePhase: opts.activePhase ?? 'execute',
    currentTaskType: 'error',
    verificationSession: undefined,
    fileSystem: undefined,
    chatStatus: undefined,
    workingDir: '/tmp',
  };
}

describe('tasks/error/hooks/command.guard', () => {
  // Policy rejections carry their reason in `content` (prefixed with
  // `[Policy] ` so tool_result formatting does not mis-label them as
  // command execution failures) and omit `error` — see reject() in
  // error/hooks/command.ts. Gate identity is the LLM's `verifies`
  // declaration on the run_command call (see
  // `docs/tmp/gate-classification-postmortem.md`).
  it('blocks gate commands in execute phase (verifies declared)', () => {
    const result = commandHook.guard(guardCtx(), { command: 'npm run build', verifies: 'build' });
    expect(result?.content).toMatch(/\[Policy\]/);
    expect(result?.content).toMatch(/BLOCKED/);
    expect(result?.content).toMatch(/remediation plan/);
    expect(result?.error).toBeUndefined();
  });

  it('blocks every gate kind in execute phase when verifies is set', () => {
    expect(commandHook.guard(guardCtx(), { command: 'pnpm test', verifies: 'test' })?.content).toMatch(/BLOCKED/);
    expect(commandHook.guard(guardCtx(), { command: 'tsc --noEmit', verifies: 'typecheck' })?.content).toMatch(/BLOCKED/);
  });

  it('allows commands without verifies (non-gate work — installs, edits, inspections)', () => {
    // Error tasks routinely install deps to apply a remediation; they
    // also run inspection commands. Without `verifies`, the guard must
    // not block.
    expect(commandHook.guard(guardCtx(), { command: 'pnpm add lodash' })).toBeNull();
    expect(commandHook.guard(guardCtx(), { command: 'npm install react' })).toBeNull();
    expect(commandHook.guard(guardCtx(), { command: 'npm run build' })).toBeNull();
    expect(commandHook.guard(guardCtx(), { command: 'tsc --noEmit' })).toBeNull();
  });

  it('allows read-only inspection commands', () => {
    expect(commandHook.guard(guardCtx(), { command: 'ls src/' })).toBeNull();
    expect(commandHook.guard(guardCtx(), { command: 'cat tsconfig.json' })).toBeNull();
    expect(commandHook.guard(guardCtx(), { command: 'pnpm why react' })).toBeNull();
  });

  it('does not block in plan phase (rare no-prePlanText path needs exploration)', () => {
    const ctx = guardCtx({ activePhase: 'plan' });
    expect(commandHook.guard(ctx, { command: 'npm run build', verifies: 'build' })).toBeNull();
    expect(commandHook.guard(ctx, { command: 'tsc --noEmit', verifies: 'typecheck' })).toBeNull();
  });

  it('rejection carries a commandExecuted side-effect with exitCode -1', () => {
    const result = commandHook.guard(guardCtx(), { command: 'npm run build', verifies: 'build' });
    expect(result?.sideEffects).toEqual([
      expect.objectContaining({ type: 'commandExecuted', exitCode: -1, success: false }),
    ]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// orchestrator.onTaskComplete — Final Verification auto-add (T6b-γ)
// ────────────────────────────────────────────────────────────────────────────

function makeQueueStub() {
  const tasks: CodeTask[] = [];
  return {
    tasks,
    push: (t: CodeTask) => {
      tasks.push(t);
    },
  };
}

function baseCtx(overrides: Partial<TaskCompleteCtx> = {}): TaskCompleteCtx {
  const queue = makeQueueStub();
  return {
    task: task('err-complete'),
    taskQueue: queue,
    queueSnapshot: queue.tasks,
    runningSnapshot: [],
    completedSnapshot: [],
    resolvedAction: undefined,
    ...overrides,
  };
}

describe('tasks/error/hooks/orchestrator.onTaskComplete', () => {
  it('enqueues Final Verification when an error task completes with no final task in flight', () => {
    const queue = makeQueueStub();
    const ctx = baseCtx({ taskQueue: queue, queueSnapshot: queue.tasks });
    orchestratorHook.onTaskComplete(ctx);
    expect(queue.tasks).toHaveLength(1);
    expect(queue.tasks[0]).toMatchObject({
      type: 'verification',
      priority: TASK_PRIORITIES.FINAL_VERIFICATION,
      name: 'Final Verification (Recheck)',
    });
  });

  it('no-op when the completed task is not an error', () => {
    const queue = makeQueueStub();
    orchestratorHook.onTaskComplete(
      baseCtx({ task: task('v1', { type: 'verification' }), taskQueue: queue, queueSnapshot: queue.tasks }),
    );
    expect(queue.tasks).toHaveLength(0);
  });

  it('no-op when a Final Verification already sits in the queue', () => {
    const queue = makeQueueStub();
    queue.tasks.push(task('existing-final', {
      type: 'verification',
      priority: TASK_PRIORITIES.FINAL_VERIFICATION,
    }));
    orchestratorHook.onTaskComplete(
      baseCtx({ taskQueue: queue, queueSnapshot: queue.tasks }),
    );
    expect(queue.tasks).toHaveLength(1);
  });

  it('no-op when a Final Verification is already running (parallel)', () => {
    const queue = makeQueueStub();
    const running = [task('running-final', {
      type: 'verification',
      priority: TASK_PRIORITIES.FINAL_VERIFICATION,
    })];
    orchestratorHook.onTaskComplete(
      baseCtx({ taskQueue: queue, queueSnapshot: queue.tasks, runningSnapshot: running }),
    );
    expect(queue.tasks).toHaveLength(0);
  });

  it('no-op when a verification task has already completed (parallel)', () => {
    const queue = makeQueueStub();
    const completed = [task('prior-final', { type: 'verification', priority: TASK_PRIORITIES.FINAL_VERIFICATION })];
    orchestratorHook.onTaskComplete(
      baseCtx({ taskQueue: queue, queueSnapshot: queue.tasks, completedSnapshot: completed }),
    );
    expect(queue.tasks).toHaveLength(0);
  });

  it('seeds techTiers from resolvedAction.basis', () => {
    const queue = makeQueueStub();
    const resolvedAction = {
      basis: {
        techTier: {
          frontend: { stack: 'frontend', language: 'typescript', framework: 'react' } as any,
          backend: { stack: 'backend', language: 'typescript', framework: 'nestjs' } as any,
        },
      },
    } as any;
    orchestratorHook.onTaskComplete(
      baseCtx({ taskQueue: queue, queueSnapshot: queue.tasks, resolvedAction }),
    );
    expect(queue.tasks[0]?.techTiers).toHaveLength(2);
  });
});

describe('tasks/error/model', () => {
  it('isErrorTask — true only for type === "error"', () => {
    expect(isErrorTask({ type: 'error' })).toBe(true);
    expect(isErrorTask({ type: 'verification' })).toBe(false);
    expect(isErrorTask({ type: 'feature' })).toBe(false);
    expect(isErrorTask(undefined)).toBe(false);
  });
});

describe('tasks/error/hooks/decompose', () => {
  it('isExclusive — always true', () => {
    expect(decompHook.isExclusive(task('e1'))).toBe(true);
    expect(decompHook.isExclusive(task('e2', { priority: 999 }))).toBe(true);
  });
});

describe('tasks/error/hooks/conversations', () => {
  it('convKey — task-id-scoped', () => {
    expect(convHook.convKey(task('e1'))).toBe('node:execute:error:e1');
    expect(convHook.convKey(task('ts-2307'))).toBe('node:execute:error:ts-2307');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// plan.buildPrompt — error variant (T6b-β)
// ────────────────────────────────────────────────────────────────────────────

function makePromptBuilderStub() {
  const renderCalls: Array<{ template: string; vars: Record<string, unknown> }> = [];
  const basisCalls: Array<{ basis: unknown; job: string }> = [];
  const render = async (template: string, vars: Record<string, unknown>) => {
    renderCalls.push({ template, vars });
    if (template.endsWith('/base')) return `BODY:${template}`;
    if (template.endsWith('/hints')) return `HINT:${template}`;
    return `RENDERED:${template}`;
  };
  const renderBasis = async (basis: unknown, job: string) => {
    basisCalls.push({ basis, job });
    return basis ? 'BASIS_SECTION' : '';
  };
  return {
    promptBuilder: { render, renderBasis } as any,
    renderCalls,
    basisCalls,
  };
}

describe('tasks/error/hooks/plan.buildPrompt', () => {
  it('renders the error variant template and forwards resolvedAction + directive', async () => {
    const { promptBuilder, renderCalls } = makePromptBuilderStub();
    const state = {
      deps: { promptBuilder },
      directive: 'resolve ts errors',
      resolvedAction: { basis: { techTier: { stack: 'ts' } } },
      _detectedPackageManager: 'pnpm',
    } as any;
    const out = await planHook.buildPrompt({
      state,
      task: task('err1', { prePlanText: 'prebuilt', errors: ['TS2307'], category: 'missing_import', remediationMode: 'patch' } as any),
      codeContext: { files: [{ path: 'src/a.ts' }] },
      violationsText: 'prior failure context',
      uiDoc: undefined,
      remainingTasks: undefined,
      options: { hasTools: false },
    });
    expect(out.text).toContain('BASIS_SECTION');
    expect(out.text).toContain('BODY:jobs/code/nodes/plan/variants/error/base');
    // T6-결함4 — error hook publishes a minimal vars snapshot for logging.
    expect(out.vars?.hasPackageManager).toBe(true);
    expect(out.vars?.packageManager).toBe('pnpm');
    expect(out.vars?.hasViolationsText).toBe(true);

    const base = renderCalls.find(c => c.template === 'jobs/code/nodes/plan/variants/error/base');
    expect(base).toBeDefined();
    // The `directive` prompt variable name is the system-wide standard
    // (used by decompose, plan/base, plan/test-code, plan/direct,
    // design/detect, planner/plan, etc.). RC-B preserves it here.
    expect(base?.vars.directive).toBe('resolve ts errors');
    // RC-A SSOT: error tasks always permit persistent processes for
    // reproducer flows (the partial gates on this flag).
    expect(base?.vars.allowPersistentProcesses).toBe(true);
    expect(base?.vars.packageManager).toBe('pnpm');
    expect(base?.vars.hasPackageManager).toBe(true);
    expect(base?.vars.isRetry).toBe(true);
    expect(base?.vars.hasTools).toBe(false);
    expect(base?.vars.resolvedAction).toBe(state.resolvedAction);
  });

  it('skips basis section when no basis present', async () => {
    const { promptBuilder } = makePromptBuilderStub();
    const out = await planHook.buildPrompt({
      state: { deps: { promptBuilder } } as any,
      task: task('err2'),
      codeContext: undefined,
      violationsText: undefined,
      uiDoc: undefined,
      remainingTasks: undefined,
    });
    expect(out.text).not.toContain('BASIS_SECTION');
    expect(out.text).toContain('BODY:jobs/code/nodes/plan/variants/error/base');
    expect(out.vars?.hasViolationsText).toBe(false);
  });

  it('throws when promptBuilder is unavailable', async () => {
    await expect(() =>
      planHook.buildPrompt({
        state: { deps: {} } as any,
        task: task('err3'),
        codeContext: undefined,
        violationsText: undefined,
        uiDoc: undefined,
        remainingTasks: undefined,
      }),
    ).rejects.toThrow(/PromptBuilder not available/);
  });
});
