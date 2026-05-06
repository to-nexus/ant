/**
 * Orchestrator deadlock regression — `orchestrator foundation-gate deadlock (2026-05)` guard.
 *
 * Reproduces the exact queue shape that triggered the May 4 deadlock:
 *
 *   1. A foundation feature parent (priority 200, band='foundation')
 *      batch-splits into N foundation feature sub-tasks under
 *      Path B (drop-and-replace).
 *   2. The pre-fix code wrote `priority: parent − 1 = 199` to each
 *      sub-task, leaving the orchestrator's foundation gate
 *      (`hasPreFeatureWork ⇒ !isFoundation && !isTokens`) firing on
 *      every sub-task because their priority fell outside the 200–299
 *      window — but the parent's still-queued foundation siblings kept
 *      `hasPreFeatureWork = true`. With `runningTasks.size === 0`, no
 *      task could be assigned and no worker respawn fired.
 *
 * Three-Axis SSOT closes both halves:
 *   - Sub-tasks carry priority = parent priority (200, NOT 199).
 *   - Sub-tasks inherit `band: 'foundation'` so classify keeps reporting
 *     `isFoundation: true` regardless of priority transformations.
 *
 * This test asserts the orchestrator's foundation-gate predicate
 * (`schedClassify(task, 'isFoundation')`) reports `true` on the
 * post-split sub-tasks, which is the necessary condition for the
 * gate to admit them in `findAndAssignNonConflictingTask`.
 */

import { describe, it, expect } from 'vitest';
import { processDiagnosticBatchSplit } from '../../src/agents/architect/graph/code/tasks/_shared/batchSplit';
import { TaskQueue } from '../../src/agents/architect/types/task';
import { hooksForTaskType } from '../../src/agents/architect/graph/code/tasks/_shared/registry';
import type { CodeTask } from '../../src/agents/architect/types/task';

describe('Orchestrator deadlock regression — orchestrator foundation-gate deadlock', () => {
  it('foundation feature parent batch-split → sub-tasks satisfy foundation gate', () => {
    // Reproduces the queue head: foundation feature parent at priority
    // 200 with `band: 'foundation'`. Decompose's priority→band mapping
    // (responseParser.deriveBandFromPriority) is the SSOT that wires
    // band on the parent; here we seed it directly.
    const state: any = {
      taskQueue: new TaskQueue<CodeTask>(),
      _batchSplitRequeued: false,
      context: { featurePath: undefined },
      _httpJobId: undefined,
    };
    const foundationParent: CodeTask = {
      id: 'foundation-parent',
      name: 'shared types',
      type: 'feature',
      priority: 200,
      band: 'foundation',
      description: '',
    } as CodeTask;
    const plan = JSON.stringify({
      task: { id: 'parent', goal: 'split shared types' },
      parentReasoning: 'shared interfaces span N modules.',
      batches: [
        {
          name: 'unit a',
          rationale: 'a slice',
          modify: [{ target: 'a.ts' }],
          create: [],
          delete: [],
        },
        {
          name: 'unit b',
          rationale: 'b slice',
          modify: [{ target: 'b.ts' }],
          create: [],
          delete: [],
        },
      ],
    });

    processDiagnosticBatchSplit(state, plan, foundationParent);

    const subs = state.taskQueue
      .getAll()
      .filter((t: any) => t.type === 'feature');
    expect(subs.length).toBe(2);

    // Pre-fix regression signal: sub priority would have been 199 here.
    for (const s of subs) {
      expect(s.priority).toBe(foundationParent.priority);
      expect(s.band).toBe('foundation');
    }

    // The orchestrator gate dispatches through `classify(...).isFoundation`.
    // After the fix, sub-tasks classify as foundation regardless of any
    // future priority decrements (band is the SSOT, not priority).
    const classify = hooksForTaskType('feature')?.scheduling?.classify;
    expect(classify).toBeDefined();
    for (const s of subs) {
      expect(classify!(s as any).isFoundation).toBe(true);
    }
  });

  it('pre-three-axis regression: priority-199 sub-tasks would have failed the foundation gate', () => {
    // Documents the bug: classify reading priority would have
    // misclassified a priority-199 sub-task as ordinary feature work
    // (producesIntegrationGate) — opening the deadlock window. With
    // band as the SSOT, priority is irrelevant to classify.
    const subWithoutBand: CodeTask = {
      id: 'sub-no-band',
      name: 'sub',
      type: 'feature',
      priority: 199,
      description: '',
    } as CodeTask;
    const classify = hooksForTaskType('feature')?.scheduling?.classify;
    expect(classify!(subWithoutBand as any).isFoundation).toBe(false);
    expect(classify!(subWithoutBand as any).producesIntegrationGate).toBe(true);

    const subWithBand: CodeTask = {
      ...subWithoutBand,
      band: 'foundation',
    } as CodeTask;
    expect(classify!(subWithBand as any).isFoundation).toBe(true);
    expect(classify!(subWithBand as any).producesIntegrationGate).toBe(false);
  });
});
