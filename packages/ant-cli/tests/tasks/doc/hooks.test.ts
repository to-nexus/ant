/**
 * L2 — `tasks/doc/hooks/*` adapter invariants.
 *
 * Locks the contract for T6 call-site flips:
 *   - scheduling.preDocBarrier  — true (block while feature/setup/test-code runs)
 *   - conversations.convKey     — `node:execute:doc:<id>`
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

  it('bundle does NOT publish unrelated hooks', () => {
    expect(docBundle.plan).toBeUndefined();
    expect(docBundle.decompose).toBeUndefined();
    expect(docBundle.check).toBeUndefined();
    expect(docBundle.scheduling?.preTestgenBarrier).toBeUndefined();
    expect(docBundle.scheduling?.preUiBarrier).toBeUndefined();
    expect(docBundle.scheduling?.preIntegrationBarrier).toBeUndefined();
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
