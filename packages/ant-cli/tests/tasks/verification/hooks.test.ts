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

import * as planBuildPrompt from '../../../src/agents/architect/graph/code/tasks/_shared/verify/prompt/buildPlanPrompt';
import * as routerHook from '../../../src/agents/architect/graph/code/tasks/_shared/verify/hooks/router';
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
    expect(typeof hooks?.scheduling?.classify).toBe('function');
  });

  it('scheduling.classify ⇒ isFinal — type-fixed (Three-Axis SSOT)', () => {
    // Verification is type-fixed: every verification task IS the final
    // verification task. The system has no "non-final verification" task
    // (see tasks/verification/model/is.ts). Classify ignores priority.
    const classify = verificationBundle.scheduling?.classify;
    expect(classify?.(task('final', { priority: 1000 }))).toEqual({ isFinal: true });
    expect(classify?.(task('beyond', { priority: 1500 }))).toEqual({ isFinal: true });
    expect(classify?.(task('alias', { priority: 999 }))).toEqual({ isFinal: true });
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
      antrulesContent: undefined,
      options: { hasTools: true },
    });
    expect(out.text).toContain('BASIS_SECTION');
    expect(out.text).toContain('BODY:jobs/code/nodes/plan/variants/verification/base');
    expect(out.vars).toBeDefined();
    expect(out.vars?.dependencyStatusKind).toBe('unknown');
    expect(out.vars?.hasViolationsText).toBe(false);

    const base = renderCalls.find(c => c.template === 'jobs/code/nodes/plan/variants/verification/base');
    expect(base).toBeDefined();
    // Plain non-error directive → runtime-error context flag stays false,
    // persistent processes remain disallowed. The legacy `isErrorTask`
    // template gate has been retired in favour of hasUserRuntimeErrorContext;
    // the `directive` prompt variable name itself is preserved (system-wide
    // standard naming used by every other render call).
    expect(base?.vars.hasUserRuntimeErrorContext).toBe(false);
    expect(base?.vars.allowPersistentProcesses).toBe(false);
    expect(base?.vars.directive).toBe('ship diagnostics');
    expect(base?.vars.isErrorTask).toBeUndefined();
    expect(base?.vars.runTests).toBe(true);
    expect(base?.vars.hasTools).toBe(true);
  });

  it('flips hasUserRuntimeErrorContext + allowPersistentProcesses when directive describes a runtime error', async () => {
    const { promptBuilder, renderCalls } = makePromptBuilderStub();
    const out = await planBuildPrompt.buildPrompt({
      state: makeState({
        deps: { promptBuilder } as any,
        directive: `Error: Cannot find module '@tailwindcss/postcss'`,
      }),
      task: task('v6'),
      codeContext: undefined,
      violationsText: undefined,
      uiDoc: undefined,
      remainingTasks: undefined,
      antrulesContent: undefined,
    });
    const base = renderCalls.find(c => c.template === 'jobs/code/nodes/plan/variants/verification/base');
    expect(base?.vars.hasUserRuntimeErrorContext).toBe(true);
    expect(base?.vars.allowPersistentProcesses).toBe(true);
    expect(base?.vars.directive).toContain('@tailwindcss/postcss');
    expect(out.vars?.hasUserRuntimeErrorContext).toBe(true);
  });

  it('flips hasUserRuntimeErrorContext when prior error sub-tasks are present even if directive is plain', async () => {
    const { promptBuilder, renderCalls } = makePromptBuilderStub();
    await planBuildPrompt.buildPrompt({
      state: makeState({
        deps: { promptBuilder } as any,
        directive: 'add a settings page',
        completedTasksDetails: [
          { id: 'e1', name: 'fix-x', type: 'error', priority: 100, description: 'fix import' },
        ] as any,
      }),
      task: task('v7'),
      codeContext: undefined,
      violationsText: undefined,
      uiDoc: undefined,
      remainingTasks: undefined,
      antrulesContent: undefined,
    });
    const base = renderCalls.find(c => c.template === 'jobs/code/nodes/plan/variants/verification/base');
    expect(base?.vars.hasUserRuntimeErrorContext).toBe(true);
    expect(base?.vars.allowPersistentProcesses).toBe(true);
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
      antrulesContent: undefined,
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
      antrulesContent: undefined,
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
      antrulesContent: undefined,
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
        antrulesContent: undefined,
      }),
    ).rejects.toThrow(/PromptBuilder not available/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// templates/jobs/code/nodes/plan/variants/verification/base
//   — `missing-test-entry` root-cause classification hint (Section C)
// ────────────────────────────────────────────────────────────────────────────

describe('plan/variants/verification/base — missing-test-entry classification hint', () => {
  // Defense for the brownfield safety net: when a test runner is
  // installed but the manifest is missing the test entry, the hint
  // routes the verification task through its existing error sub-task
  // mechanism (Section C of the test-code-script-wiring +
  // monorepo-install-locality plan) instead of burning a retry cycle
  // re-installing the dep that was already there.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const fs = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const path = require('path') as typeof import('path');
  const tplPath = path.join(
    __dirname,
    '../../../src/core/prompt/templates/jobs/code/nodes/plan/variants/verification/base.md',
  );

  it('carries the classification block (heading + table + remediation note)', () => {
    const text = fs.readFileSync(tplPath, 'utf8');
    expect(text).toMatch(/missing-test-entry/);
    expect(text).toMatch(/Probe before classifying/);
    // Three-row decision table — version probe disambiguates installed vs missing entry.
    expect(text).toMatch(/`--version` exits non-zero/);
    expect(text).toMatch(/`--version` exits 0, AND the failing command IS the project's test entry/);
  });

  it('points to the existing error sub-task path (no new task type)', () => {
    const text = fs.readFileSync(tplPath, 'utf8');
    // Reuse of error sub-task fan-out is the SSOT preservation guard —
    // if someone ever swaps this for a new task type, the assertion
    // below catches the divergence.
    expect(text).toMatch(/emit an error sub-task/);
    expect(text).toMatch(/dependency manifest/i);
  });

  it('carries the over-fire guard (other "Missing script" failures must NOT classify)', () => {
    const text = fs.readFileSync(tplPath, 'utf8');
    expect(text).toMatch(/Over-fire guard/);
    // The guard explicitly enumerates the bucket boundary so the LLM
    // does not generalise the classification to every "missing X".
    expect(text).toMatch(/failing command IS the project's test-run entry-point/);
  });

  it('block is anchored to Step 3 (Analyze Errors), not floating elsewhere', () => {
    const text = fs.readFileSync(tplPath, 'utf8');
    const stepIdx = text.search(/^### Step \{\{#if runTests\}\}3\{\{else\}\}2\{\{\/if\}\}: Analyze Errors/m);
    const planStepIdx = text.search(/^### Step \{\{#if runTests\}\}4\{\{else\}\}3\{\{\/if\}\}: Produce Remediation Plan/m);
    const classifierIdx = text.indexOf('missing-test-entry');
    expect(stepIdx).toBeGreaterThan(-1);
    expect(planStepIdx).toBeGreaterThan(-1);
    // Hint sits inside Step 3, before Step 4. If someone moves it
    // outside the Analyze-Errors step, this anchor breaks.
    expect(classifierIdx).toBeGreaterThan(stepIdx);
    expect(classifierIdx).toBeLessThan(planStepIdx);
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
