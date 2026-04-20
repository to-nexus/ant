/**
 * L2 — `tasks/design-system/hooks/*` adapter invariants.
 *
 * Design-system ordering is driven by priority-gated barriers
 * (hasPreAssetsWork / hasPreSpecWork) rather than a type-level barrier,
 * so the bundle intentionally publishes NO `scheduling.preXxxBarrier`
 * flags — only the conversation key.
 *
 * This test pins that design so the bundle cannot silently acquire a
 * type-level barrier without a corresponding orchestrator change.
 */

import { describe, it, expect } from 'vitest';

import * as convHook from '../../../src/agents/architect/graph/code/tasks/design-system/hooks/conversations';
import { hooks as dsBundle } from '../../../src/agents/architect/graph/code/tasks/design-system';
import { hooksForTaskType } from '../../../src/agents/architect/graph/code/tasks/_shared/registry';

import type { CodeTask } from '../../../src/agents/architect/types/task';

function task(id: string, overrides: Partial<CodeTask> = {}): CodeTask {
  return {
    id,
    name: id,
    type: 'design-system',
    priority: 150,
    description: `task ${id}`,
    ...overrides,
  } as CodeTask;
}

describe('tasks/_shared/registry — design-system entry', () => {
  it('returns the design-system bundle', () => {
    const hooks = hooksForTaskType('design-system');
    expect(hooks).toBe(dsBundle);
    expect(hooks?.conversations?.convKey).toBe(convHook.convKey);
  });

  it('bundle does NOT publish type-level scheduling barriers', () => {
    expect(dsBundle.scheduling).toBeUndefined();
    expect(dsBundle.plan).toBeUndefined();
    expect(dsBundle.decompose).toBeUndefined();
    expect(dsBundle.check).toBeUndefined();
  });
});

describe('tasks/design-system/hooks/conversations', () => {
  it('convKey — task-id-scoped', () => {
    expect(convHook.convKey(task('d1'))).toBe('node:execute:design-system:d1');
    expect(convHook.convKey(task('tokens'))).toBe('node:execute:design-system:tokens');
  });
});
