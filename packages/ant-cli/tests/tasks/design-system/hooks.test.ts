/**
 * L2 — `tasks/design-system/hooks/*` adapter invariants.
 *
 * Design-system tasks in the code pipeline are ordered by **priority +
 * parallelGroup**, not by type-level scheduling flags. The bundle
 * therefore publishes NO `scheduling` slot at all — every consumer
 * barrier (`preUiBarrier / preTestgenBarrier / preDocBarrier /
 * preIntegrationBarrier`) and every producer barrier (`blocksUi /
 * blocksTestgen / blocksDoc / blocksIntegration`) is intentionally
 * absent because:
 *
 *   - The "design-system blocks priority ≥ 300 tasks" semantic is
 *     already expressed by the priority-window predicate
 *     `isFoundationTask` (200–299) that drives `hasPreFeatureWork` in
 *     `parallel/TaskOrchestrator.ts` — a cross-type predicate owned by
 *     the orchestrator, not by per-task bundles.
 *   - Sibling ordering (tokens before wiring) is driven by the shared
 *     `parallelGroup: "design-system"` + the priority-ordered task queue.
 *   - The `hasPreAssetsWork` / `hasPreSpecWork` barriers that mention
 *     "tokens"/"assets"/"spec" in `TaskOrchestrator.ts` are inert for
 *     the code job (`graph.ts` L282 does not enable `barriers.assets` /
 *     `barriers.spec`) — they run in the design-job orchestrator only.
 *
 * This test pins those invariants so the bundle cannot silently acquire
 * a type-level barrier without an explicit orchestrator contract change.
 * Any `scheduling` flag added here without also updating this test is a
 * drift signal.
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

  it('bundle publishes only conversations + plan.extraTemplateVars slots — all other slots undefined', () => {
    // Slot-level absence — mirrors the ui / doc / test-code precedents
    // so a future drive-by hook addition forces an explicit test update
    // (and forces the author to justify it in index.ts).
    //
    // `plan.extraTemplateVars` is the workspace-dep-snapshot reader
    // shared across setup / feature / ui / design-system / test-code:
    // design-system tasks routinely add `tailwindcss` / `radix-ui` /
    // `@emotion/*`, so they need read-only visibility into existing
    // pins before the policy guard rejects a conflicting spec at write
    // time. The bundle MUST NOT publish any other plan slot — buildPrompt,
    // toolLoopLogTemplate, finalizeNudge, etc. all stay absent.
    expect(dsBundle.scheduling).toBeUndefined();
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

  it('scheduling slot absence implies ALL barrier flags are undefined (consumer + producer)', () => {
    // Redundant with the slot-level check above, but spelled out per
    // individual flag so a future refactor that introduces `scheduling:
    // {}` (empty object) still fails here instead of silently accepting
    // any future flag addition. Each of these MUST remain undefined:
    //
    // Consumer flags — design-system is below FEATURE_CRITICAL (300),
    // so it never waits on a type-level barrier.
    expect(dsBundle.scheduling?.preUiBarrier).toBeUndefined();
    expect(dsBundle.scheduling?.preTestgenBarrier).toBeUndefined();
    expect(dsBundle.scheduling?.preDocBarrier).toBeUndefined();
    expect(dsBundle.scheduling?.preIntegrationBarrier).toBeUndefined();
    // Producer flags — the "design-system blocks feature+" semantic is
    // owned by the priority-window predicate `isFoundationTask`
    // (200–299) that drives `hasPreFeatureWork` in TaskOrchestrator.
    // Publishing any of these here would duplicate that SSOT.
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
