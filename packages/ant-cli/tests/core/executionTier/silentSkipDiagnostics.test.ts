/**
 * Silent-skip diagnostics for breadcrumb / user_turn_meta writers.
 *
 * Regression guard for job-context-bridge T1 — historically these helpers
 * returned silently when the session port, jobId, or turnId was missing,
 * making it impossible to attribute "BC line 0개" symptoms to a specific
 * precondition. The fix replaces every silent skip with a console.warn
 * naming the missing precondition. These tests pin that contract.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FullBreadcrumb } from '../../../src/core/executionTier/strategies/breadcrumb';
import { recordUserTurnMeta } from '../../../src/core/executionTier/recordUserTurnMeta';
import type { ExecutionTierState } from '../../../src/core/executionTier/types';
import type { TouchedFromChatLog } from '../../../src/core/context/breadcrumb';
import { ExecutionTierId } from '@ant/shared';

function makeSession() {
  return {
    appendBreadcrumb: vi.fn().mockResolvedValue(undefined),
    appendUserTurnMeta: vi.fn().mockResolvedValue(undefined),
    loadChatByTurnIds: vi.fn().mockResolvedValue([]),
  };
}

function emptyTouched(): TouchedFromChatLog {
  return { all: new Set<string>(), created: [], modified: [], deleted: [] };
}

describe('writeBreadcrumb / FullBreadcrumb — silent skip diagnostics', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('logs a reason when session port is missing', async () => {
    const state: ExecutionTierState = {
      jobId: 'job-1',
      turnId: 'turn-1',
      directive: 'stub',
      resolvedAction: { mode: 'generate' },
      deps: {}, // session intentionally absent
    };
    await new FullBreadcrumb().apply(state, emptyTouched());
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('writeBreadcrumb skipped: session port unavailable'),
    );
  });

  it('logs a reason when turnId is missing', async () => {
    const session = makeSession();
    const state: ExecutionTierState = {
      jobId: 'job-1',
      turnId: undefined,
      directive: 'stub',
      resolvedAction: { mode: 'generate' },
      deps: { session: session as any },
    };
    await new FullBreadcrumb().apply(state, emptyTouched());
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/writeBreadcrumb skipped: missing context.*turnId=undefined/),
    );
    expect(session.appendBreadcrumb).not.toHaveBeenCalled();
  });

  it('logs a reason when jobId is missing', async () => {
    const session = makeSession();
    const state: ExecutionTierState = {
      jobId: undefined,
      turnId: 'turn-1',
      directive: 'stub',
      resolvedAction: { mode: 'generate' },
      deps: { session: session as any },
    };
    await new FullBreadcrumb().apply(state, emptyTouched());
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/writeBreadcrumb skipped: missing context.*jobId=undefined/),
    );
    expect(session.appendBreadcrumb).not.toHaveBeenCalled();
  });

  // job-context-bridge T3 — explain mode + touched=0 are expected skips with
  // their own diagnostic lines (debug, not warn). They share the no-BC outcome
  // but have non-fault semantics, so they go through console.log.
  it("skips and logs when mode='explain' (no anchors by construction)", async () => {
    const session = makeSession();
    const state: ExecutionTierState = {
      jobId: 'job-1',
      turnId: 'turn-1',
      directive: 'stub',
      resolvedAction: { mode: 'explain' },
      deps: { session: session as any },
    };
    await new FullBreadcrumb().apply(state, emptyTouched());
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("writeBreadcrumb skipped: mode='explain'"),
    );
    expect(session.appendBreadcrumb).not.toHaveBeenCalled();
  });

  it('skips and logs when touched=0 for non-explain modes', async () => {
    const session = makeSession();
    const state: ExecutionTierState = {
      jobId: 'job-1',
      turnId: 'turn-1',
      directive: 'stub',
      resolvedAction: { mode: 'generate' },
      deps: { session: session as any },
    };
    await new FullBreadcrumb().apply(state, emptyTouched());
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('writeBreadcrumb skipped: touched=0'),
    );
    expect(session.appendBreadcrumb).not.toHaveBeenCalled();
  });
});

describe('recordUserTurnMeta — silent skip diagnostics', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('logs the missing precondition when session is missing', async () => {
    await recordUserTurnMeta({
      session: undefined,
      turnId: 'turn-1',
      jobId: 'job-1',
      jobType: 'code',
      executionTier: ExecutionTierId.Task,
      nodeLabel: 'Decompose',
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('recordUserTurnMeta skipped: session port unavailable'),
    );
  });

  it('logs the missing precondition when turnId is missing', async () => {
    const session = makeSession();
    await recordUserTurnMeta({
      session: session as any,
      turnId: undefined,
      jobId: 'job-1',
      jobType: 'code',
      executionTier: ExecutionTierId.Task,
      nodeLabel: 'Decompose',
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('recordUserTurnMeta skipped: turnId missing'),
    );
    expect(session.appendUserTurnMeta).not.toHaveBeenCalled();
  });

  it('logs the missing precondition when jobId is missing', async () => {
    const session = makeSession();
    await recordUserTurnMeta({
      session: session as any,
      turnId: 'turn-1',
      jobId: undefined,
      jobType: 'code',
      executionTier: ExecutionTierId.Task,
      nodeLabel: 'Decompose',
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('recordUserTurnMeta skipped: jobId missing'),
    );
    expect(session.appendUserTurnMeta).not.toHaveBeenCalled();
  });

  it('appends meta when all preconditions are met', async () => {
    const session = makeSession();
    await recordUserTurnMeta({
      session: session as any,
      turnId: 'turn-1',
      jobId: 'job-1',
      jobType: 'code',
      executionTier: ExecutionTierId.Task,
      nodeLabel: 'Decompose',
    });
    expect(warnSpy).not.toHaveBeenCalled();
    expect(session.appendUserTurnMeta).toHaveBeenCalledTimes(1);
  });
});
