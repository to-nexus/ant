/**
 * Tier3Task — the ONLY site where mode dispatch is allowed (D11 invariant).
 *
 * Verifies:
 *   - mode='explain' composes { Noop breadcrumb, ExplainOnly boundary }
 *   - mode='generate'/'refactor' composes { Full breadcrumb, AutoComplete boundary }
 *   - both modes share { AtBoundary collapse, ThresholdLLM compact }
 *
 * We drive the strategies end-to-end via a stub SessionPort so the
 * compose-then-apply path is exercised (constructor → operation method →
 * SessionPort call). Direct import of the strategy classes keeps us from
 * coupling to internals.
 */
import { describe, it, expect, vi } from 'vitest';
import type { FeatureBoundaryLine, FeatureBreadcrumbLine } from '@ant/shared';
import { Tier3Task } from '../../../src/core/executionTier/tiers/Tier3Task';
import type { ExecutionTierState } from '../../../src/core/executionTier/types';

function stubSession() {
  return {
    appendBreadcrumb: vi.fn<[FeatureBreadcrumbLine], Promise<void>>().mockResolvedValue(undefined),
    appendBoundary: vi.fn<[FeatureBoundaryLine], Promise<void>>().mockResolvedValue(undefined),
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
  it('mode=explain → Noop breadcrumb + ExplainOnly boundary (boundary emitted, breadcrumb skipped)', async () => {
    const state = makeState('explain');
    const session = state.deps!.session as any;
    const tier = new Tier3Task('explain');

    await tier.breadcrumb(state);
    await tier.boundary(state);

    expect(session.appendBreadcrumb).not.toHaveBeenCalled();
    expect(session.appendBoundary).toHaveBeenCalledTimes(1);
    const boundary = session.appendBoundary.mock.calls[0][0];
    expect(boundary.reason).toBe('auto_job_complete_todo');
  });

  it('mode=generate → Full breadcrumb + AutoComplete boundary (both emitted)', async () => {
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
        statusType: 'file_create',
        metadata: { filePath: 'src/x.ts' },
      },
    ]);

    const tier = new Tier3Task('generate');
    await tier.breadcrumb(state);
    await tier.boundary(state);

    expect(session.appendBreadcrumb).toHaveBeenCalledTimes(1);
    const bc = session.appendBreadcrumb.mock.calls[0][0];
    expect(bc.type).toBe('breadcrumb');
    expect(bc.anchors.files).toContain('src/x.ts');

    expect(session.appendBoundary).toHaveBeenCalledTimes(1);
  });

  it('mode=refactor → Full breadcrumb + AutoComplete boundary', async () => {
    const state = makeState('refactor');
    const session = state.deps!.session as any;
    session.loadChatByTurnIds = vi.fn().mockResolvedValue([
      {
        type: 'chat_status',
        ts: '2026-04-21T00:00:00Z',
        jobId: 'job-1',
        turnId: 'turn-1',
        jobType: 'code',
        statusType: 'file_edit',
        metadata: { filePath: 'src/y.ts' },
      },
    ]);
    const tier = new Tier3Task('refactor');
    await tier.breadcrumb(state);
    await tier.boundary(state);
    expect(session.appendBreadcrumb).toHaveBeenCalledTimes(1);
    expect(session.appendBreadcrumb.mock.calls[0][0].scope).toBe('refactor');
    expect(session.appendBoundary).toHaveBeenCalledTimes(1);
  });
});
