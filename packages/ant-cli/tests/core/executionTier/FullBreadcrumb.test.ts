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
import type { FeatureBreadcrumbLine } from '@ant/shared';
import { FullBreadcrumb } from '../../../src/core/executionTier/strategies/breadcrumb';
import { Tier3Task } from '../../../src/core/executionTier/tiers/Tier3Task';
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

/**
 * Tier3Task — the ONLY site where mode dispatch is allowed (D11 invariant).
 *
 *   - mode='explain' composes { Noop breadcrumb, ThresholdLLM compact }
 *   - mode='generate'/'refactor' composes { Full breadcrumb, ThresholdLLM compact }
 *
 * boundary / collapse channels were removed from the tier facade — auto
 * boundary is gone (T2) and Hard Reset is recorded outside the tier
 * strategy chain. These tests pin that the facade composes the right
 * breadcrumb strategy per mode.
 */
describe('Tier3Task — mode dispatch composes correct breadcrumb strategy', () => {
  function stubSession() {
    return {
      appendBreadcrumb: vi.fn<[FeatureBreadcrumbLine], Promise<void>>().mockResolvedValue(undefined),
      loadChatByTurnIds: vi.fn().mockResolvedValue([]),
    };
  }

  function tierState(mode: 'explain' | 'generate' | 'refactor'): ExecutionTierState {
    return {
      jobId: 'job-1',
      turnId: 'turn-1',
      directive: 'stub directive',
      resolvedAction: { mode },
      deps: { session: stubSession() as any },
    };
  }

  it('mode=explain → Noop breadcrumb (no BC line, no boundary slot)', async () => {
    const state = tierState('explain');
    const session = state.deps!.session as any;
    const tier = new Tier3Task('explain');

    await tier.breadcrumb(state);

    expect(session.appendBreadcrumb).not.toHaveBeenCalled();
    expect((tier as any).boundary).toBeUndefined();
    expect((tier as any).collapse).toBeUndefined();
  });

  it('mode=generate → Full breadcrumb only', async () => {
    const state = tierState('generate');
    const session = state.deps!.session as any;
    session.loadChatByTurnIds = vi.fn().mockResolvedValue([
      {
        type: 'chat_status',
        ts: '2026-04-21T00:00:00Z',
        jobId: 'job-1',
        turnId: 'turn-1',
        jobType: 'code',
        cardId: 'card-1',
        statusType: 'file_create',
        metadata: { filePath: 'src/x.ts' },
      },
    ]);

    const tier = new Tier3Task('generate');
    await tier.breadcrumb(state);

    expect(session.appendBreadcrumb).toHaveBeenCalledTimes(1);
    const bc = session.appendBreadcrumb.mock.calls[0][0];
    expect(bc.type).toBe('breadcrumb');
    expect(bc.anchors.files).toContain('src/x.ts');
  });

  it('mode=refactor → Full breadcrumb with refactor scope', async () => {
    const state = tierState('refactor');
    const session = state.deps!.session as any;
    session.loadChatByTurnIds = vi.fn().mockResolvedValue([
      {
        type: 'chat_status',
        ts: '2026-04-21T00:00:00Z',
        jobId: 'job-1',
        turnId: 'turn-1',
        jobType: 'code',
        cardId: 'card-1',
        statusType: 'file_edit',
        metadata: { filePath: 'src/y.ts' },
      },
    ]);
    const tier = new Tier3Task('refactor');
    await tier.breadcrumb(state);
    expect(session.appendBreadcrumb).toHaveBeenCalledTimes(1);
    expect(session.appendBreadcrumb.mock.calls[0][0].scope).toBe('refactor');
  });
});
