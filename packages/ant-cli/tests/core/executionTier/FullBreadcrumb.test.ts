/**
 * FullBreadcrumb emit policy — job-context-bridge T3.
 *
 * After unification, every tier composes `fullBreadcrumb`. Skip semantics
 * are encoded inside `writeBreadcrumb`, not at the tier slot:
 *   - mode='explain'  → skip
 *   - touched === 0   → skip
 *   - otherwise       → emit, regardless of touched count or tier id
 *
 * The previous `MINI_BREADCRUMB_TOUCHED_THRESHOLD = 3` gate is gone — small
 * touches still carry useful pointer information for the next turn.
 */
import { describe, it, expect, vi } from 'vitest';
import { FullBreadcrumb } from '../../../src/core/executionTier/strategies/breadcrumb';
import type { ExecutionTierState } from '../../../src/core/executionTier/types';
import type { TouchedFromChatLog } from '../../../src/core/context/breadcrumb';

function makeSession() {
  return {
    appendBreadcrumb: vi.fn().mockResolvedValue(undefined),
    loadChatByTurnIds: vi.fn().mockResolvedValue([]),
  };
}

function makeState(
  mode: 'explain' | 'generate' | 'refactor',
  session = makeSession(),
): ExecutionTierState {
  return {
    jobId: 'job-1',
    turnId: 'turn-1',
    directive: 'stub directive',
    resolvedAction: { mode },
    deps: { session: session as any },
  };
}

function makeTouched(size: number): TouchedFromChatLog {
  const all = new Set<string>();
  for (let i = 0; i < size; i++) all.add(`src/file-${i}.ts`);
  return { all, created: [], modified: Array.from(all), deleted: [] };
}

describe('FullBreadcrumb — unified emit policy', () => {
  it('emits when touched=1 (no MINI threshold gate any more)', async () => {
    const session = makeSession();
    const state = makeState('generate', session);
    await new FullBreadcrumb().apply(state, makeTouched(1));
    expect(session.appendBreadcrumb).toHaveBeenCalledTimes(1);
  });

  it('emits when touched=2 (formerly below mini-BC threshold)', async () => {
    const session = makeSession();
    const state = makeState('refactor', session);
    await new FullBreadcrumb().apply(state, makeTouched(2));
    expect(session.appendBreadcrumb).toHaveBeenCalledTimes(1);
  });

  it('emits when touched=10 with concrete files anchor', async () => {
    const session = makeSession();
    const state = makeState('generate', session);
    await new FullBreadcrumb().apply(state, makeTouched(10));
    expect(session.appendBreadcrumb).toHaveBeenCalledTimes(1);
    const bc = session.appendBreadcrumb.mock.calls[0][0];
    expect(bc.anchors.files).toHaveLength(10);
  });

  it('skips when touched=0 (no anchor information value)', async () => {
    const session = makeSession();
    const state = makeState('generate', session);
    await new FullBreadcrumb().apply(state, makeTouched(0));
    expect(session.appendBreadcrumb).not.toHaveBeenCalled();
  });

  it("skips when mode='explain' even with touched > 0", async () => {
    const session = makeSession();
    const state = makeState('explain', session);
    await new FullBreadcrumb().apply(state, makeTouched(5));
    expect(session.appendBreadcrumb).not.toHaveBeenCalled();
  });
});
