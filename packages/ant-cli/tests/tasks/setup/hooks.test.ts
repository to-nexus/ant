/**
 * L2 — `tasks/setup/hooks/*` adapter invariants.
 *
 * Locks the contract for T6 call-site flips:
 *   - decompose.isExclusive   — always true
 *   - conversations.convKey   — `node:execute:setup:<id>`
 *   - registry entry          — `hooksForTaskType('setup')` returns the bundle
 */

import { describe, it, expect } from 'vitest';

import * as decompHook from '../../../src/agents/architect/graph/code/tasks/setup/hooks/decompose';
import * as convHook from '../../../src/agents/architect/graph/code/tasks/setup/hooks/conversations';
import * as planHook from '../../../src/agents/architect/graph/code/tasks/setup/hooks/plan';
import { executeHook as setupExecuteHook } from '../../../src/agents/architect/graph/code/tasks/setup/hooks/execute';
import {
  blocksUi,
  blocksTestgen,
  blocksDoc,
} from '../../../src/agents/architect/graph/code/tasks/setup/hooks/scheduling';
import { hooks as setupBundle } from '../../../src/agents/architect/graph/code/tasks/setup';
import { hooksForTaskType } from '../../../src/agents/architect/graph/code/tasks/_shared/registry';

import type { CodeTask } from '../../../src/agents/architect/types/task';

function task(id: string, overrides: Partial<CodeTask> = {}): CodeTask {
  return {
    id,
    name: id,
    type: 'setup',
    priority: 10,
    description: `task ${id}`,
    ...overrides,
  } as CodeTask;
}

describe('tasks/_shared/registry — setup entry', () => {
  it('returns the setup bundle', () => {
    const hooks = hooksForTaskType('setup');
    expect(hooks).toBe(setupBundle);
    expect(hooks?.decompose?.isExclusive).toBe(decompHook.isExclusive);
    expect(hooks?.conversations?.convKey).toBe(convHook.convKey);
    // plan.extraTemplateVars landed at T6b-β — setup contributes
    // `setupConstraints` into the generic plan base render. Post
    // verify-shared refactor the bundle is wired through composeBundle
    // which forwards apply-phase extraTemplateVars unchanged.
    expect(hooks?.plan?.extraTemplateVars).toBe(planHook.extraTemplateVars);
    // Producer flags (T6b-ε): setup work activates ui / testgen / doc
    // barriers for downstream tasks. Setup does NOT block integration
    // (only feature work gates integration).
    expect(hooks?.scheduling?.blocksUi).toBe(true);
    expect(hooks?.scheduling?.blocksTestgen).toBe(true);
    expect(hooks?.scheduling?.blocksDoc).toBe(true);
    expect(hooks?.scheduling?.blocksIntegration).toBeUndefined();
    // T6b-ι — setup keeps the generic template but opts out of examples
    // (foundation work should not be steered by feature-style snippets).
    // composeBundle forwards `apply.execute` unchanged.
    expect(hooks?.execute).toBe(setupExecuteHook);
    expect(hooks?.execute?.skipExamples).toBe(true);
    expect(hooks?.execute?.templatePaths).toBeUndefined();
    expect(hooks?.execute?.skipCrossTaskContext).toBeUndefined();
  });

  it('bundle publishes verify-shared dispatch slots (composeBundle wired)', () => {
    // Post verify-shared refactor: setup bundles include verify-mode
    // dispatch wrappers for function-shaped slots. Tier 3+ setup tasks
    // fall through unchanged. Tier 2 self-verify setup tasks pick up
    // verify-mode behaviour after `_verifyEntered` flips. Static slots
    // stay apply-only.
    expect(typeof setupBundle.plan?.initSession).toBe('function');
    // Setup has no apply-phase buildPrompt override (it follows the
    // generic plan base path); composeBundle forwards undefined.
    expect(setupBundle.plan?.buildPrompt).toBeUndefined();
    // Setup has plan.extraTemplateVars from apply phase forwarded.
    expect(typeof setupBundle.plan?.extraTemplateVars).toBe('function');
    expect(typeof setupBundle.check?.evaluate).toBe('function');
    expect(typeof setupBundle.tool?.onEvent).toBe('function');
    expect(typeof setupBundle.command?.guard).toBe('function');
    expect(typeof setupBundle.router?.routeAfterDone).toBe('function');
    expect(typeof setupBundle.orchestrator?.hasOwnAttemptCounter).toBe('function');
    // Setup has no CONSUMER scheduling flags (it's foundation work and
    // gated only by the priority-based `hasPreFeatureWork` check).
    expect(setupBundle.scheduling?.preIntegrationBarrier).toBeUndefined();
    expect(setupBundle.scheduling?.preTestgenBarrier).toBeUndefined();
    expect(setupBundle.scheduling?.preDocBarrier).toBeUndefined();
    expect(setupBundle.scheduling?.preUiBarrier).toBeUndefined();
  });
});

describe('tasks/setup/hooks/scheduling', () => {
  it('producer flags — setup work activates ui / testgen / doc barriers', () => {
    expect(blocksUi).toBe(true);
    expect(blocksTestgen).toBe(true);
    expect(blocksDoc).toBe(true);
  });
});

describe('tasks/setup/hooks/decompose', () => {
  it('isExclusive — always true', () => {
    expect(decompHook.isExclusive(task('s1'))).toBe(true);
  });
});

describe('tasks/setup/hooks/conversations', () => {
  it('convKey — task-id-scoped', () => {
    expect(convHook.convKey(task('s1'))).toBe('node:execute:setup:s1');
    expect(convHook.convKey(task('bootstrap'))).toBe('node:execute:setup:bootstrap');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// plan.extraTemplateVars (T6b-β)
// ────────────────────────────────────────────────────────────────────────────

function makePromptBuilderStub() {
  const renderCalls: Array<{ template: string; vars: Record<string, unknown> }> = [];
  const render = async (template: string, vars: Record<string, unknown>) => {
    renderCalls.push({ template, vars });
    if (template.endsWith('/constraints')) return `CONSTRAINTS:${template}`;
    return `RENDERED:${template}`;
  };
  return {
    promptBuilder: { render } as any,
    renderCalls,
  };
}

describe('tasks/setup/hooks/plan.extraTemplateVars', () => {
  it('renders tech-tier-scoped setup constraints when task has a techTier language', async () => {
    const { promptBuilder, renderCalls } = makePromptBuilderStub();
    const vars = await planHook.extraTemplateVars({
      state: { deps: { promptBuilder } } as any,
      task: task('s1', { techTiers: [{ language: 'typescript' }] } as any),

      violationsText: undefined,
      uiDoc: undefined,
      remainingTasks: undefined,
    });
    expect(vars.hasSetupConstraints).toBe(true);
    expect(vars.setupConstraints).toBe('CONSTRAINTS:jobs/code/nodes/execute/basis/techTier/typescript/setup/constraints');
    expect(renderCalls.find(c => c.template.endsWith('/constraints'))).toBeDefined();
  });

  it('maps common languages to their partial folder', async () => {
    const { promptBuilder, renderCalls } = makePromptBuilderStub();
    await planHook.extraTemplateVars({
      state: { deps: { promptBuilder } } as any,
      task: task('s2', { techTiers: [{ language: 'Go' }] } as any),

      violationsText: undefined,
      uiDoc: undefined,
      remainingTasks: undefined,
    });
    expect(renderCalls[0].template).toContain('/techTier/go/setup/constraints');
  });

  it('returns empty object when techTier.language is missing', async () => {
    const { promptBuilder, renderCalls } = makePromptBuilderStub();
    const vars = await planHook.extraTemplateVars({
      state: { deps: { promptBuilder } } as any,
      task: task('s3', { techTiers: [] } as any),

      violationsText: undefined,
      uiDoc: undefined,
      remainingTasks: undefined,
    });
    expect(vars).toEqual({});
    expect(renderCalls).toHaveLength(0);
  });

  it('swallows render errors and reports hasSetupConstraints=false', async () => {
    const promptBuilder = {
      render: async () => {
        throw new Error('partial not found');
      },
    } as any;
    const vars = await planHook.extraTemplateVars({
      state: { deps: { promptBuilder } } as any,
      task: task('s4', { techTiers: [{ language: 'rust' }] } as any),

      violationsText: undefined,
      uiDoc: undefined,
      remainingTasks: undefined,
    });
    expect(vars.hasSetupConstraints).toBe(false);
    expect(vars.setupConstraints).toBe('');
  });

  it('returns empty object when promptBuilder is unavailable (defensive)', async () => {
    const vars = await planHook.extraTemplateVars({
      state: { deps: {} } as any,
      task: task('s5', { techTiers: [{ language: 'typescript' }] } as any),

      violationsText: undefined,
      uiDoc: undefined,
      remainingTasks: undefined,
    });
    expect(vars).toEqual({});
  });
});
