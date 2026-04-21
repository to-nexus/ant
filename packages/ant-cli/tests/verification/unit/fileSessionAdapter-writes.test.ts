/**
 * Chapter 2 (§2 `atomic_user_turn_write`) defect-fix regression coverage.
 *
 * Covers the write paths that previously had no unit tests (noted as
 * "⚠️ 검증 미완" in docs/tmp/session-redesign-handoff.md §3.2):
 *
 *  - `appendUserTurn` with and without `skipFeature`
 *  - `appendUserTurn` trace-failure policy (feature SSOT preserved, no rollback)
 *  - `appendUserTurnMeta` → loadSinceBoundary merge
 *  - `appendBoundary` collapses prior user_turn/user_turn_meta (preserves T3)
 *  - `collapseTurn` synchronises both files
 *  - `collapseAll` with new default `jobType: 'reset'` boundary + explicit override
 *  - `FileMutex` serialisation under concurrent appends
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FileSessionAdapter } from '../../../src/periphery/adapters/session/FileSessionAdapter';
import {
  getFeatureJsonlPath,
  getTraceJsonlPath,
} from '../../../src/core/utils/sessionPaths';
import type {
  FeatureUserTurnLine,
  FeatureUserTurnMetaLine,
  FeatureBoundaryLine,
  FeatureBreadcrumbLine,
  FeatureLine,
  TraceLine,
} from '@ant/shared';

async function readJsonl<T = any>(filePath: string): Promise<T[]> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return raw.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
  } catch (err: any) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

describe('FileSessionAdapter — chapter 2 write paths', () => {
  let tmpDir: string;
  let adapter: FileSessionAdapter;
  let featurePath: string;
  let tracePath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-fsa-writes-'));
    adapter = new FileSessionAdapter(tmpDir, 'architect', 'proj', 'feat');
    featurePath = getFeatureJsonlPath(tmpDir);
    tracePath = getTraceJsonlPath(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    vi.restoreAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────
  // appendUserTurn
  // ─────────────────────────────────────────────────────────────────────

  it('appendUserTurn writes to both feature.jsonl and trace.jsonl by default', async () => {
    const line: FeatureUserTurnLine = {
      type: 'user_turn',
      ts: '2026-04-20T00:00:01Z',
      jobId: 'j1',
      turnId: 't-001',
      jobType: 'code',
      text: 'hello',
      mode: 'generate',
    };
    await adapter.appendUserTurn(line);

    const featureLines = await readJsonl<FeatureLine>(featurePath);
    const traceLines = await readJsonl<TraceLine>(tracePath);

    expect(featureLines).toHaveLength(1);
    expect(featureLines[0]).toMatchObject({ type: 'user_turn', turnId: 't-001', text: 'hello' });

    expect(traceLines).toHaveLength(1);
    expect(traceLines[0]).toMatchObject({
      type: 'user_turn',
      turnId: 't-001',
      text: 'hello',
      sourceRef: 'feature.jsonl#t-001',
    });
  });

  it('appendUserTurn with skipFeature=true writes only trace.jsonl and uses ask-only sourceRef', async () => {
    const line: FeatureUserTurnLine = {
      type: 'user_turn',
      ts: '2026-04-20T00:00:02Z',
      jobId: 'j2',
      turnId: 't-ask',
      jobType: 'inline-ask',
      text: 'what is this?',
    };
    await adapter.appendUserTurn(line, { skipFeature: true });

    const featureLines = await readJsonl<FeatureLine>(featurePath);
    const traceLines = await readJsonl<TraceLine>(tracePath);

    expect(featureLines).toHaveLength(0);
    expect(traceLines).toHaveLength(1);
    expect(traceLines[0]).toMatchObject({ sourceRef: 'ask-only', turnId: 't-ask' });
  });

  it('appendUserTurn does NOT collapse feature.jsonl when trace.jsonl append fails (non-ask)', async () => {
    // Force trace.jsonl append to fail at the filesystem level by pre-creating
    // the path as a DIRECTORY — `fs.appendFile` will then raise EISDIR. This
    // avoids spying on ESM `fs/promises` exports (vitest limitation).
    await fs.mkdir(path.dirname(tracePath), { recursive: true });
    await fs.mkdir(tracePath, { recursive: true });

    const line: FeatureUserTurnLine = {
      type: 'user_turn',
      ts: '2026-04-20T00:00:03Z',
      jobId: 'j3',
      turnId: 't-trace-fail',
      jobType: 'code',
      text: 'directive',
    };

    // Should NOT throw — trace failure is logged, feature SSOT preserved.
    await expect(adapter.appendUserTurn(line)).resolves.toBeUndefined();

    const featureLines = await readJsonl<FeatureLine>(featurePath);
    expect(featureLines).toHaveLength(1);
    expect(featureLines[0]).toMatchObject({ turnId: 't-trace-fail' });
    // Critical: feature line must NOT be marked collapsed on trace failure —
    // that was the old rollback bug that created orphan meta lines.
    expect((featureLines[0] as any).collapsed).toBeUndefined();
  });

  it('appendUserTurn with skipFeature=true surfaces trace errors (ask path has no SSOT fallback)', async () => {
    // Same trick: pre-create trace.jsonl as a directory to force EISDIR.
    await fs.mkdir(path.dirname(tracePath), { recursive: true });
    await fs.mkdir(tracePath, { recursive: true });

    const line: FeatureUserTurnLine = {
      type: 'user_turn',
      ts: '2026-04-20T00:00:04Z',
      jobId: 'j4',
      turnId: 't-ask-fail',
      jobType: 'ask',
      text: 'q',
    };

    await expect(adapter.appendUserTurn(line, { skipFeature: true })).rejects.toThrow();
    expect(await readJsonl<FeatureLine>(featurePath)).toHaveLength(0);
  });

  // ─────────────────────────────────────────────────────────────────────
  // loadSinceBoundary merge
  // ─────────────────────────────────────────────────────────────────────

  it('loadSinceBoundary returns user_turn + user_turn_meta after latest boundary and ALL breadcrumbs', async () => {
    const t1: FeatureUserTurnLine = { type: 'user_turn', ts: '2026-04-20T00:00:01Z', jobId: 'j1', turnId: 't-1', jobType: 'code', text: 'one' };
    const m1: FeatureUserTurnMetaLine = { type: 'user_turn_meta', ts: '2026-04-20T00:00:02Z', jobId: 'j1', turnId: 't-1', jobType: 'code', complexity: 'oneshot', decidedBy: 'llm', reason: 'trivial' };
    const bc1: FeatureBreadcrumbLine = { type: 'breadcrumb', ts: '2026-04-20T00:00:03Z', jobId: 'j1', turnId: 't-1', jobType: 'code', scope: 'modification', summary: 'bc1', anchors: { files: ['a.ts'] }, stats: { modified: 1 } };
    const b1: FeatureBoundaryLine = { type: 'boundary', ts: '2026-04-20T00:00:04Z', jobId: 'j1', turnId: 't-1', jobType: 'code', reason: 'auto_job_complete_todo' };
    const t2: FeatureUserTurnLine = { type: 'user_turn', ts: '2026-04-20T00:00:05Z', jobId: 'j2', turnId: 't-2', jobType: 'code', text: 'two' };
    const bc2: FeatureBreadcrumbLine = { type: 'breadcrumb', ts: '2026-04-20T00:00:06Z', jobId: 'j2', turnId: 't-2', jobType: 'code', scope: 'refactor', summary: 'bc2', anchors: {}, stats: {} };

    await adapter.appendLine('feature', t1);
    await adapter.appendLine('feature', m1);
    await adapter.appendLine('feature', bc1);
    await adapter.appendLine('feature', b1);
    await adapter.appendLine('feature', t2);
    await adapter.appendLine('feature', bc2);

    const result = await adapter.loadSinceBoundary();

    expect(result.userTurns).toHaveLength(1);
    expect(result.userTurns[0].turnId).toBe('t-2');

    expect(result.userTurnMetas).toHaveLength(0); // m1 was before boundary

    expect(result.breadcrumbs).toHaveLength(2);
    expect(result.breadcrumbs.map((b) => b.summary)).toEqual(['bc1', 'bc2']);
  });

  // ─────────────────────────────────────────────────────────────────────
  // appendBoundary collapse semantics
  // ─────────────────────────────────────────────────────────────────────

  it('appendBoundary collapses prior user_turn / user_turn_meta but preserves breadcrumbs', async () => {
    const t: FeatureUserTurnLine = { type: 'user_turn', ts: '2026-04-20T00:00:01Z', jobId: 'j1', turnId: 't-1', jobType: 'code', text: 'hi' };
    const m: FeatureUserTurnMetaLine = { type: 'user_turn_meta', ts: '2026-04-20T00:00:02Z', jobId: 'j1', turnId: 't-1', jobType: 'code', complexity: 'task', decidedBy: 'llm', reason: 'multi-file' };
    const bc: FeatureBreadcrumbLine = { type: 'breadcrumb', ts: '2026-04-20T00:00:03Z', jobId: 'j1', turnId: 't-1', jobType: 'code', scope: 'modification', summary: 'kept', anchors: {}, stats: {} };

    await adapter.appendLine('feature', t);
    await adapter.appendLine('feature', m);
    await adapter.appendLine('feature', bc);

    const b: FeatureBoundaryLine = { type: 'boundary', ts: '2026-04-20T00:00:04Z', jobId: 'j1', turnId: 't-1', jobType: 'code', reason: 'auto_job_complete_todo' };
    await adapter.appendBoundary(b);

    const lines = await readJsonl<any>(featurePath);
    const byType = Object.fromEntries(
      ['user_turn', 'user_turn_meta', 'breadcrumb', 'boundary'].map((k) => [k, lines.find((l) => l.type === k)]),
    );

    expect(byType.user_turn.collapsed).toBe(true);
    expect(byType.user_turn_meta.collapsed).toBe(true);
    expect(byType.breadcrumb.collapsed).toBeUndefined();
    expect(byType.boundary.collapsed).toBeUndefined();
  });

  // ─────────────────────────────────────────────────────────────────────
  // collapseTurn (per-turn invalidation)
  // ─────────────────────────────────────────────────────────────────────

  it('collapseTurn marks matching turnId in both files', async () => {
    const a: FeatureUserTurnLine = { type: 'user_turn', ts: '2026-04-20T00:00:01Z', jobId: 'jA', turnId: 't-A', jobType: 'code', text: 'A' };
    const b: FeatureUserTurnLine = { type: 'user_turn', ts: '2026-04-20T00:00:02Z', jobId: 'jB', turnId: 't-B', jobType: 'code', text: 'B' };
    await adapter.appendUserTurn(a);
    await adapter.appendUserTurn(b);

    await adapter.collapseTurn('t-A');

    const featureLines = await readJsonl<any>(featurePath);
    const traceLines = await readJsonl<any>(tracePath);

    expect(featureLines.find((l) => l.turnId === 't-A').collapsed).toBe(true);
    expect(featureLines.find((l) => l.turnId === 't-B').collapsed).toBeUndefined();
    expect(traceLines.find((l) => l.turnId === 't-A').collapsed).toBe(true);
    expect(traceLines.find((l) => l.turnId === 't-B').collapsed).toBeUndefined();
  });

  // ─────────────────────────────────────────────────────────────────────
  // collapseAll (Hard Reset)
  // ─────────────────────────────────────────────────────────────────────

  it('collapseAll defaults boundary jobType to the agent-agnostic "reset" literal', async () => {
    const a: FeatureUserTurnLine = { type: 'user_turn', ts: '2026-04-20T00:00:01Z', jobId: 'jA', turnId: 't-A', jobType: 'design', text: 'A' };
    await adapter.appendUserTurn(a);

    await adapter.collapseAll('user_reset', 'j-reset', 't-reset');

    const featureLines = await readJsonl<any>(featurePath);
    const boundaries = featureLines.filter((l) => l.type === 'boundary');
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0].jobType).toBe('reset');
    expect(boundaries[0].reason).toBe('user_reset');

    expect(featureLines.find((l) => l.turnId === 't-A').collapsed).toBe(true);

    const traceLines = await readJsonl<any>(tracePath);
    expect(traceLines.every((l) => l.collapsed === true)).toBe(true);
  });

  it('collapseAll respects an explicit jobType override for job-scoped collapses', async () => {
    await adapter.collapseAll('user_reset', 'j-reset', 't-reset', 'code');
    const featureLines = await readJsonl<any>(featurePath);
    const boundary = featureLines.find((l) => l.type === 'boundary');
    expect(boundary.jobType).toBe('code');
  });

  // ─────────────────────────────────────────────────────────────────────
  // Concurrency — FileMutex serialises appends per file
  // ─────────────────────────────────────────────────────────────────────

  it('concurrent appendLine calls serialise cleanly (no partial/interleaved JSON lines)', async () => {
    const N = 50;
    const writes: Promise<void>[] = [];
    for (let i = 0; i < N; i++) {
      const line: FeatureUserTurnLine = {
        type: 'user_turn',
        ts: new Date(Date.UTC(2026, 3, 20, 0, 0, i)).toISOString(),
        jobId: `j${i}`,
        turnId: `t-${i}`,
        jobType: 'code',
        text: `msg ${i}`,
      };
      writes.push(adapter.appendLine('feature', line));
    }
    await Promise.all(writes);

    const raw = await fs.readFile(featurePath, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.trim() !== '');
    expect(lines).toHaveLength(N);
    // All lines parse successfully (no interleaved/truncated JSON).
    for (const l of lines) {
      expect(() => JSON.parse(l)).not.toThrow();
    }
  });
});
