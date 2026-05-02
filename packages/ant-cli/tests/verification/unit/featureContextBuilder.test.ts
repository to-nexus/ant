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
  compactFeatureContext,
} from '../../../src/core/context/featureContextBuilder';
import type {
  FeatureContext,
  MergedUserTurn,
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
    executionTier: 3,
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
    const meta = makeMeta('t-1', { executionTier: 2 });

    const ctx = mergeFeatureContext({
      userTurns: [turn],
      userTurnMetas: [meta],
      breadcrumbs: [],
    });

    expect(ctx.userTurns).toHaveLength(1);
    expect(ctx.userTurns[0]).toMatchObject({
      turnId: 't-1',
      text: 'directive-1',
      executionTier: 2,
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
    expect((ctx.userTurns[0] as { executionTier?: unknown }).executionTier).toBeUndefined();
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
    const deadMeta = makeMeta('t-1', { collapsed: true, executionTier: 3 });

    const ctx = mergeFeatureContext({
      userTurns: [turn],
      userTurnMetas: [deadMeta],
      breadcrumbs: [],
    });

    expect((ctx.userTurns[0] as { executionTier?: unknown }).executionTier).toBeUndefined();
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
  it('returns ALL non-collapsed breadcrumbs by default (job-context-bridge T5)', () => {
    // Window-based trim was retired here — compactFeatureContext is the
    // single arbiter of how many BC lines reach the prompt by folding old
    // entries into the MECE summary once token budget is hit. Without an
    // explicit `breadcrumbWindow` override every live BC flows through.
    const all = Array.from({ length: 8 }, (_, i) => makeBreadcrumb(i + 1));

    const ctx = mergeFeatureContext({
      userTurns: [],
      userTurnMetas: [],
      breadcrumbs: all,
    });

    expect(ctx.breadcrumbs).toHaveLength(all.length);
    expect(ctx.breadcrumbs[0].turnId).toBe('t-1');
    expect(ctx.breadcrumbs.at(-1)?.turnId).toBe(`t-${all.length}`);
  });

  it('honours a custom breadcrumbWindow override (back-compat)', () => {
    const all = Array.from({ length: 8 }, (_, i) => makeBreadcrumb(i + 1));
    const ctx = mergeFeatureContext(
      { userTurns: [], userTurnMetas: [], breadcrumbs: all },
      { breadcrumbWindow: 2 },
    );
    expect(ctx.breadcrumbs.map((b) => b.turnId)).toEqual(['t-7', 't-8']);
  });

  it('treats window=0 as "keep none"', () => {
    const all = [makeBreadcrumb(1), makeBreadcrumb(2)];
    const ctx = mergeFeatureContext(
      { userTurns: [], userTurnMetas: [], breadcrumbs: all },
      { breadcrumbWindow: 0 },
    );
    expect(ctx.breadcrumbs).toEqual([]);
  });

  it('ignores negative window (back-compat — negative is meaningless)', () => {
    // Old behavior special-cased negative as "keep none". New semantics
    // treat negative as "no override given" so all BCs flow through;
    // compact handles overflow downstream. Callers wanting "keep none"
    // must use 0 explicitly.
    const all = [makeBreadcrumb(1), makeBreadcrumb(2)];
    const ctxNeg = mergeFeatureContext(
      { userTurns: [], userTurnMetas: [], breadcrumbs: all },
      { breadcrumbWindow: -3 },
    );
    expect(ctxNeg.breadcrumbs.map((b) => b.turnId)).toEqual(['t-1', 't-2']);
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
    const metas = [makeMeta('t-2', { executionTier: 1 })];
    const breadcrumbs = [makeBreadcrumb(1)];

    const session = {
      loadSinceBoundary: vi
        .fn()
        .mockResolvedValue({ userTurns: turns, userTurnMetas: metas, breadcrumbs }),
    } as unknown as SessionPort;

    const ctx = await buildFeatureContext(session);

    expect(session.loadSinceBoundary).toHaveBeenCalledTimes(1);
    expect(ctx?.userTurns.map((t) => t.turnId)).toEqual(['t-1', 't-2']);
    expect((ctx?.userTurns[1] as { executionTier?: unknown }).executionTier).toBe(1);
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

// ─────────────────────────────────────────────────────────────────────────────
// compactFeatureContext — same module, threshold/window/breadcrumb folding
// ─────────────────────────────────────────────────────────────────────────────

function makeMergedTurn(idx: number, userLen = 20): MergedUserTurn {
  return {
    type: 'user_turn',
    ts: `2026-04-19T00:00:${String(idx).padStart(2, '0')}.000Z`,
    jobId: `job-${idx}`,
    turnId: `t-${idx}`,
    jobType: 'code',
    text: 'x'.repeat(userLen),
  };
}

function makeMergedCtx(turns: MergedUserTurn[]): FeatureContext {
  return { breadcrumbs: [], userTurns: turns };
}

function makeCompactLLM(summary = 'digest-summary'): LLMClient {
  return {
    invoke: vi.fn().mockResolvedValue(summary),
    invokeWithUsage: vi.fn().mockResolvedValue({
      content: summary,
      usage: { inputTokens: 100, outputTokens: 50 },
    }),
  } as unknown as LLMClient;
}

function makeCompactPromptPort(): PromptPort {
  return {
    render: vi.fn().mockResolvedValue('system prompt body'),
  } as unknown as PromptPort;
}

describe('compactFeatureContext — threshold gating', () => {
  it('no-op when userTurns ≤ windowSize', async () => {
    const ctx = makeMergedCtx([makeMergedTurn(1), makeMergedTurn(2)]);
    const llm = makeCompactLLM();
    const promptPort = makeCompactPromptPort();

    const result = await compactFeatureContext(
      ctx,
      { llm, promptPort },
      { threshold: 10, windowSize: 6 },
    );

    expect(result).toBe(ctx);
    expect(result.wasCompacted).toBeUndefined();
    expect(llm.invoke).not.toHaveBeenCalled();
  });

  it('no-op when token estimate is under threshold', async () => {
    // 8 turns × 20 chars / 2.8 ≈ 57 tokens → well under 100_000
    const ctx = makeMergedCtx(Array.from({ length: 8 }, (_, i) => makeMergedTurn(i, 20)));
    const llm = makeCompactLLM();
    const promptPort = makeCompactPromptPort();

    const result = await compactFeatureContext(
      ctx,
      { llm, promptPort },
      { threshold: 100_000, windowSize: 6 },
    );

    expect(result).toBe(ctx);
    expect(result.wasCompacted).toBeUndefined();
    expect(llm.invoke).not.toHaveBeenCalled();
  });
});

describe('compactFeatureContext — active compaction', () => {
  it('keeps the most recent windowSize entries and populates summary', async () => {
    // 12 turns × 10_000 chars → far above a 12_000-token threshold
    const turns = Array.from({ length: 12 }, (_, i) => makeMergedTurn(i, 10_000));
    const ctx = makeMergedCtx(turns);
    const llm = makeCompactLLM('older-entries-digest');
    const promptPort = makeCompactPromptPort();

    const result = await compactFeatureContext(
      ctx,
      { llm, promptPort },
      { threshold: 12_000, windowSize: 6 },
    );

    expect(result.wasCompacted).toBe(true);
    expect(result.summary).toBe('older-entries-digest');
    expect(result.userTurns).toHaveLength(6);
    expect(result.userTurns.map((t) => t.turnId)).toEqual([
      't-6', 't-7', 't-8', 't-9', 't-10', 't-11',
    ]);
    expect(promptPort.render).toHaveBeenCalledWith(
      'infra/compaction/system',
      expect.objectContaining({ conversation: expect.any(String) }),
    );
  });

  it('preserves recent breadcrumbs (after window cutoff) during compaction', async () => {
    // job-context-bridge T5 — BCs at or after the kept-window cutoff
    // timestamp flow through verbatim. Earlier BCs would be folded into
    // the MECE summary as Artifacts.
    const turns = Array.from({ length: 10 }, (_, i) => makeMergedTurn(i, 10_000));
    const recentBc = {
      type: 'breadcrumb' as const,
      ts: '2026-04-19T00:10:00.000Z', // strictly after t-6 (kept window starts at t-6)
      jobId: 'job-9',
      turnId: 't-9',
      jobType: 'code' as const,
      scope: 'modification' as const,
      anchors: { files: ['a.ts'] },
      summary: 'file changed',
      stats: { touched: 1 },
    };
    const breadcrumbs = [recentBc];
    const ctx: FeatureContext = { breadcrumbs, userTurns: turns };
    const llm = makeCompactLLM();
    const promptPort = makeCompactPromptPort();

    const result = await compactFeatureContext(
      ctx,
      { llm, promptPort },
      { threshold: 12_000, windowSize: 4 },
    );

    expect(result.wasCompacted).toBe(true);
    expect(result.breadcrumbs).toEqual([recentBc]);
    expect(result.userTurns).toHaveLength(4);
  });

  it('folds old breadcrumbs (before window cutoff) into MECE summary', async () => {
    const turns = Array.from({ length: 10 }, (_, i) => makeMergedTurn(i, 10_000));
    const oldBc = {
      type: 'breadcrumb' as const,
      ts: '2026-04-19T00:00:01.000Z', // before t-6 cutoff
      jobId: 'job-1',
      turnId: 't-1',
      jobType: 'code' as const,
      scope: 'modification' as const,
      anchors: { paths: ['src/old/**'] },
      summary: 'old refactor',
      stats: { touched: 7, modified: 7 },
    };
    const recentBc = {
      type: 'breadcrumb' as const,
      ts: '2026-04-19T00:00:09.500Z', // after t-6 cutoff
      jobId: 'job-9',
      turnId: 't-9',
      jobType: 'code' as const,
      scope: 'modification' as const,
      anchors: { files: ['a.ts'] },
      summary: 'recent change',
      stats: { touched: 1 },
    };
    const ctx: FeatureContext = { breadcrumbs: [oldBc, recentBc], userTurns: turns };
    const llm = makeCompactLLM();
    const promptPort = makeCompactPromptPort();

    const result = await compactFeatureContext(
      ctx,
      { llm, promptPort },
      { threshold: 12_000, windowSize: 4 },
    );

    expect(result.wasCompacted).toBe(true);
    expect(result.breadcrumbs).toEqual([recentBc]);
    const renderArgs = (promptPort.render as any).mock.calls[0][1];
    expect(renderArgs.conversation).toContain('Artifact');
    expect(renderArgs.conversation).toContain('old refactor');
  });

  it('returns original ctx on LLM failure (graceful degradation)', async () => {
    const turns = Array.from({ length: 10 }, (_, i) => makeMergedTurn(i, 10_000));
    const ctx = makeMergedCtx(turns);
    const failingLLM = {
      invoke: vi.fn().mockRejectedValue(new Error('llm down')),
      invokeWithUsage: vi.fn().mockRejectedValue(new Error('llm down')),
    } as unknown as LLMClient;
    const promptPort = makeCompactPromptPort();

    const result = await compactFeatureContext(
      ctx,
      { llm: failingLLM, promptPort },
      { threshold: 12_000, windowSize: 4 },
    );

    expect(result).toBe(ctx);
    expect(result.wasCompacted).toBeUndefined();
    expect(result.summary).toBeUndefined();
    expect(result.userTurns).toHaveLength(10);
  });
});
