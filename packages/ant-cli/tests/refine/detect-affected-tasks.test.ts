/**
 * F3.2b — detectAffectedTasks invariant test.
 *
 * Pins:
 *   - identifier-set intersection logic,
 *   - whitespace normalisation for `§ ` matching,
 *   - hasPrdRef=false guard (tasks without the plan doc as ref MUST be
 *     surfaced via `unscannableTaskIds`, not the affected list).
 */

import { describe, it, expect } from 'vitest';
import { detectAffectedTasks } from '../../src/core/refine/detectAffectedTasks';
import type { TaskDependency } from '../../src/core/refine/extractDependencies';
import type { PlanDiff } from '../../src/core/refine/extractPlanDiff';

const diff = (sections: string[]): PlanDiff => ({
  doc: 'prd.md',
  updatedSections: sections,
  sources: ['llm-tag'],
});

const dep = (
  id: string,
  cited: string[],
  hasPrdRef = true,
  targetFile = 'fe-system-main.md',
): TaskDependency => ({
  taskId: id,
  taskName: id,
  targetFile,
  citedSections: cited,
  hasPrdRef,
});

describe('detectAffectedTasks', () => {
  it('matches when a single cited identifier intersects updatedSections', () => {
    const result = detectAffectedTasks(
      diff(['PRD §6']),
      [dep('a', ['PRD §6', 'SC-Search'])],
    );
    expect(result.affected).toHaveLength(1);
    expect(result.affected[0].matchedSections).toEqual(['PRD §6']);
    expect(result.affected[0].reasons[0]).toMatch(/prd\.md PRD §6/);
    expect(result.unscannableTaskIds).toEqual([]);
  });

  it('does NOT match when no overlap', () => {
    const result = detectAffectedTasks(
      diff(['SC-Onboarding']),
      [dep('a', ['SC-Search', 'PRD §6'])],
    );
    expect(result.affected).toEqual([]);
  });

  it('hasPrdRef=false tasks are surfaced via unscannableTaskIds, NOT affected', () => {
    // Even when citations would intersect, the task must NOT be reported
    // as affected because its citation surface is unreliable (the task
    // was authored without the plan doc in scope).
    const result = detectAffectedTasks(
      diff(['PRD §6']),
      [dep('unsafe', ['PRD §6'], /* hasPrdRef */ false)],
    );
    expect(result.affected).toEqual([]);
    expect(result.unscannableTaskIds).toEqual(['unsafe']);
  });

  it('whitespace around § normalises across both sides of the comparison', () => {
    const result = detectAffectedTasks(
      diff(['PRD § 6']),
      [dep('a', ['PRD §6'])],
    );
    expect(result.affected).toHaveLength(1);
  });

  it('mixed batch — some affected, some unscannable, some untouched', () => {
    const result = detectAffectedTasks(
      diff(['PRD §6', 'SC-Search']),
      [
        dep('hit-1', ['PRD §6']),
        dep('hit-2', ['SC-Search']),
        dep('miss-1', ['SC-Onboarding']),
        dep('unsafe', ['PRD §6'], /* hasPrdRef */ false),
      ],
    );
    expect(result.affected.map(a => a.taskId).sort()).toEqual(['hit-1', 'hit-2']);
    expect(result.unscannableTaskIds).toEqual(['unsafe']);
  });
});
