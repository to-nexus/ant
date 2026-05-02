/**
 * L2 — `tasks/verification/*` adapter invariants (post plan §5.4 / §5.6).
 *
 * Locks the surviving hook surface:
 *   - plan.buildPrompt (verify-mode template, prior-error-tasks, banner)
 *   - router.routeAfterDone (empty-plan → checkTaskStatus, plan otherwise)
 *   - decompose.isExclusive + conversations.convKey
 *   - registry wiring
 */

import { describe, it, expect } from 'vitest';

import * as planBuildPrompt from '../../../src/agents/architect/graph/code/tasks/_shared/verify/buildPlanPrompt';
import * as routerHook from '../../../src/agents/architect/graph/code/tasks/_shared/verify/router';
import * as decompHook from '../../../src/agents/architect/graph/code/tasks/verification/hooks/decompose';
import * as convHook from '../../../src/agents/architect/graph/code/tasks/verification/hooks/conversations';

import { hooks as verificationBundle } from '../../../src/agents/architect/graph/code/tasks/verification';
import { hooksForTaskType } from '../../../src/agents/architect/graph/code/tasks/_shared/registry';

import type { ArchitectGraphState } from '../../../src/agents/architect/graph/code/state';
import type { CodeTask } from '../../../src/agents/architect/types/task';

// ────────────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────────────

function makeState(extras: Partial<ArchitectGraphState> = {}): ArchitectGraphState {
  return {
    ...(extras as ArchitectGraphState),
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

// ────────────────────────────────────────────────────────────────────────────
// Registry wiring
// ────────────────────────────────────────────────────────────────────────────

describe('tasks/_shared/registry — verification entry', () => {
  it('returns the verification bundle', () => {
    const hooks = hooksForTaskType('verification');
    expect(hooks).toBe(verificationBundle);
    expect(hooks?.plan?.buildPrompt).toBe(planBuildPrompt.buildPrompt);
    expect(hooks?.plan?.toolLoopLogTemplate).toBe('jobs/code/nodes/plan/variants/verification/rules');
    expect(hooks?.router?.routeAfterDone).toBe(routerHook.routeAfterDone);
    expect(hooks?.decompose?.isExclusive).toBe(decompHook.isExclusive);
    expect(hooks?.conversations?.convKey).toBe(convHook.convKey);
  });

  it('explain task type carries only R1 plan dispatch flags', () => {
    expect(hooksForTaskType('explain')).toEqual({
      plan: { requiresPlanText: false, usesToolLoop: false },
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// plan.buildPrompt
// ────────────────────────────────────────────────────────────────────────────

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
    const out = await planBuildPrompt.buildPrompt({
      state: makeState({
        deps: { promptBuilder } as any,
        resolvedAction: { basis: { techTier: { stack: 'ts' } } } as any,
        directive: 'ship diagnostics',
      }),
      task: task('v1'),
      codeContext: { files: [{ path: 'src/a.ts' }] },
      violationsText: undefined,
      uiDoc: undefined,
      remainingTasks: undefined,
      options: { hasTools: true },
    });
    expect(out.text).toContain('BASIS_SECTION');
    expect(out.text).toContain('BODY:jobs/code/nodes/plan/variants/verification/base');
    expect(out.vars).toBeDefined();
    expect(out.vars?.dependencyStatusKind).toBe('unknown');
    expect(out.vars?.hasViolationsText).toBe(false);

    const base = renderCalls.find(c => c.template === 'jobs/code/nodes/plan/variants/verification/base');
    expect(base).toBeDefined();
    expect(base?.vars.isErrorTask).toBe(false);
    expect(base?.vars.runTests).toBe(true);
    expect(base?.vars.hasTools).toBe(true);
  });

  it('forwards state._installNeededTransient=true into dependencyStatus', async () => {
    const { promptBuilder, renderCalls } = makePromptBuilderStub();
    const out = await planBuildPrompt.buildPrompt({
      state: makeState({
        deps: { promptBuilder } as any,
        _installNeededTransient: true,
      }),
      task: task('v2'),
      codeContext: { files: [] },
      violationsText: 'earlier failure',
      uiDoc: undefined,
      remainingTasks: undefined,
    });
    const base = renderCalls.find(c => c.template === 'jobs/code/nodes/plan/variants/verification/base');
    expect(base?.vars.dependencyStatus).toMatch(/missing from `node_modules`/);
    expect(base?.vars.isRetry).toBe(true);
    expect(out.vars?.dependencyStatusKind).toBe('changed');
    expect(out.vars?.hasViolationsText).toBe(true);
  });

  it('omits dependencyStatus when no install observation is present', async () => {
    const { promptBuilder, renderCalls } = makePromptBuilderStub();
    const out = await planBuildPrompt.buildPrompt({
      state: makeState({ deps: { promptBuilder } as any }),
      task: task('v3'),
      codeContext: undefined,
      violationsText: undefined,
      uiDoc: undefined,
      remainingTasks: undefined,
    });
    const base = renderCalls.find(c => c.template === 'jobs/code/nodes/plan/variants/verification/base');
    expect(base?.vars.dependencyStatus).toBeUndefined();
    expect(out.vars?.dependencyStatusKind).toBe('unknown');
  });

  it('renders task.batchSplitCount in the banner', async () => {
    const { promptBuilder, renderCalls } = makePromptBuilderStub();
    await planBuildPrompt.buildPrompt({
      state: makeState({ deps: { promptBuilder } as any }),
      task: task('v4', { batchSplitCount: 3 }),
      codeContext: undefined,
      violationsText: undefined,
      uiDoc: undefined,
      remainingTasks: undefined,
    });
    const base = renderCalls.find(c => c.template === 'jobs/code/nodes/plan/variants/verification/base');
    expect(base?.vars.sessionSummary).toMatch(/Prior batch-split cycles: 3/);
  });

  it('throws when promptBuilder is unavailable', async () => {
    await expect(() =>
      planBuildPrompt.buildPrompt({
        state: makeState(),
        task: task('v5'),
        codeContext: undefined,
        violationsText: undefined,
        uiDoc: undefined,
        remainingTasks: undefined,
      }),
    ).rejects.toThrow(/PromptBuilder not available/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// router.routeAfterDone
// ────────────────────────────────────────────────────────────────────────────

describe('hooks/router', () => {
  it('routeAfterDone — checkTaskStatus when planText is empty', () => {
    expect(routerHook.routeAfterDone(makeState({ planText: '' }))).toBe('checkTaskStatus');
  });

  it('routeAfterDone — plan when planText is non-empty', () => {
    expect(routerHook.routeAfterDone(makeState({
      planText: 'something',
      currentTask: task('v6'),
    }))).toBe('plan');
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
