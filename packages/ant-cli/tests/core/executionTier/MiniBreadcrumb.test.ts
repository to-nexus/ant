/**
 * MiniBreadcrumb — Tier 2 Exploratory only emits when touched ≥ 3.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  MiniBreadcrumb,
  MINI_BREADCRUMB_TOUCHED_THRESHOLD,
} from '../../../src/core/executionTier/strategies/breadcrumb';
import type { ExecutionTierState } from '../../../src/core/executionTier/types';
import type { TouchedFromChatLog } from '../../../src/core/context/breadcrumb';

function makeState(): ExecutionTierState {
  const session = {
    appendBreadcrumb: vi.fn().mockResolvedValue(undefined),
    loadChatByTurnIds: vi.fn().mockResolvedValue([]),
  };
  return {
    jobId: 'job-1',
    turnId: 'turn-1',
    directive: 'stub',
    resolvedAction: { mode: 'generate' },
    deps: { session: session as any },
  };
}

function makeTouched(size: number): TouchedFromChatLog {
  const all = new Set<string>();
  for (let i = 0; i < size; i++) all.add(`src/file-${i}.ts`);
  return { all, created: [], modified: Array.from(all), deleted: [] };
}

describe('MiniBreadcrumb', () => {
  it(`skips when touched < ${MINI_BREADCRUMB_TOUCHED_THRESHOLD}`, async () => {
    const strategy = new MiniBreadcrumb();
    const state = makeState();
    await strategy.apply(state, makeTouched(MINI_BREADCRUMB_TOUCHED_THRESHOLD - 1));
    expect((state.deps!.session as any).appendBreadcrumb).not.toHaveBeenCalled();
  });

  it(`emits when touched === ${MINI_BREADCRUMB_TOUCHED_THRESHOLD}`, async () => {
    const strategy = new MiniBreadcrumb();
    const state = makeState();
    await strategy.apply(state, makeTouched(MINI_BREADCRUMB_TOUCHED_THRESHOLD));
    expect((state.deps!.session as any).appendBreadcrumb).toHaveBeenCalledTimes(1);
  });

  it(`emits when touched > ${MINI_BREADCRUMB_TOUCHED_THRESHOLD}`, async () => {
    const strategy = new MiniBreadcrumb();
    const state = makeState();
    await strategy.apply(state, makeTouched(MINI_BREADCRUMB_TOUCHED_THRESHOLD + 5));
    expect((state.deps!.session as any).appendBreadcrumb).toHaveBeenCalledTimes(1);
  });
});
