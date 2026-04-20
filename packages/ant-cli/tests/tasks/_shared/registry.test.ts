/**
 * L2 — `tasks/_shared/registry` dispatch invariants.
 *
 * Locks the hook-lookup contract the phase layer relies on (R1 rule at
 * `docs/architecture/NODE_GRAPH_LAYOUT.md`). Both entry points —
 * `hooksForTaskType(taskType)` (stateless) and `hooksIfActive(state)`
 * (state-scoped) — MUST return the same bundle object so the dispatch
 * surface is consistent whether the caller is a phase node, router,
 * parallel orchestrator, or a common tool handler.
 *
 * Coverage:
 *   - every registered task type returns the canonical bundle exported
 *     by `tasks/{type}/index.ts`
 *   - `hooksForTaskType` and `hooksIfActive` resolve to `===` identical
 *     objects for each task type (no copying / proxying)
 *   - `explain` stays a placeholder (empty bundle) until it acquires a
 *     real hook surface
 *   - unset / unknown task type returns `undefined` from both entry
 *     points (prevents the `(hooks as any)` escape hatch)
 */

import { describe, it, expect } from 'vitest';

import {
  hooksForTaskType,
  hooksIfActive,
} from '../../../src/agents/architect/graph/code/tasks/_shared/registry';

import { hooks as verificationBundle } from '../../../src/agents/architect/graph/code/tasks/verification';
import { hooks as errorBundle } from '../../../src/agents/architect/graph/code/tasks/error';
import { hooks as setupBundle } from '../../../src/agents/architect/graph/code/tasks/setup';
import { hooks as uiBundle } from '../../../src/agents/architect/graph/code/tasks/ui';
import { hooks as designSystemBundle } from '../../../src/agents/architect/graph/code/tasks/design-system';
import { hooks as testCodeBundle } from '../../../src/agents/architect/graph/code/tasks/test-code';
import { hooks as docBundle } from '../../../src/agents/architect/graph/code/tasks/doc';
import { hooks as featureBundle } from '../../../src/agents/architect/graph/code/tasks/feature';

import type { TaskType } from '@ant/shared';
import type { TaskHooks } from '../../../src/agents/architect/graph/code/tasks/_shared/types';

const REAL_BUNDLES: Array<[TaskType, TaskHooks]> = [
  ['verification', verificationBundle],
  ['error', errorBundle],
  ['setup', setupBundle],
  ['ui', uiBundle],
  ['design-system', designSystemBundle],
  ['test-code', testCodeBundle],
  ['doc', docBundle],
  ['feature', featureBundle],
];

describe('tasks/_shared/registry — hooksForTaskType', () => {
  it.each(REAL_BUNDLES)(
    'returns the canonical bundle for %s',
    (type, bundle) => {
      expect(hooksForTaskType(type)).toBe(bundle);
    },
  );

  it('returns the empty placeholder for explain (no hook surface yet)', () => {
    const hooks = hooksForTaskType('explain');
    expect(hooks).toBeDefined();
    expect(hooks).toEqual({});
  });

  it('returns undefined when taskType is undefined', () => {
    expect(hooksForTaskType(undefined)).toBeUndefined();
  });

  it('returns undefined for unknown task types (no fallback bundle)', () => {
    // `as TaskType` is the only way to construct an unregistered value
    // without widening the registry's key domain. The dispatcher must
    // still say "no hooks" rather than proxying to a default bundle.
    expect(hooksForTaskType('not-a-type' as TaskType)).toBeUndefined();
  });
});

describe('tasks/_shared/registry — hooksIfActive', () => {
  it.each(REAL_BUNDLES)(
    'resolves state.currentTask.type === %s to the same bundle as hooksForTaskType',
    (type, bundle) => {
      const state = { currentTask: { type } } as any;
      const viaState = hooksIfActive(state);
      const viaType = hooksForTaskType(type);
      expect(viaState).toBe(bundle);
      expect(viaState).toBe(viaType);
    },
  );

  it('returns undefined when state is undefined', () => {
    expect(hooksIfActive(undefined)).toBeUndefined();
  });

  it('returns undefined when state has no currentTask', () => {
    expect(hooksIfActive({} as any)).toBeUndefined();
  });

  it('returns undefined when currentTask lacks a type', () => {
    expect(hooksIfActive({ currentTask: {} } as any)).toBeUndefined();
  });

  it('returns undefined for unknown currentTask.type', () => {
    expect(
      hooksIfActive({ currentTask: { type: 'not-a-type' } } as any),
    ).toBeUndefined();
  });
});

describe('tasks/_shared/registry — invariants shared across entry points', () => {
  it.each(REAL_BUNDLES)(
    'hooksForTaskType(%s) === hooksIfActive({currentTask:{type:%s}})',
    (type) => {
      const viaState = hooksIfActive({ currentTask: { type } } as any);
      const viaType = hooksForTaskType(type);
      expect(viaState).toBe(viaType);
    },
  );

  it('each real bundle is a non-empty object (i.e. publishes at least one slot)', () => {
    for (const [type, bundle] of REAL_BUNDLES) {
      const keys = Object.keys(bundle);
      expect(
        keys.length,
        `expected ${type} bundle to publish at least one hook slot, got ${JSON.stringify(bundle)}`,
      ).toBeGreaterThan(0);
    }
  });
});
