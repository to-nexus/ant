/**
 * L1 unit — plan-time flat-plan size gate (dim-beating-brass RCA).
 *
 * The gate is the runtime floor the prompt-only split rubric cannot
 * guarantee. It trips ONLY when count + breadth + budget all agree, so a
 * coherent large-but-uniform plan (the rubric's mechanical case) never
 * trips. See `tasks/_shared/batchSplit/sizeGate.ts`.
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateFlatPlanSizeGate,
  domainBucket,
  IMPL_FLOOR,
  DOMAIN_SPREAD,
} from '../../../src/agents/architect/graph/code/tasks/_shared/batchSplit';

// Reproduces track-parent: 7 application/presentation/domain areas.
function aggregatorEntries(): any[] {
  return [
    { target: 'codebase/src/application/capsule/index.ts' },
    { target: 'codebase/src/application/capsule/view-model.ts' },
    { target: 'codebase/src/application/dashboard/dashboard-feature-factory.ts' },
    { target: 'codebase/src/application/dashboard/index.ts' },
    { target: 'codebase/src/application/feed/index.ts' },
    { target: 'codebase/src/application/assignment/index.ts' },
    { target: 'codebase/src/application/submission/index.ts' },
    { target: 'codebase/src/application/comment/index.ts' },
    { target: 'codebase/src/application/notification/index.ts' },
    { target: 'codebase/src/presentation/parent/home.tsx' },
    { target: 'codebase/src/presentation/parent/dashboard.tsx' },
    { target: 'codebase/src/presentation/auth/state-views.tsx' },
    { target: 'codebase/src/domain/dashboard/model.ts' },
    { target: 'codebase/src/domain/capsule/model.ts' },
    { target: 'codebase/src/domain/feed/model.ts' },
    { target: 'codebase/src/domain/notification/model.ts' },
  ];
}

describe('domainBucket', () => {
  it('strips codebase/src and buckets by first two directory segments', () => {
    expect(domainBucket('codebase/src/application/capsule/index.ts')).toBe('application/capsule');
    expect(domainBucket('packages/fe-main/src/presentation/auth/x.ts')).toBe('presentation/auth');
    expect(domainBucket('src/domain/dashboard/model.ts')).toBe('domain/dashboard');
  });

  it('buckets files in the same folder together (filename dropped)', () => {
    expect(domainBucket('src/application/capsule/index.ts')).toBe('application/capsule');
    expect(domainBucket('src/application/capsule/view-model.ts')).toBe('application/capsule');
  });

  it('bare root-level files collapse to a single (root) bucket', () => {
    expect(domainBucket('src/Btn.tsx')).toBe('(root)');
    expect(domainBucket('mod-0.ts')).toBe('(root)');
  });

  it('empty path → empty bucket (ignored)', () => {
    expect(domainBucket('')).toBe('');
  });
});

describe('evaluateFlatPlanSizeGate', () => {
  it('trips on a wide aggregator flat plan under a tight budget (track-parent)', () => {
    const res = evaluateFlatPlanSizeGate({
      modify: aggregatorEntries(),
      create: [],
      delete: [],
      recursionLimit: 200,
      recursionCount: 71, // post-investigation, like the real run
    });
    expect(res.trip).toBe(true);
    expect(res.reason).toBe('tripped');
    expect(res.metrics.topLevelImplCount).toBe(16);
    expect(res.metrics.distinctTopLevelDomains).toBeGreaterThanOrEqual(DOMAIN_SPREAD);
  });

  it('does NOT trip below the implementation-count floor', () => {
    const res = evaluateFlatPlanSizeGate({
      modify: aggregatorEntries().slice(0, IMPL_FLOOR - 1),
      create: [],
      delete: [],
      recursionLimit: 200,
      recursionCount: 0,
    });
    expect(res.trip).toBe(false);
    expect(res.reason).toBe('below_floor');
  });

  it('does NOT trip when work is concentrated in ≤2 directory buckets (uniform mechanical case)', () => {
    // 20 entries, one token-swap recipe, all under one component folder.
    const concentrated = Array.from({ length: 20 }, (_, i) => ({
      target: `src/presentation/components/cards/Card${i}.tsx`,
    }));
    const res = evaluateFlatPlanSizeGate({
      modify: concentrated,
      create: [],
      delete: [],
      recursionLimit: 200,
      recursionCount: 0,
    });
    expect(res.trip).toBe(false);
    expect(res.reason).toBe('concentrated');
    expect(res.metrics.distinctTopLevelDomains).toBe(1);
  });

  it('does NOT trip a wide plan when the recursion budget is ample (budget-aware)', () => {
    const res = evaluateFlatPlanSizeGate({
      modify: aggregatorEntries(),
      create: [],
      delete: [],
      recursionLimit: 2000, // plenty of headroom
      recursionCount: 0,
    });
    expect(res.trip).toBe(false);
    expect(res.reason).toBe('within_budget');
  });

  it('counts entries across modify/create/delete buckets', () => {
    const e = aggregatorEntries();
    const res = evaluateFlatPlanSizeGate({
      modify: e.slice(0, 6),
      create: e.slice(6, 12),
      delete: e.slice(12, 16),
      recursionLimit: 200,
      recursionCount: 71,
    });
    expect(res.metrics.topLevelImplCount).toBe(16);
    expect(res.trip).toBe(true);
  });
});
