import { describe, it, expect, vi } from 'vitest';
import type {
  FeatureBreadcrumbLine,
  FeatureUserTurnLine,
  FeatureUserTurnMetaLine,
} from '@ant/shared';
import {
  buildFeatureContext,
  hydrateFeatureContext,
  mergeFeatureContext,
  DEFAULT_BREADCRUMB_WINDOW,
} from '../../../src/core/context/featureContextBuilder';
import type { SessionPort } from '../../../src/core/ports/session';
import type { LLMClient } from '../../../src/core/ports/llm';
import type { PromptPort } from '../../../src/core/ports/prompt';

// ─────────────────────────────────────────────────────────────────────────────
// Fixture builders
// ─────────────────────────────────────────────────────────────────────────────

function makeTurn(
  idx: number,
  overrides: Partial<FeatureUserTurnLine> = {},
): FeatureUserTurnLine {
  return {
    type: 'user_turn',
    ts: `2026-04-19T00:00:${String(idx).padStart(2, '0')}.000Z`,
    jobId: `job-${idx}`,
    turnId: `t-${idx}`,
    jobType: 'code',
    text: `directive-${idx}`,
    ...overrides,
  };
}

function makeMeta(
  turnId: string,
  overrides: Partial<FeatureUserTurnMetaLine> = {},
): FeatureUserTurnMetaLine {
  return {
    type: 'user_turn_meta',
    ts: '2026-04-19T00:01:00.000Z',
    jobId: 'job-x',
    turnId,
    jobType: 'code',
    complexity: 'todo',
    decidedBy: 'llm',
    reason: 'classified',
    ...overrides,
  };
}

function makeBreadcrumb(
  idx: number,
  overrides: Partial<FeatureBreadcrumbLine> = {},
): FeatureBreadcrumbLine {
  return {
    type: 'breadcrumb',
    ts: `2026-04-19T00:10:${String(idx).padStart(2, '0')}.000Z`,
    jobId: `job-${idx}`,
    turnId: `t-${idx}`,
    jobType: 'code',
    scope: 'modification',
    anchors: { files: [`f${idx}.ts`] },
    summary: `bc-${idx}`,
    stats: { touched: 1 },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// mergeFeatureContext — turnId join
// ─────────────────────────────────────────────────────────────────────────────

describe('mergeFeatureContext — turnId join', () => {
  it('merges user_turn_meta patch fields onto matching user_turn', () => {
    const turn = makeTurn(1);
    const meta = makeMeta('t-1', {
      complexity: 'exploratory',
      decidedBy: 'heuristic',
      reason: 'ambiguous intent',
    });

    const ctx = mergeFeatureContext({
      userTurns: [turn],
      userTurnMetas: [meta],
      breadcrumbs: [],
    });

    expect(ctx.userTurns).toHaveLength(1);
    expect(ctx.userTurns[0]).toMatchObject({
      turnId: 't-1',
      text: 'directive-1',
      complexity: 'exploratory',
      decidedBy: 'heuristic',
      reason: 'ambiguous intent',
    });
    // type discriminant stays as the user_turn line (not user_turn_meta)
    expect(ctx.userTurns[0].type).toBe('user_turn');
  });

  it('leaves user_turn unchanged when no matching meta exists', () => {
    const turn = makeTurn(2);
    const ctx = mergeFeatureContext({
      userTurns: [turn],
      userTurnMetas: [makeMeta('t-999')], // different turnId
      breadcrumbs: [],
    });

    expect(ctx.userTurns[0]).toEqual(turn);
    expect((ctx.userTurns[0] as { complexity?: unknown }).complexity).toBeUndefined();
  });

  it('preserves input order (no sort) when merging multiple turns', () => {
    const turns = [makeTurn(3), makeTurn(1), makeTurn(2)];
    const ctx = mergeFeatureContext({
      userTurns: turns,
      userTurnMetas: [],
      breadcrumbs: [],
    });

    expect(ctx.userTurns.map((t) => t.turnId)).toEqual(['t-3', 't-1', 't-2']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// mergeFeatureContext — collapsed filter
// ─────────────────────────────────────────────────────────────────────────────

describe('mergeFeatureContext — collapsed lines dropped', () => {
  it('filters collapsed user_turn out of the merged list', () => {
    const alive = makeTurn(1);
    const dead = makeTurn(2, { collapsed: true });

    const ctx = mergeFeatureContext({
      userTurns: [alive, dead],
      userTurnMetas: [],
      breadcrumbs: [],
    });

    expect(ctx.userTurns.map((t) => t.turnId)).toEqual(['t-1']);
  });

  it('ignores collapsed user_turn_meta during merge (no patch applied)', () => {
    const turn = makeTurn(1);
    const deadMeta = makeMeta('t-1', { collapsed: true, complexity: 'todo' });

    const ctx = mergeFeatureContext({
      userTurns: [turn],
      userTurnMetas: [deadMeta],
      breadcrumbs: [],
    });

    expect((ctx.userTurns[0] as { complexity?: unknown }).complexity).toBeUndefined();
  });

  it('filters collapsed breadcrumb out of the window', () => {
    const alive = makeBreadcrumb(1);
    const dead = makeBreadcrumb(2, { collapsed: true });

    const ctx = mergeFeatureContext({
      userTurns: [],
      userTurnMetas: [],
      breadcrumbs: [alive, dead],
    });

    expect(ctx.breadcrumbs.map((b) => b.turnId)).toEqual(['t-1']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// mergeFeatureContext — breadcrumb window trim
// ─────────────────────────────────────────────────────────────────────────────

describe('mergeFeatureContext — breadcrumb window', () => {
  it('keeps the last N breadcrumbs (default window)', () => {
    const all = Array.from({ length: DEFAULT_BREADCRUMB_WINDOW + 3 }, (_, i) =>
      makeBreadcrumb(i + 1),
    );

    const ctx = mergeFeatureContext({
      userTurns: [],
      userTurnMetas: [],
      breadcrumbs: all,
    });

    expect(ctx.breadcrumbs).toHaveLength(DEFAULT_BREADCRUMB_WINDOW);
    // the most recent N are retained
    expect(ctx.breadcrumbs[0].turnId).toBe(`t-${all.length - DEFAULT_BREADCRUMB_WINDOW + 1}`);
    expect(ctx.breadcrumbs.at(-1)?.turnId).toBe(`t-${all.length}`);
  });

  it('honours a custom breadcrumbWindow override', () => {
    const all = Array.from({ length: 8 }, (_, i) => makeBreadcrumb(i + 1));
    const ctx = mergeFeatureContext(
      { userTurns: [], userTurnMetas: [], breadcrumbs: all },
      { breadcrumbWindow: 2 },
    );
    expect(ctx.breadcrumbs.map((b) => b.turnId)).toEqual(['t-7', 't-8']);
  });

  it('treats window ≤ 0 as "keep none" (no negative slice index leak)', () => {
    const all = [makeBreadcrumb(1), makeBreadcrumb(2)];
    const ctx = mergeFeatureContext(
      { userTurns: [], userTurnMetas: [], breadcrumbs: all },
      { breadcrumbWindow: 0 },
    );
    expect(ctx.breadcrumbs).toEqual([]);

    const ctxNeg = mergeFeatureContext(
      { userTurns: [], userTurnMetas: [], breadcrumbs: all },
      { breadcrumbWindow: -3 },
    );
    expect(ctxNeg.breadcrumbs).toEqual([]);
  });

  it('does not touch summary/wasCompacted fields (Compact SSOT)', () => {
    const ctx = mergeFeatureContext({
      userTurns: [makeTurn(1)],
      userTurnMetas: [],
      breadcrumbs: [],
    });
    // merge step produces the base shape only; §13 compactFeatureContext is
    // the sole owner of `summary` / `wasCompacted`.
    expect(ctx.summary).toBeUndefined();
    expect(ctx.wasCompacted).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildFeatureContext — adapter wiring & graceful fallback
// ─────────────────────────────────────────────────────────────────────────────

describe('buildFeatureContext — session port integration', () => {
  it('returns undefined when session port is not wired', async () => {
    const ctx = await buildFeatureContext(undefined);
    expect(ctx).toBeUndefined();
  });

  it('returns merged ctx on the happy path', async () => {
    const turns = [makeTurn(1), makeTurn(2)];
    const metas = [makeMeta('t-2', { complexity: 'oneshot' })];
    const breadcrumbs = [makeBreadcrumb(1)];

    const session = {
      loadSinceBoundary: vi
        .fn()
        .mockResolvedValue({ userTurns: turns, userTurnMetas: metas, breadcrumbs }),
    } as unknown as SessionPort;

    const ctx = await buildFeatureContext(session);

    expect(session.loadSinceBoundary).toHaveBeenCalledTimes(1);
    expect(ctx?.userTurns.map((t) => t.turnId)).toEqual(['t-1', 't-2']);
    expect((ctx?.userTurns[1] as { complexity?: unknown }).complexity).toBe('oneshot');
    expect(ctx?.breadcrumbs).toHaveLength(1);
  });

  it('falls back to an empty ctx when loadSinceBoundary throws (graceful)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const session = {
      loadSinceBoundary: vi.fn().mockRejectedValue(new Error('adapter exploded')),
    } as unknown as SessionPort;

    const ctx = await buildFeatureContext(session);

    expect(ctx).toEqual({ breadcrumbs: [], userTurns: [] });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('propagates custom breadcrumbWindow option to the merger', async () => {
    const breadcrumbs = Array.from({ length: 4 }, (_, i) => makeBreadcrumb(i + 1));
    const session = {
      loadSinceBoundary: vi
        .fn()
        .mockResolvedValue({ userTurns: [], userTurnMetas: [], breadcrumbs }),
    } as unknown as SessionPort;

    const ctx = await buildFeatureContext(session, { breadcrumbWindow: 1 });

    expect(ctx?.breadcrumbs).toHaveLength(1);
    expect(ctx?.breadcrumbs[0].turnId).toBe('t-4');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// hydrateFeatureContext — resolve SSOT (loadArtifacts + onResume parity)
// ─────────────────────────────────────────────────────────────────────────────

describe('hydrateFeatureContext — resolve helper', () => {
  it('returns undefined featureContext + turnId when session is not wired', async () => {
    const out = await hydrateFeatureContext({ session: undefined }, { jobId: 'job-1' });
    expect(out.featureContext).toBeUndefined();
    expect(out.turnId).toBeUndefined();
  });

  it('recovers turnId by matching jobId against feature.jsonl user_turns', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const turns = [makeTurn(1), makeTurn(2), makeTurn(3)];
    const session = {
      loadSinceBoundary: vi
        .fn()
        .mockResolvedValue({ userTurns: turns, userTurnMetas: [], breadcrumbs: [] }),
    } as unknown as SessionPort;

    const out = await hydrateFeatureContext(
      { session },
      { jobId: 'job-2', logPrefix: 'Test' },
    );

    expect(out.featureContext?.userTurns).toHaveLength(3);
    expect(out.turnId).toBe('t-2');
    logSpy.mockRestore();
  });

  it('returns undefined turnId when no user_turn owns the jobId (resume-with-missing-turn)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const session = {
      loadSinceBoundary: vi
        .fn()
        .mockResolvedValue({
          userTurns: [makeTurn(1)],
          userTurnMetas: [],
          breadcrumbs: [],
        }),
    } as unknown as SessionPort;

    const out = await hydrateFeatureContext(
      { session },
      { jobId: 'other-job', logPrefix: 'Test' },
    );

    expect(out.featureContext?.userTurns).toHaveLength(1);
    expect(out.turnId).toBeUndefined();
    logSpy.mockRestore();
  });

  it('skips Compact when llm/promptPort are not wired (initial loadArtifacts without LLM)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const turns = Array.from({ length: 20 }, (_, i) => makeTurn(i + 1));
    const session = {
      loadSinceBoundary: vi
        .fn()
        .mockResolvedValue({ userTurns: turns, userTurnMetas: [], breadcrumbs: [] }),
    } as unknown as SessionPort;

    const out = await hydrateFeatureContext(
      { session },
      { jobId: 'job-5', logPrefix: 'Test' },
    );

    expect(out.featureContext?.userTurns).toHaveLength(20);
    expect(out.featureContext?.wasCompacted).toBeUndefined();
    expect(out.turnId).toBe('t-5');
    logSpy.mockRestore();
  });

  it('preserves turnId even when Compact trims the owning user_turn out of the window (§13 defect 1)', async () => {
    // Scenario: feature.jsonl has 12 user_turns × 10k chars since the last
    // boundary, far above the 12k-token Compact threshold. The owning turn
    // (job-1 / t-1) is the OLDEST entry, so Compact with windowSize=6 trims
    // it out. If hydrate runs `find(jobId)` on the post-compact array, turnId
    // is lost — identical to the §12 resume-turnId defect, reintroduced via
    // the Compact path.
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const turns = Array.from({ length: 12 }, (_, i) =>
      makeTurn(i + 1, { text: 'x'.repeat(10_000) }),
    );
    const session = {
      loadSinceBoundary: vi
        .fn()
        .mockResolvedValue({ userTurns: turns, userTurnMetas: [], breadcrumbs: [] }),
    } as unknown as SessionPort;

    const llm = {
      invoke: vi.fn().mockResolvedValue('digest'),
      invokeWithUsage: vi
        .fn()
        .mockResolvedValue({ content: 'digest', usage: { inputTokens: 1, outputTokens: 1 } }),
    } as unknown as LLMClient;
    const promptPort = {
      render: vi.fn().mockResolvedValue('system prompt'),
    } as unknown as PromptPort;

    const out = await hydrateFeatureContext(
      { session, llm, promptPort },
      { jobId: 'job-1', logPrefix: 'Test' },
    );

    // featureContext was compacted to window=6 recent turns (t-7..t-12),
    // so `find(jobId === 'job-1')` on the post-compact array would return
    // undefined. turnId must still be recovered via the pre-compact lookup.
    expect(out.featureContext?.wasCompacted).toBe(true);
    expect(out.featureContext?.userTurns).toHaveLength(6);
    expect(out.featureContext?.userTurns.map((t) => t.turnId)).not.toContain('t-1');
    expect(out.turnId).toBe('t-1');
    logSpy.mockRestore();
  });

  it('propagates session loadSinceBoundary failures into an empty ctx (no turnId)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const session = {
      loadSinceBoundary: vi.fn().mockRejectedValue(new Error('boom')),
    } as unknown as SessionPort;

    const out = await hydrateFeatureContext(
      { session },
      { jobId: 'job-1', logPrefix: 'Test' },
    );

    // builder swallows the error and returns an empty ctx
    expect(out.featureContext).toEqual({ breadcrumbs: [], userTurns: [] });
    expect(out.turnId).toBeUndefined();
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });
});
