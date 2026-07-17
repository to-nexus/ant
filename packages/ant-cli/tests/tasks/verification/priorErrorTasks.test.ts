/**
 * L1 — verification priorErrorTasks helper.
 *
 * Asserts that `state.completedTasksDetails` is filtered to SPLIT-BORN error
 * sub-tasks (`type === 'error'` AND `batchSplitCount ≥ 1`) with the right
 * shape, in chronological (push) order, with no cap.
 *
 * The split-born discriminator is the orbit-mapping-heart regression guard:
 * decompose-authored error siblings (no `batchSplitCount`) MUST NOT qualify —
 * they are ordinary planned work, and counting them misfires the
 * `hasUserRuntimeErrorContext` gate (reproducer requirement + sentinel
 * prohibition) on a fresh verification whose directive is not a failure
 * report, eliminating every legal terminal output of the verify plan loop.
 */

import { describe, it, expect } from 'vitest';
import { renderPriorErrorTasks } from '../../../src/agents/architect/graph/code/tasks/_shared/verify/prompt/priorErrorTasks';
import type { ArchitectGraphState } from '../../../src/agents/architect/graph/code/state';
import type { CodeTask } from '../../../src/agents/architect/types/task';

function task(
  id: string,
  type: CodeTask['type'],
  description = `desc-${id}`,
  batchSplitCount?: number,
): CodeTask {
  return {
    id,
    name: `task-${id}`,
    type,
    priority: 100,
    description,
    ...(batchSplitCount !== undefined ? { batchSplitCount } : {}),
  } as CodeTask;
}

/** Split-born error sub-task — the shape `_shared/batchSplit/process.ts` creates. */
function splitError(id: string, description = `desc-${id}`): CodeTask {
  return task(id, 'error', description, 1);
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

  it('returns undefined for decompose-authored error siblings (no batchSplitCount)', () => {
    const state = {
      completedTasksDetails: [
        task('e1', 'error', 'fix phase desync'),
        task('e2', 'error', 'fix background visibility'),
        task('e3', 'error', 'fix directional light'),
      ],
    } as unknown as ArchitectGraphState;
    expect(renderPriorErrorTasks(state)).toBeUndefined();
  });

  it('filters to split-born error tasks only, preserving push order, with name + description', () => {
    const state = {
      completedTasksDetails: [
        task('f1', 'feature', 'feature description'),
        splitError('e1', 'fix import path'),
        task('v1', 'verification', 'verify build'),
        splitError('e2', 'add missing types'),
        task('e-sibling', 'error', 'decompose-authored — excluded'),
        splitError('e3', 'unrelated cleanup'),
      ],
    } as unknown as ArchitectGraphState;

    const result = renderPriorErrorTasks(state);
    expect(result).toEqual([
      { name: 'task-e1', description: 'fix import path' },
      { name: 'task-e2', description: 'add missing types' },
      { name: 'task-e3', description: 'unrelated cleanup' },
    ]);
  });

  it('accepts any batchSplitCount ≥ 1 (later split cycles carry higher counts)', () => {
    const state = {
      completedTasksDetails: [
        task('e1', 'error', 'cycle-3 sub-task', 3),
      ],
    } as unknown as ArchitectGraphState;
    expect(renderPriorErrorTasks(state)).toEqual([
      { name: 'task-e1', description: 'cycle-3 sub-task' },
    ]);
  });

  it('does not cap the list (natural ceiling = MAX_BATCH_SPLIT_CYCLES × avg-batches)', () => {
    const errors: CodeTask[] = Array.from({ length: 50 }, (_, i) =>
      splitError(`e${i}`, `description ${i}`),
    );
    const state = {
      completedTasksDetails: errors,
    } as unknown as ArchitectGraphState;
    const result = renderPriorErrorTasks(state);
    expect(result).toHaveLength(50);
  });
});
