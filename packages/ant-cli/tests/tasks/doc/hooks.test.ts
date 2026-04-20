/**
 * L2 — `tasks/doc/hooks/*` adapter invariants.
 *
 * Locks the contract for T6 call-site flips:
 *   - scheduling.preDocBarrier  — true (block while `blocksDoc` producers
 *                                  setup / feature / test-code run)
 *   - conversations.convKey     — `node:execute:doc:<id>`
 *   - registry entry            — `hooksForTaskType('doc')` returns the bundle
 *
 * Doc is a barrier sink only: it consumes `preDocBarrier` and MUST NOT
 * publish any producer flag. In particular `blocksDoc=undefined` is a
 * deliberate regression guard — self-activation would make sibling doc
 * tasks block each other from parallel scheduling. The scheduling
 * assertions below lock this invariant at the slot level.
 */

import { describe, it, expect } from 'vitest';

import { preDocBarrier } from '../../../src/agents/architect/graph/code/tasks/doc/hooks/scheduling';
import * as convHook from '../../../src/agents/architect/graph/code/tasks/doc/hooks/conversations';
import { hooks as docBundle } from '../../../src/agents/architect/graph/code/tasks/doc';
import { hooksForTaskType } from '../../../src/agents/architect/graph/code/tasks/_shared/registry';

import type { CodeTask } from '../../../src/agents/architect/types/task';

function task(id: string, overrides: Partial<CodeTask> = {}): CodeTask {
  return {
    id,
    name: id,
    type: 'doc',
    priority: 450,
    description: `task ${id}`,
    ...overrides,
  } as CodeTask;
}

describe('tasks/_shared/registry — doc entry', () => {
  it('returns the doc bundle', () => {
    const hooks = hooksForTaskType('doc');
    expect(hooks).toBe(docBundle);
    expect(hooks?.scheduling?.preDocBarrier).toBe(true);
    expect(hooks?.conversations?.convKey).toBe(convHook.convKey);
  });

  it('bundle publishes only scheduling + conversations slots', () => {
    // Slot-level absence — mirrors the ui / test-code precedents so a
    // future drive-by hook addition forces an explicit test update
    // (and forces the author to justify it in index.ts).
    expect(docBundle.plan).toBeUndefined();
    expect(docBundle.decompose).toBeUndefined();
    expect(docBundle.check).toBeUndefined();
    expect(docBundle.tool).toBeUndefined();
    expect(docBundle.command).toBeUndefined();
    expect(docBundle.router).toBeUndefined();
    expect(docBundle.orchestrator).toBeUndefined();
  });

  it('scheduling exposes only the doc consumer flag — no other consumer or producer flags', () => {
    // Consumer flags: only preDocBarrier.
    expect(docBundle.scheduling?.preDocBarrier).toBe(true);
    expect(docBundle.scheduling?.preUiBarrier).toBeUndefined();
    expect(docBundle.scheduling?.preTestgenBarrier).toBeUndefined();
    expect(docBundle.scheduling?.preIntegrationBarrier).toBeUndefined();
    // Producer flags: ALL undefined. Doc is a barrier sink only; it
    // must NEVER activate a barrier for other task types. In particular
    // blocksDoc=undefined is a deliberate regression guard — a doc
    // task that produces the doc barrier would block sibling doc tasks
    // from parallel scheduling (self-blocking).
    expect(docBundle.scheduling?.blocksUi).toBeUndefined();
    expect(docBundle.scheduling?.blocksTestgen).toBeUndefined();
    expect(docBundle.scheduling?.blocksDoc).toBeUndefined();
    expect(docBundle.scheduling?.blocksIntegration).toBeUndefined();
  });
});

describe('tasks/doc/hooks/scheduling', () => {
  it('preDocBarrier — true', () => {
    expect(preDocBarrier).toBe(true);
  });
});

describe('tasks/doc/hooks/conversations', () => {
  it('convKey — task-id-scoped', () => {
    expect(convHook.convKey(task('d1'))).toBe('node:execute:doc:d1');
    expect(convHook.convKey(task('readme'))).toBe('node:execute:doc:readme');
  });
});
