/**
 * L2 — `tasks/error/hooks/*` adapter invariants.
 *
 * Locks the contract for T6 call-site flips:
 *   - decompose.isExclusive   — always true
 *   - conversations.convKey   — task-id-scoped, `node:execute:error:<id>`
 *   - model/is.isErrorTask    — narrow discriminator (no verification leak)
 *   - model/ErrorTaskData     — read accessor surfaces the four CodeTask fields
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
import {
  readErrorData,
  hasPrePlanText,
} from '../../../src/agents/architect/graph/code/tasks/error/model/ErrorTaskData';
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
    // plan.buildPrompt landed at T6b-β — error tasks render a dedicated
    // variant template (`jobs/code/nodes/plan/variants/error/base`).
    expect(hooks?.plan?.buildPrompt).toBe(planHook.buildPrompt);
    expect(hooks?.plan?.toolLoopLogTemplate).toBe('jobs/code/nodes/plan/variants/error/base');
    // T6b-η — error bundle publishes `command.guard` so the execute-phase
    // build/test/typecheck block lives in tasks/, matching the
    // "error applies fixes only" contract.
    expect(hooks?.command?.guard).toBe(commandHook.guard);
    // T6b-γ — error bundle publishes `orchestrator.onTaskComplete` so the
    // Final-Verification auto-add lives in tasks/, not graph.ts.
    expect(hooks?.orchestrator?.onTaskComplete).toBe(orchestratorHook.onTaskComplete);
  });

  it('bundle does not publish still-deferred hooks', () => {
    // `check` and `scheduling` stay unimplemented — error tasks are code-
    // fix only; build verification is deferred to the auto-enqueued Final
    // Verification task.
    expect(errorBundle.check).toBeUndefined();
    expect(errorBundle.scheduling).toBeUndefined();
    // Error tasks only override `buildPrompt` + logTemplate, not the
    // generic-path `extraTemplateVars`.
    expect(errorBundle.plan?.extraTemplateVars).toBeUndefined();
    // Orchestrator attempt-counter fields stay undefined — error tasks
    // share the orchestrator's shared `_failedAttempts` counter.
    expect(errorBundle.orchestrator?.hasOwnAttemptCounter).toBeUndefined();
    expect(errorBundle.orchestrator?.attemptCount).toBeUndefined();
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
    isDeepDiagnostic: false,
    fileSystem: undefined,
    chatStatus: undefined,
    workingDir: '/tmp',
  };
}

describe('tasks/error/hooks/command.guard', () => {
  it('blocks build commands in execute phase', () => {
    const result = commandHook.guard(guardCtx(), { command: 'npm run build' });
    expect(result?.error).toMatch(/BLOCKED/);
    expect(result?.error).toMatch(/remediation plan/);
  });

  it('blocks test commands in execute phase', () => {
    const result = commandHook.guard(guardCtx(), { command: 'pnpm test' });
    expect(result?.error).toMatch(/BLOCKED/);
  });

  it('blocks typecheck commands in execute phase', () => {
    const result = commandHook.guard(guardCtx(), { command: 'tsc --noEmit' });
    expect(result?.error).toMatch(/BLOCKED/);
  });

  it('allows install commands (error tasks may install deps to apply a fix)', () => {
    expect(commandHook.guard(guardCtx(), { command: 'pnpm add lodash' })).toBeNull();
    expect(commandHook.guard(guardCtx(), { command: 'npm install react' })).toBeNull();
  });

  it('allows read-only inspection commands', () => {
    expect(commandHook.guard(guardCtx(), { command: 'ls src/' })).toBeNull();
    expect(commandHook.guard(guardCtx(), { command: 'cat tsconfig.json' })).toBeNull();
    expect(commandHook.guard(guardCtx(), { command: 'pnpm why react' })).toBeNull();
  });

  it('does not block in plan phase (rare no-prePlanText path needs exploration)', () => {
    const ctx = guardCtx({ activePhase: 'plan' });
    expect(commandHook.guard(ctx, { command: 'npm run build' })).toBeNull();
    expect(commandHook.guard(ctx, { command: 'tsc --noEmit' })).toBeNull();
  });

  it('rejection carries a commandExecuted side-effect with exitCode -1', () => {
    const result = commandHook.guard(guardCtx(), { command: 'npm run build' });
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

  it('readErrorData — surfaces the four CodeTask fields', () => {
    const t = task('e1', {
      prePlanText: 'prebuilt plan body',
      errors: ['TS2307: cannot find module foo'],
      category: 'missing_import',
      remediationMode: 'patch',
    } as Partial<CodeTask>);
    expect(readErrorData(t)).toEqual({
      prePlanText: 'prebuilt plan body',
      errors: ['TS2307: cannot find module foo'],
      category: 'missing_import',
      remediationMode: 'patch',
    });
  });

  it('readErrorData — omits fields that are malformed on the task', () => {
    const t = task('e2', { errors: 'not-an-array' as unknown as string[], category: 123 as unknown as string });
    expect(readErrorData(t)).toEqual({
      prePlanText: undefined,
      errors: undefined,
      category: undefined,
      remediationMode: undefined,
    });
  });

  it('hasPrePlanText — true only for non-empty strings', () => {
    expect(hasPrePlanText(task('with', { prePlanText: 'body' }))).toBe(true);
    expect(hasPrePlanText(task('empty', { prePlanText: '' }))).toBe(false);
    expect(hasPrePlanText(task('none'))).toBe(false);
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
      projectCodeContext: { files: [{ path: 'src/a.ts' }] },
      violationsText: 'prior failure context',
      uiDoc: undefined,
      remainingTasks: undefined,
      options: { hasTools: false },
    });
    expect(out).toContain('BASIS_SECTION');
    expect(out).toContain('BODY:jobs/code/nodes/plan/variants/error/base');

    const base = renderCalls.find(c => c.template === 'jobs/code/nodes/plan/variants/error/base');
    expect(base).toBeDefined();
    expect(base?.vars.directive).toBe('resolve ts errors');
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
      projectCodeContext: undefined,
      violationsText: undefined,
      uiDoc: undefined,
      remainingTasks: undefined,
    });
    expect(out).not.toContain('BASIS_SECTION');
    expect(out).toContain('BODY:jobs/code/nodes/plan/variants/error/base');
  });

  it('throws when promptBuilder is unavailable', async () => {
    await expect(() =>
      planHook.buildPrompt({
        state: { deps: {} } as any,
        task: task('err3'),
        projectCodeContext: undefined,
        violationsText: undefined,
        uiDoc: undefined,
        remainingTasks: undefined,
      }),
    ).rejects.toThrow(/PromptBuilder not available/);
  });
});
