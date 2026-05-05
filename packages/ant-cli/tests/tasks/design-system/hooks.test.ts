/**
 * L2 — `tasks/design-system/hooks/*` adapter invariants.
 *
 * Design-system tasks in the code pipeline are classified via the
 * bundle's `scheduling.classify` hook (priority-band → role mapping).
 * classify returns `isFoundation: true` + `expandedRagQuota: true` for
 * priority 200–299 (tokens + wiring) and the empty object for any
 * priority outside that band. The orchestrator's `schedClassify(t,
 * 'isFoundation')` helper then activates `hasPreFeatureWork` — the
 * cross-type barrier that gates priority ≥ 300 tasks (feature / ui /
 * test-code / doc / integration).
 *
 * Invariants locked here:
 *   - classify is published and returns { isFoundation, expandedRagQuota }
 *     for in-band priorities.
 *   - Static consumer / producer flags (`preUiBarrier` etc.,
 *     `blocksUi` etc.) remain absent — design-system's scheduling role
 *     is expressed SOLELY through classify, not through a second
 *     type-level flag. Publishing a static flag alongside classify
 *     would duplicate SSOT (the historical dual-SSOT drift guard).
 *   - Sibling ordering (tokens before wiring) is driven by the shared
 *     `parallelGroup: "design-system"` + the priority-ordered task queue.
 *
 * This test pins those invariants so the bundle cannot silently acquire
 * a static type-level barrier without an explicit orchestrator contract
 * change. Any new static scheduling flag without updating this test is
 * a drift signal.
 */

import { describe, it, expect } from 'vitest';

import * as convHook from '../../../src/agents/architect/graph/code/tasks/design-system/hooks/conversations';
import { hooks as dsBundle, isDesignSystemTask } from '../../../src/agents/architect/graph/code/tasks/design-system';
import { hooksForTaskType } from '../../../src/agents/architect/graph/code/tasks/_shared/registry';

import type { CodeTask } from '../../../src/agents/architect/types/task';

function task(id: string, overrides: Partial<CodeTask> = {}): CodeTask {
  return {
    id,
    name: id,
    type: 'design-system',
    priority: 200,
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

  it('bundle publishes conversations + plan.extraTemplateVars + scheduling.classify — all other slots undefined', () => {
    // Slot-level absence — mirrors the ui / doc / test-code precedents
    // so a future drive-by hook addition forces an explicit test update
    // (and forces the author to justify it in index.ts).
    //
    // `plan.extraTemplateVars` is the workspace-dep-snapshot reader.
    // `scheduling.classify` is the foundation-role SSOT (priority band
    // → `isFoundation` + `expandedRagQuota`). Every OTHER scheduling
    // member — static consumer / producer flags — MUST stay absent so
    // classify remains the single source of truth.
    expect(typeof dsBundle.scheduling?.classify).toBe('function');
    expect(dsBundle.plan?.buildPrompt).toBeUndefined();
    expect(dsBundle.plan?.toolLoopLogTemplate).toBeUndefined();
    expect(dsBundle.plan?.finalizeNudge).toBeUndefined();
    expect(dsBundle.plan?.checkRetryTermination).toBeUndefined();
    expect(dsBundle.plan?.initSession).toBeUndefined();
    expect(typeof dsBundle.plan?.extraTemplateVars).toBe('function');
    expect(dsBundle.decompose).toBeUndefined();
    expect(dsBundle.check).toBeUndefined();
    expect(dsBundle.tool).toBeUndefined();
    expect(dsBundle.command).toBeUndefined();
    expect(dsBundle.router).toBeUndefined();
    expect(dsBundle.orchestrator).toBeUndefined();
  });

  it('classify reports isFoundation + expandedRagQuota — type-fixed (Three-Axis SSOT)', () => {
    // Every design-system task is foundation work by virtue of its type;
    // priority is irrelevant to scheduling decisions.
    expect(dsBundle.scheduling?.classify?.(task('t-200', { priority: 200 }))).toEqual({
      isFoundation: true,
      expandedRagQuota: true,
    });
    expect(dsBundle.scheduling?.classify?.(task('t-250', { priority: 250 }))).toEqual({
      isFoundation: true,
      expandedRagQuota: true,
    });
    // Type-fixed: priority outside the historical 200-299 window still
    // classifies as foundation (the discriminator is `type`, not band).
    expect(dsBundle.scheduling?.classify?.(task('t-999', { priority: 999 }))).toEqual({
      isFoundation: true,
      expandedRagQuota: true,
    });
  });

  it('static consumer + producer flags stay absent — classify is the SSOT', () => {
    // Consumer flags — design-system is below FEATURE_CRITICAL (300),
    // so it never waits on a type-level barrier.
    expect(dsBundle.scheduling?.preUiBarrier).toBeUndefined();
    expect(dsBundle.scheduling?.preTestgenBarrier).toBeUndefined();
    expect(dsBundle.scheduling?.preDocBarrier).toBeUndefined();
    expect(dsBundle.scheduling?.preIntegrationBarrier).toBeUndefined();
    // Producer flags — the "design-system blocks priority ≥ 300 tasks"
    // semantic is owned by classify.isFoundation. Publishing a
    // type-level `blocksXxx` flag here would duplicate that SSOT.
    expect(dsBundle.scheduling?.blocksUi).toBeUndefined();
    expect(dsBundle.scheduling?.blocksTestgen).toBeUndefined();
    expect(dsBundle.scheduling?.blocksDoc).toBeUndefined();
    expect(dsBundle.scheduling?.blocksIntegration).toBeUndefined();
  });
});

describe('tasks/design-system/hooks/conversations', () => {
  it('convKey — task-id-scoped', () => {
    expect(convHook.convKey(task('d1'))).toBe('node:execute:design-system:d1');
    expect(convHook.convKey(task('tokens'))).toBe('node:execute:design-system:tokens');
  });
});

describe('tasks/design-system/model/is — isDesignSystemTask', () => {
  // Introduced in T6b-κ together with isTestCodeTask / isExplainTask so
  // phase-layer call sites (`nodes/execute/tools.ts
  // isFrontendTask`, `nodes/decompose/responseParser.ts
  // deriveArtifactPolicy`) can retire the last literal
  // `taskType === 'design-system'` comparisons and delegate to the
  // per-task predicate SSOT.
  it('returns true only for design-system tasks', () => {
    expect(isDesignSystemTask({ type: 'design-system' })).toBe(true);
    expect(isDesignSystemTask({ type: 'ui' })).toBe(false);
    expect(isDesignSystemTask({ type: 'feature' })).toBe(false);
    expect(isDesignSystemTask({ type: 'verification' })).toBe(false);
  });

  it('handles null / undefined / missing type defensively', () => {
    expect(isDesignSystemTask(null)).toBe(false);
    expect(isDesignSystemTask(undefined)).toBe(false);
    expect(isDesignSystemTask({})).toBe(false);
  });
});
