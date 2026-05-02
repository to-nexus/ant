/**
 * L1 — verification priorErrorTasks helper.
 *
 * Asserts that `state.completedTasksDetails` is filtered to error sub-tasks
 * with the right shape, in chronological (push) order, with no cap.
 */

import { describe, it, expect } from 'vitest';
import { renderPriorErrorTasks } from '../../../src/agents/architect/graph/code/tasks/_shared/verify/priorErrorTasks';
import type { ArchitectGraphState } from '../../../src/agents/architect/graph/code/state';
import type { CodeTask } from '../../../src/agents/architect/types/task';

function task(id: string, type: CodeTask['type'], description = `desc-${id}`): CodeTask {
  return {
    id,
    name: `task-${id}`,
    type,
    priority: 100,
    description,
  } as CodeTask;
}

describe('renderPriorErrorTasks', () => {
  it('returns undefined when completedTasksDetails is missing', () => {
    expect(renderPriorErrorTasks({} as ArchitectGraphState)).toBeUndefined();
  });

  it('returns undefined when no error tasks have completed yet', () => {
    const state = {
      completedTasksDetails: [
        task('f1', 'feature'),
        task('v1', 'verification'),
      ],
    } as unknown as ArchitectGraphState;
    expect(renderPriorErrorTasks(state)).toBeUndefined();
  });

  it('filters to error tasks only, preserving push order, with name + description', () => {
    const state = {
      completedTasksDetails: [
        task('f1', 'feature', 'feature description'),
        task('e1', 'error', 'fix import path'),
        task('v1', 'verification', 'verify build'),
        task('e2', 'error', 'add missing types'),
        task('e3', 'error', 'unrelated cleanup'),
      ],
    } as unknown as ArchitectGraphState;

    const result = renderPriorErrorTasks(state);
    expect(result).toEqual([
      { name: 'task-e1', description: 'fix import path' },
      { name: 'task-e2', description: 'add missing types' },
      { name: 'task-e3', description: 'unrelated cleanup' },
    ]);
  });

  it('does not cap the list (natural ceiling = MAX_BATCH_SPLIT_CYCLES × avg-batches)', () => {
    const errors: CodeTask[] = Array.from({ length: 50 }, (_, i) =>
      task(`e${i}`, 'error', `description ${i}`),
    );
    const state = {
      completedTasksDetails: errors,
    } as unknown as ArchitectGraphState;
    const result = renderPriorErrorTasks(state);
    expect(result).toHaveLength(50);
  });
});
