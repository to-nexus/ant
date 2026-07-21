/**
 * P2 — Context Lens bands + projection (e2-humming-spindle).
 *
 * mergeFeatureContext builds uncapped exchanges/digests (band sources);
 * projectLens applies per-node profile caps and the demotion rules.
 */

import { describe, it, expect } from 'vitest';
import { mergeFeatureContext } from '../../src/core/context/featureContextBuilder';
import { projectLens } from '../../src/core/context/lensProjection';
import { CONTEXT_PROFILES, contextProfileFor } from '../../src/core/executionTier/contextProfile';

let seq = 0;
function ts(): string {
  seq += 1;
  return `2026-07-21T00:${String(Math.floor(seq / 60)).padStart(2, '0')}:${String(seq % 60).padStart(2, '0')}.000Z`;
}

function turn(turnId: string, text: string, extra: Record<string, unknown> = {}) {
  return { type: 'user_turn', ts: ts(), jobId: `job-${turnId}`, turnId, jobType: 'design', text, ...extra } as any;
}
function assistantTurn(turnId: string, finalText: string, extra: Record<string, unknown> = {}) {
  return {
    type: 'assistant_turn', ts: ts(), jobId: `job-${turnId}`, turnId, jobType: 'design',
    finalText, ...extra,
  } as any;
}
function bc(turnId: string, files: string[]) {
  return {
    type: 'breadcrumb', ts: ts(), jobId: `job-${turnId}`, turnId, jobType: 'design',
    scope: 'modification', anchors: { files }, summary: `bc-${turnId}`, stats: {},
  } as any;
}

describe('mergeFeatureContext — lens bands', () => {
  it('pairs user turns with assistant_turns and per-turn breadcrumb anchors', () => {
    const ctx = mergeFeatureContext({
      userTurns: [turn('t1', 'make a spec')],
      userTurnMetas: [],
      breadcrumbs: [bc('t1', ['architecture/spec/x.md'])],
      assistantTurns: [assistantTurn('t1', 'Spec written.', {
        digest: { decisions: ['use option B'], constraints: [], outcome: 'spec authored' },
      })],
    });

    expect(ctx.exchanges).toHaveLength(1);
    expect(ctx.exchanges![0].assistantFinalText).toBe('Spec written.');
    expect(ctx.exchanges![0].anchors).toEqual({ files: ['architecture/spec/x.md'] });
    expect(ctx.digests).toHaveLength(1);
    expect(ctx.digests![0].digest.decisions).toEqual(['use option B']);
  });

  it('ephemeral turns never enter band 2 and carry the flag on their exchange', () => {
    const ctx = mergeFeatureContext({
      userTurns: [turn('t1', 'what changed?', { ephemeral: true })],
      userTurnMetas: [],
      breadcrumbs: [],
      assistantTurns: [assistantTurn('t1', 'You changed X.', {
        ephemeral: true,
        digest: { decisions: [], constraints: [], outcome: 'answered' },
      })],
    });

    expect(ctx.exchanges![0].ephemeral).toBe(true);
    expect(ctx.digests).toHaveLength(0);
  });
});

describe('projectLens', () => {
  function ctxWithN(n: number, opts: { ephemeralAt?: number[] } = {}) {
    const userTurns = [];
    const assistantTurns = [];
    for (let i = 1; i <= n; i++) {
      const eph = opts.ephemeralAt?.includes(i);
      userTurns.push(turn(`t${i}`, `directive ${i}`, eph ? { ephemeral: true } : {}));
      assistantTurns.push(assistantTurn(`t${i}`, `answer ${i}`, {
        ...(eph ? { ephemeral: true } : {}),
        digest: { decisions: [`d${i}`], constraints: [], outcome: `o${i}` },
      }));
    }
    return mergeFeatureContext({ userTurns, userTurnMetas: [], breadcrumbs: [], assistantTurns });
  }

  it('standard keeps the trailing K=3 exchanges and older digests without double-injection', () => {
    const lens = projectLens(ctxWithN(6), CONTEXT_PROFILES.standard)!;

    expect(lens.exchanges.map((e) => e.turnId)).toEqual(['t4', 't5', 't6']);
    // Band 2 renders only turns NOT in band 1.
    expect(lens.digests.map((d) => d.turnId)).toEqual(['t1', 't2', 't3']);
  });

  it('drops ephemeral exchanges first when trimming to K', () => {
    // 5 exchanges, K=3; t4 is ephemeral and NEWER than t2/t3 — it still
    // drops before them (ephemeral demotes first regardless of age).
    const lens = projectLens(ctxWithN(5, { ephemeralAt: [4] }), CONTEXT_PROFILES.standard)!;

    expect(lens.exchanges.map((e) => e.turnId)).toEqual(['t2', 't3', 't5']);
  });

  it('lean strips assistant prose and keeps at most 1 digest', () => {
    const lens = projectLens(ctxWithN(8), CONTEXT_PROFILES.lean)!;

    expect(lens.exchanges).toHaveLength(6);
    expect(lens.exchanges.every((e) => e.assistantFinalText === undefined)).toBe(true);
    expect(lens.digests).toHaveLength(1);
    expect(lens.digests[0].turnId).toBe('t2'); // most recent non-band-1 digest
  });

  it('rich caps assistant prose per exchange keeping the tail', () => {
    const ctx = mergeFeatureContext({
      userTurns: [turn('t1', 'q')],
      userTurnMetas: [],
      breadcrumbs: [],
      assistantTurns: [assistantTurn('t1', `${'x'.repeat(4000)}THE-END`)],
    });
    const lens = projectLens(ctx, CONTEXT_PROFILES.rich)!;

    expect(lens.exchanges[0].assistantFinalText).toContain('THE-END');
    expect(lens.exchanges[0].assistantFinalText!.length).toBeLessThan(1800);
  });

  it('returns undefined on empty context', () => {
    expect(projectLens(undefined, CONTEXT_PROFILES.rich)).toBeUndefined();
    expect(
      projectLens({ breadcrumbs: [], userTurns: [], exchanges: [], digests: [] }, CONTEXT_PROFILES.rich),
    ).toBeUndefined();
  });
});

describe('contextProfileFor — II-3 matrix', () => {
  it('triage/detect are lean, direct rich, decompose standard, plan tier-dependent', () => {
    expect(contextProfileFor('triage').name).toBe('lean');
    expect(contextProfileFor('detect', 3 as any).name).toBe('lean');
    expect(contextProfileFor('direct', 0 as any).name).toBe('rich');
    expect(contextProfileFor('decompose').name).toBe('standard');
    expect(contextProfileFor('plan', 2 as any).name).toBe('standard');
    expect(contextProfileFor('plan', 3 as any).name).toBe('standard');
    expect(contextProfileFor('plan', 4 as any).name).toBe('lean');
  });
});
