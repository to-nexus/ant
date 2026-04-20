/**
 * §19 Integration — Decompose → Learn → featureBiases chain.
 *
 * Exercises the full observability contract end-to-end at the seams:
 *
 *   decompose.responseParser.parseLLMResponse(...)            // classify
 *     ↓ (complexity, complexityDecidedBy propagated on state)
 *   FileSessionAdapter.appendUserTurn / appendUserTurnMeta    // feature.jsonl
 *   FileSessionAdapter.appendLine('trace', file_write × N)    // trace.jsonl
 *     ↓
 *   learn.recordClassificationBias(state)                      // §19 write
 *     ↓
 *   featureBiases.summarizeFeatureBiases / aggregate          // §F2 reader
 *
 * The goal is to catch regressions that unit tests miss:
 *   - `complexityDecidedBy` silently dropped between parser → state → writer
 *   - featureBiases schema drift (predicted / decidedBy / actualTouched)
 *   - trace.jsonl turnId mismatch causing touched = 0
 *   - I/O dedup in learn accidentally skipping the bias call
 *
 * The test deliberately calls `recordClassificationBias` directly — the
 * full `learn()` node has many async side-effects (quality report, lesson
 * memory store, kanban update, git branch naming) that are irrelevant
 * here and would need mocks that drift over time. The exported helper
 * is the seam closest to the observability contract.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

import { parseLLMResponse } from '../../../src/agents/architect/graph/code/nodes/decompose/responseParser';
import { recordClassificationBias } from '../../../src/agents/architect/graph/code/nodes/learn/index';
import {
  readClassifications,
  aggregateClassifications,
} from '../../../src/core/utils/featureBiases';
import { FileSessionAdapter } from '../../../src/periphery/adapters/session/FileSessionAdapter';
import type { TraceFileWriteLine, FeatureUserTurnLine, FeatureUserTurnMetaLine } from '@ant/shared';

function buildLLMResponse(opts: {
  complexityTag?: 'oneshot' | 'exploratory' | 'todo' | null;
}): string {
  const complexityBlock =
    opts.complexityTag === null
      ? ''
      : `<complexity>${opts.complexityTag}</complexity>`;
  return [
    '<tasks>[{"id":"t1","name":"Do the thing","type":"feature","priority":1000,"description":"x"}]</tasks>',
    '<techTier>{"stack":"node","language":"typescript"}</techTier>',
    complexityBlock,
  ]
    .filter(Boolean)
    .join('\n');
}

function makeState(overrides: {
  featurePath: string;
  session: FileSessionAdapter;
  complexity: 'oneshot' | 'exploratory' | 'todo';
  complexityDecidedBy: 'llm' | 'heuristic';
  jobId?: string;
  turnId?: string;
  directive?: string;
  escalated?: boolean;
}) {
  return {
    jobId: overrides.jobId ?? 'job-int-1',
    turnId: overrides.turnId ?? 't-abcd1234',
    complexity: overrides.complexity,
    complexityDecidedBy: overrides.complexityDecidedBy,
    directive: overrides.directive ?? 'Add feature X',
    context: {
      featurePath: overrides.featurePath,
      project: 'proj',
      featureFolder: 'feat',
      workingDir: overrides.featurePath,
    },
    deps: { session: overrides.session },
    _promotedThisJob: overrides.escalated ?? false,
    needsEscalation: overrides.escalated ?? false,
  } as any;
}

async function seedFileWrites(
  session: FileSessionAdapter,
  turnId: string,
  paths: string[],
): Promise<void> {
  for (let i = 0; i < paths.length; i++) {
    const line: TraceFileWriteLine = {
      type: 'file_write',
      ts: new Date(Date.UTC(2026, 3, 20, 0, 0, i)).toISOString(),
      jobId: 'job-int-1',
      turnId,
      jobType: 'code',
      path: paths[i],
      operation: i === 0 ? 'create' : 'update',
    };
    await session.appendLine('trace', line);
  }
}

describe('§19 integration — decompose → learn → featureBiases chain', () => {
  let tmpDir: string;
  let session: FileSessionAdapter;

  beforeEach(async () => {
    // FileSessionAdapter derives projectId / featureName by finding a
    // `features` segment in the path — give it one so the adapter settles
    // on stable ids and trace/feature writes land under tmpDir.
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-int-'));
    const featurePath = path.join(tmpDir, 'proj', 'features', 'feat');
    await fs.mkdir(featurePath, { recursive: true });
    session = new FileSessionAdapter(featurePath, 'architect', 'proj', 'feat');
    tmpDir = featurePath; // rebind for assertions below
  });

  afterEach(async () => {
    // Walk up to the mkdtemp root when cleaning up.
    const root = path.resolve(tmpDir, '..', '..', '..');
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  });

  it('llm-decided oneshot with many touched files → bias record with decidedBy=llm, escalated=false', async () => {
    // 1. Decompose parses LLM response → propagates complexity + provenance.
    const parsed = parseLLMResponse(buildLLMResponse({ complexityTag: 'oneshot' }));
    expect(parsed.complexity).toBe('oneshot');
    expect(parsed.complexityDecidedBy).toBe('llm');

    // 2. Orchestrator-side appendUserTurn + decompose's user_turn_meta patch.
    //    Covers the §18 provenance circuit so the full feature.jsonl shape
    //    is realistic even though recordClassificationBias only reads trace.
    const turnId = 't-int-llm';
    const userTurn: FeatureUserTurnLine = {
      type: 'user_turn',
      ts: new Date('2026-04-20T00:00:00Z').toISOString(),
      jobId: 'job-int-1',
      turnId,
      jobType: 'code',
      text: 'Add feature X',
    };
    await session.appendUserTurn(userTurn);
    const meta: FeatureUserTurnMetaLine = {
      type: 'user_turn_meta',
      ts: new Date('2026-04-20T00:00:01Z').toISOString(),
      jobId: 'job-int-1',
      turnId,
      jobType: 'code',
      complexity: parsed.complexity,
      decidedBy: parsed.complexityDecidedBy,
    };
    await session.appendUserTurnMeta(meta);

    // 3. Tool handlers emit file_write trace lines (5 files → exceeds
    //    PROMOTION_TOUCHED_THRESHOLD=3 → bias MUST record even without escalation).
    await seedFileWrites(session, turnId, [
      'src/a.ts',
      'src/b.ts',
      'src/c.ts',
      'src/d.ts',
      'src/e.ts',
    ]);

    // 4. Learn writes the bias sample via the exported helper.
    const state = makeState({
      featurePath: tmpDir,
      session,
      complexity: parsed.complexity,
      complexityDecidedBy: parsed.complexityDecidedBy,
      turnId,
      directive: 'Add feature X',
      escalated: false,
    });
    await recordClassificationBias(state);

    // 5. Aggregator sees one record with provenance intact.
    const records = await readClassifications(tmpDir);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      jobId: 'job-int-1',
      predicted: 'oneshot',
      decidedBy: 'llm',
      actualTouched: 5,
      escalated: false,
      directive: 'Add feature X',
    });

    const agg = aggregateClassifications(records);
    expect(agg.total).toBe(1);
    expect(agg.byPredicted.oneshot).toBe(1);
    expect(agg.byDecidedBy.llm).toBe(1);
    expect(agg.crossTab['oneshot/llm']).toBe(1);
    expect(agg.escalationRateByDecidedBy.llm).toBe(0);
    expect(agg.avgTouchedByPredicted.oneshot).toBe(5);
  });

  it('heuristic fallback (no <complexity> tag) with escalation → decidedBy=heuristic, escalated=true', async () => {
    // LLM omitted the tag entirely → parser falls back to 'todo' with
    // decidedBy='heuristic'. Represents a degraded classification that
    // MUST still flow through to featureBiases (otherwise aggregation
    // readers can't distinguish heuristic drift from LLM drift).
    const parsed = parseLLMResponse(buildLLMResponse({ complexityTag: null }));
    expect(parsed.complexity).toBe('todo');
    expect(parsed.complexityDecidedBy).toBe('heuristic');

    const turnId = 't-int-heur';
    await seedFileWrites(session, turnId, ['src/x.ts', 'src/y.ts']);

    const state = makeState({
      featurePath: tmpDir,
      session,
      complexity: parsed.complexity,
      complexityDecidedBy: parsed.complexityDecidedBy,
      turnId,
      escalated: true,
    });
    await recordClassificationBias(state);

    const records = await readClassifications(tmpDir);
    expect(records).toHaveLength(1);
    expect(records[0].decidedBy).toBe('heuristic');
    expect(records[0].escalated).toBe(true);

    const agg = aggregateClassifications(records);
    expect(agg.escalationRateByDecidedBy.heuristic).toBe(1);
    expect(agg.escalationRateByDecidedBy.llm).toBeNull();
  });

  it('low touched + no escalation → no record written (recordClassificationBias gate)', async () => {
    // Below threshold and no escalation → gate should skip the write so
    // featureBiases.jsonl stays absent. Protects against over-sampling
    // on normal runs.
    const turnId = 't-int-quiet';
    await seedFileWrites(session, turnId, ['src/a.ts', 'src/b.ts']);

    const state = makeState({
      featurePath: tmpDir,
      session,
      complexity: 'oneshot',
      complexityDecidedBy: 'llm',
      turnId,
      escalated: false,
    });
    await recordClassificationBias(state);

    const records = await readClassifications(tmpDir);
    expect(records).toEqual([]);
  });

  it('skips cleanly when featurePath / turnId missing (early gate)', async () => {
    // Tests the guard clause — callers may pass partial state during
    // resume / worker context; the bias writer must not throw, not
    // create an empty file either.
    const state = makeState({
      featurePath: '', // cleared
      session,
      complexity: 'oneshot',
      complexityDecidedBy: 'llm',
    }) as any;
    state.context.featurePath = '';
    await recordClassificationBias(state);

    const stats = await fs
      .stat(path.join(tmpDir, 'featureBiases.jsonl'))
      .catch(() => null);
    expect(stats).toBeNull();
  });

  it('aggregator cross-tab captures mixed provenance after successive runs', async () => {
    // Two job runs on the same feature: first llm-oneshot (escalated),
    // second heuristic-todo (not escalated). The reader MUST surface
    // both in crossTab so the downstream heuristic plan can weight them.
    const t1 = 't-int-mix1';
    const t2 = 't-int-mix2';
    await seedFileWrites(session, t1, ['a.ts', 'b.ts', 'c.ts', 'd.ts']);
    await seedFileWrites(session, t2, ['e.ts', 'f.ts', 'g.ts', 'h.ts', 'i.ts']);

    await recordClassificationBias(
      makeState({
        featurePath: tmpDir,
        session,
        complexity: 'oneshot',
        complexityDecidedBy: 'llm',
        jobId: 'job-mix-1',
        turnId: t1,
        escalated: true,
      }),
    );
    await recordClassificationBias(
      makeState({
        featurePath: tmpDir,
        session,
        complexity: 'todo',
        complexityDecidedBy: 'heuristic',
        jobId: 'job-mix-2',
        turnId: t2,
        escalated: false,
      }),
    );

    const records = await readClassifications(tmpDir);
    expect(records.map((r) => r.jobId)).toEqual(['job-mix-1', 'job-mix-2']);

    const agg = aggregateClassifications(records);
    expect(agg.total).toBe(2);
    expect(agg.crossTab).toEqual({ 'oneshot/llm': 1, 'todo/heuristic': 1 });
    expect(agg.escalationRateByDecidedBy.llm).toBe(1);
    expect(agg.escalationRateByDecidedBy.heuristic).toBe(0);
    expect(agg.avgTouchedByPredicted.oneshot).toBe(4);
    expect(agg.avgTouchedByPredicted.todo).toBe(5);
  });
});
