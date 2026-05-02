/**
 * Tier3Task — the ONLY site where mode dispatch is allowed (D11 invariant).
 *
 * After job-context-bridge T8:
 *   - mode='explain' composes { Noop breadcrumb, ThresholdLLM compact }
 *   - mode='generate'/'refactor' composes { Full breadcrumb, ThresholdLLM compact }
 *
 * boundary / collapse channels were removed from the tier facade — auto
 * boundary is gone (T2) and Hard Reset is recorded outside the tier
 * strategy chain. These tests pin that the facade exposes only
 * `breadcrumb` and `compact`.
 */
import { describe, it, expect, vi } from 'vitest';
import type { FeatureBreadcrumbLine } from '@ant/shared';
import { Tier3Task } from '../../../src/core/executionTier/tiers/Tier3Task';
import type { ExecutionTierState } from '../../../src/core/executionTier/types';

function stubSession() {
  return {
    appendBreadcrumb: vi.fn<[FeatureBreadcrumbLine], Promise<void>>().mockResolvedValue(undefined),
    loadChatByTurnIds: vi.fn().mockResolvedValue([]),
  };
}

function makeState(mode: 'explain' | 'generate' | 'refactor'): ExecutionTierState {
  return {
    jobId: 'job-1',
    turnId: 'turn-1',
    directive: 'stub directive',
    resolvedAction: { mode },
    deps: { session: stubSession() as any },
  };
}

describe('Tier3Task', () => {
  it('mode=explain → Noop breadcrumb (no BC line, no boundary slot)', async () => {
    const state = makeState('explain');
    const session = state.deps!.session as any;
    const tier = new Tier3Task('explain');

    await tier.breadcrumb(state);

    expect(session.appendBreadcrumb).not.toHaveBeenCalled();
    expect((tier as any).boundary).toBeUndefined();
    expect((tier as any).collapse).toBeUndefined();
  });

  it('mode=generate → Full breadcrumb only', async () => {
    const state = makeState('generate');
    const session = state.deps!.session as any;
    // Simulate a file-op chat_status event so the breadcrumb has touched content.
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
    const state = makeState('refactor');
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
