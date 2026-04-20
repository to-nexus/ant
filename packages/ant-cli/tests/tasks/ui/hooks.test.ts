/**
 * L2 — `tasks/ui/hooks/*` adapter invariants.
 *
 * Locks the contract for T6 call-site flips:
 *   - scheduling.preUiBarrier  — true (orchestrator gates ui while feature/setup runs)
 *   - conversations.convKey    — `node:execute:ui:<id>`
 *   - registry entry           — `hooksForTaskType('ui')` returns the bundle
 */

import { describe, it, expect } from 'vitest';

import { preUiBarrier } from '../../../src/agents/architect/graph/code/tasks/ui/hooks/scheduling';
import * as convHook from '../../../src/agents/architect/graph/code/tasks/ui/hooks/conversations';
import { hooks as uiBundle } from '../../../src/agents/architect/graph/code/tasks/ui';
import { hooksForTaskType } from '../../../src/agents/architect/graph/code/tasks/_shared/registry';

import type { CodeTask } from '../../../src/agents/architect/types/task';

function task(id: string, overrides: Partial<CodeTask> = {}): CodeTask {
  return {
    id,
    name: id,
    type: 'ui',
    priority: 500,
    description: `task ${id}`,
    ...overrides,
  } as CodeTask;
}

describe('tasks/_shared/registry — ui entry', () => {
  it('returns the ui bundle', () => {
    const hooks = hooksForTaskType('ui');
    expect(hooks).toBe(uiBundle);
    expect(hooks?.scheduling?.preUiBarrier).toBe(true);
    expect(hooks?.conversations?.convKey).toBe(convHook.convKey);
  });

  it('bundle publishes only scheduling + conversations', () => {
    expect(uiBundle.plan).toBeUndefined();
    expect(uiBundle.decompose).toBeUndefined();
    expect(uiBundle.check).toBeUndefined();
    expect(uiBundle.tool).toBeUndefined();
    expect(uiBundle.command).toBeUndefined();
    expect(uiBundle.router).toBeUndefined();
    expect(uiBundle.orchestrator).toBeUndefined();
  });

  it('scheduling exposes only the ui consumer flag — no other consumer or producer flags', () => {
    expect(uiBundle.scheduling?.preUiBarrier).toBe(true);
    expect(uiBundle.scheduling?.preTestgenBarrier).toBeUndefined();
    expect(uiBundle.scheduling?.preDocBarrier).toBeUndefined();
    expect(uiBundle.scheduling?.preIntegrationBarrier).toBeUndefined();
    // UI is a barrier sink only — it must NEVER activate barriers for
    // other task types. Regression guard: if someone adds a producer
    // flag here it changes orchestrator scheduling semantics silently.
    expect(uiBundle.scheduling?.blocksUi).toBeUndefined();
    expect(uiBundle.scheduling?.blocksTestgen).toBeUndefined();
    expect(uiBundle.scheduling?.blocksDoc).toBeUndefined();
    expect(uiBundle.scheduling?.blocksIntegration).toBeUndefined();
  });
});

describe('tasks/ui/hooks/scheduling', () => {
  it('preUiBarrier — true', () => {
    expect(preUiBarrier).toBe(true);
  });
});

describe('tasks/ui/hooks/conversations', () => {
  it('convKey — task-id-scoped', () => {
    expect(convHook.convKey(task('u1'))).toBe('node:execute:ui:u1');
    expect(convHook.convKey(task('hero'))).toBe('node:execute:ui:hero');
  });
});
