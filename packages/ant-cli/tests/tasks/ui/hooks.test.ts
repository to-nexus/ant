/**
 * L2 — `tasks/ui/hooks/*` adapter invariants.
 *
 * Locks the contract for T6 call-site flips:
 *   - scheduling.preUiBarrier  — true (orchestrator gates ui while feature/setup runs)
 *   - scheduling.blocksTestgen — true (ui gates test-code so tests target built views)
 *   - conversations.convKey    — `node:execute:ui:<id>`
 *   - registry entry           — `hooksForTaskType('ui')` returns the bundle
 */

import { describe, it, expect } from 'vitest';

import { preUiBarrier, blocksTestgen } from '../../../src/agents/architect/graph/code/tasks/ui/hooks/scheduling';
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

  it('bundle publishes verify-mode router + parity-wrapped check (post Phase 4 SV parity)', () => {
    // composeBundle wires `router.routeAfterDone` AND `check.evaluate`
    // (Service Virtualization parity wrapper). The wrapper composes the
    // apply-phase check (undefined for ui today) with the parity tail;
    // parity self-gates on verify-mode entry + business connection
    // presence so apply-phase fire stays a no-op.
    expect(uiBundle.plan?.initSession).toBeUndefined();
    expect(typeof uiBundle.check?.evaluate).toBe('function');
    expect(uiBundle.tool?.onEvent).toBeUndefined();
    expect(uiBundle.command?.guard).toBeUndefined();
    expect(typeof uiBundle.router?.routeAfterDone).toBe('function');
    expect((uiBundle.orchestrator as any)?.hasOwnAttemptCounter).toBeUndefined();
    expect(uiBundle.plan?.buildPrompt).toBeUndefined();
    expect(uiBundle.execute).toBeUndefined();
    // ui has no decompose hook (no isExclusive override).
    expect(uiBundle.decompose).toBeUndefined();
  });

  it('scheduling: ui consumer flag + blocksTestgen producer only', () => {
    expect(uiBundle.scheduling?.preUiBarrier).toBe(true);
    expect(uiBundle.scheduling?.preTestgenBarrier).toBeUndefined();
    expect(uiBundle.scheduling?.preDocBarrier).toBeUndefined();
    expect(uiBundle.scheduling?.preIntegrationBarrier).toBeUndefined();
    // UI gates ONLY testgen — test-code waits until ui work finishes so
    // generated tests target fully-built views (alongside setup/feature).
    expect(uiBundle.scheduling?.blocksTestgen).toBe(true);
    // It must NOT activate any other barrier. Regression guard: adding a
    // producer flag here changes orchestrator scheduling semantics silently.
    // (No self-block on ui; doc reaches ui transitively via test-code;
    // integration is a feature-band concern.)
    expect(uiBundle.scheduling?.blocksUi).toBeUndefined();
    expect(uiBundle.scheduling?.blocksDoc).toBeUndefined();
    expect(uiBundle.scheduling?.blocksIntegration).toBeUndefined();
  });
});

describe('tasks/ui/hooks/scheduling', () => {
  it('preUiBarrier — true', () => {
    expect(preUiBarrier).toBe(true);
  });
  it('blocksTestgen — true', () => {
    expect(blocksTestgen).toBe(true);
  });
});

describe('tasks/ui/hooks/conversations', () => {
  it('convKey — task-id-scoped', () => {
    expect(convHook.convKey(task('u1'))).toBe('node:execute:ui:u1');
    expect(convHook.convKey(task('hero'))).toBe('node:execute:ui:hero');
  });
});
