/**
 * L2 — `tasks/feature/hooks/*` adapter invariants.
 *
 * Feature is the only task type that is NOT exclusive by default:
 * the test pins `isExclusive === false` for non-priority-1000 tasks and
 * documents the `priority === 1000` fallback (priority-1000 feature
 * tasks are re-typed to `'verification'` at normalisation, but the
 * fallback defends against accidental retyping regressions).
 *
 * Locks the contract for T6 call-site flips:
 *   - scheduling.preIntegrationBarrier — true
 *   - decompose.isExclusive            — false for feature, true only for FINAL_VERIFICATION
 *   - conversations.convKey            — `node:execute:feature:<id>`
 */

import { describe, it, expect } from 'vitest';

import {
  preIntegrationBarrier,
  blocksUi,
  blocksTestgen,
  blocksDoc,
  blocksIntegration,
} from '../../../src/agents/architect/graph/code/tasks/feature/hooks/scheduling';
import * as decompHook from '../../../src/agents/architect/graph/code/tasks/feature/hooks/decompose';
import * as convHook from '../../../src/agents/architect/graph/code/tasks/feature/hooks/conversations';
import { hooks as featureBundle } from '../../../src/agents/architect/graph/code/tasks/feature';
import { hooksForTaskType } from '../../../src/agents/architect/graph/code/tasks/_shared/registry';
import { TASK_PRIORITIES } from '../../../src/agents/architect/graph/code/state';

import type { CodeTask } from '../../../src/agents/architect/types/task';

function task(id: string, overrides: Partial<CodeTask> = {}): CodeTask {
  return {
    id,
    name: id,
    type: 'feature',
    priority: 300,
    description: `task ${id}`,
    ...overrides,
  } as CodeTask;
}

describe('tasks/_shared/registry — feature entry', () => {
  it('returns the feature bundle', () => {
    const hooks = hooksForTaskType('feature');
    expect(hooks).toBe(featureBundle);
    // Consumer flag
    expect(hooks?.scheduling?.preIntegrationBarrier).toBe(true);
    // Producer flags (T6b-ε): feature work activates ui / testgen / doc /
    // integration barriers for downstream tasks.
    expect(hooks?.scheduling?.blocksUi).toBe(true);
    expect(hooks?.scheduling?.blocksTestgen).toBe(true);
    expect(hooks?.scheduling?.blocksDoc).toBe(true);
    expect(hooks?.scheduling?.blocksIntegration).toBe(true);
    expect(hooks?.decompose?.isExclusive).toBe(decompHook.isExclusive);
    expect(hooks?.conversations?.convKey).toBe(convHook.convKey);
  });

  it('bundle does NOT publish unrelated hooks', () => {
    expect(featureBundle.plan).toBeUndefined();
    expect(featureBundle.check).toBeUndefined();
    // feature does NOT consume the testgen / doc / ui barriers — it
    // produces them instead (see blocks* flags above).
    expect(featureBundle.scheduling?.preTestgenBarrier).toBeUndefined();
    expect(featureBundle.scheduling?.preDocBarrier).toBeUndefined();
    expect(featureBundle.scheduling?.preUiBarrier).toBeUndefined();
  });
});

describe('tasks/feature/hooks/scheduling', () => {
  it('preIntegrationBarrier — true', () => {
    expect(preIntegrationBarrier).toBe(true);
  });

  it('producer flags — feature work activates ui / testgen / doc / integration barriers', () => {
    expect(blocksUi).toBe(true);
    expect(blocksTestgen).toBe(true);
    expect(blocksDoc).toBe(true);
    expect(blocksIntegration).toBe(true);
  });
});

describe('tasks/feature/hooks/decompose', () => {
  it('isExclusive — false for ordinary feature tasks', () => {
    expect(decompHook.isExclusive(task('f1'))).toBe(false);
    expect(decompHook.isExclusive(task('integration-1', { priority: TASK_PRIORITIES.INTEGRATION_MIN }))).toBe(false);
  });

  it('isExclusive — true fallback when priority === FINAL_VERIFICATION', () => {
    // priority 1000 feature tasks are re-typed to 'verification' in responseParser.
    // This fallback defends against a regression of that retyping.
    expect(decompHook.isExclusive(task('final', { priority: TASK_PRIORITIES.FINAL_VERIFICATION }))).toBe(true);
  });
});

describe('tasks/feature/hooks/conversations', () => {
  it('convKey — task-id-scoped', () => {
    expect(convHook.convKey(task('f1'))).toBe('node:execute:feature:f1');
    expect(convHook.convKey(task('auth-login'))).toBe('node:execute:feature:auth-login');
  });
});
