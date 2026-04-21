/**
 * §19 `misclassify_guard` — feature biases append-only collector.
 *
 * Covers `recordClassification` / `readClassifications` in
 * `core/utils/featureBiases.ts`: JSONL append format, missing-file
 * handling, directive truncation, and the reader round-trip.
 *
 * SSOT for the tier-based classification: each record carries
 * `predictedTier: ExecutionTierId` (0..4).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  recordClassification,
  readClassifications,
  getFeatureBiasesPath,
  FEATURE_BIASES_FILENAME,
  aggregateClassifications,
  summarizeFeatureBiases,
  type FeatureBiasRecord,
} from '../../../src/core/utils/featureBiases';

describe('featureBiases — recordClassification', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-fbias-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it('writes a JSONL line with all required fields and default ts', async () => {
    const ok = await recordClassification({
      featurePath: tmpDir,
      jobId: 'job-1',
      predictedTier: 1,
      actualTouched: 5,
      escalated: true,
    });
    expect(ok).toBe(true);

    const raw = await fs.readFile(getFeatureBiasesPath(tmpDir), 'utf-8');
    expect(raw.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(raw.trim()) as FeatureBiasRecord;
    expect(parsed.jobId).toBe('job-1');
    expect(parsed.predictedTier).toBe(1);
    expect(parsed.actualTouched).toBe(5);
    expect(parsed.escalated).toBe(true);
    expect(typeof parsed.ts).toBe('string');
    expect(parsed.directive).toBeUndefined();
  });

  it('truncates long directives to 200 chars with ellipsis', async () => {
    const longDirective = 'x'.repeat(500);
    await recordClassification({
      featurePath: tmpDir,
      jobId: 'job-long',
      predictedTier: 3,
      actualTouched: 10,
      escalated: false,
      directive: longDirective,
    });
    const raw = await fs.readFile(getFeatureBiasesPath(tmpDir), 'utf-8');
    const parsed = JSON.parse(raw.trim()) as FeatureBiasRecord;
    expect(parsed.directive).toBeDefined();
    expect(parsed.directive!.length).toBeLessThanOrEqual(200);
    expect(parsed.directive!.endsWith('…')).toBe(true);
  });

  it('appends multiple samples as separate lines (JSONL shape)', async () => {
    await recordClassification({
      featurePath: tmpDir,
      jobId: 'j1',
      predictedTier: 1,
      actualTouched: 4,
      escalated: false,
      ts: '2026-04-20T00:00:00.000Z',
    });
    await recordClassification({
      featurePath: tmpDir,
      jobId: 'j2',
      predictedTier: 3,
      actualTouched: 20,
      escalated: true,
      ts: '2026-04-20T00:01:00.000Z',
    });

    const samples = await readClassifications(tmpDir);
    expect(samples).toHaveLength(2);
    expect(samples[0].jobId).toBe('j1');
    expect(samples[1].jobId).toBe('j2');
  });

  it('filename constant matches getFeatureBiasesPath', () => {
    expect(getFeatureBiasesPath(tmpDir)).toBe(path.join(tmpDir, FEATURE_BIASES_FILENAME));
  });
});

describe('featureBiases — readClassifications', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-fbias-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it('returns empty array when file does not exist', async () => {
    const samples = await readClassifications(tmpDir);
    expect(samples).toEqual([]);
  });

  it('skips malformed lines without throwing', async () => {
    const filePath = getFeatureBiasesPath(tmpDir);
    await fs.writeFile(
      filePath,
      '{"ts":"2026-01-01T00:00:00Z","jobId":"ok","predictedTier":0,"actualTouched":0,"escalated":false}\n' +
        'not-json\n' +
        '{"ts":"2026-01-02T00:00:00Z","jobId":"ok2","predictedTier":2,"actualTouched":3,"escalated":false}\n',
    );
    const samples = await readClassifications(tmpDir);
    expect(samples.map((s) => s.jobId)).toEqual(['ok', 'ok2']);
  });
});

describe('featureBiases — aggregateClassifications', () => {
  const base: Pick<FeatureBiasRecord, 'ts' | 'jobId'> = {
    ts: '2026-04-20T00:00:00.000Z',
    jobId: 'j',
  };

  it('counts per-tier and computes averages', () => {
    const records: FeatureBiasRecord[] = [
      { ...base, predictedTier: 1, actualTouched: 2, escalated: false },
      { ...base, predictedTier: 1, actualTouched: 4, escalated: true },
      { ...base, predictedTier: 3, actualTouched: 10, escalated: false },
    ];
    const agg = aggregateClassifications(records);
    expect(agg.total).toBe(3);
    expect(agg.byPredictedTier[1]).toBe(2);
    expect(agg.byPredictedTier[3]).toBe(1);
    expect(agg.escalatedCount).toBe(1);
    expect(agg.avgTouched).toBeCloseTo((2 + 4 + 10) / 3);
    expect(agg.avgTouchedByPredictedTier[1]).toBe(3);
    expect(agg.avgTouchedByPredictedTier[3]).toBe(10);
    expect(agg.avgTouchedByPredictedTier[0]).toBeNull();
  });

  it('returns zero counters and null averages for empty input', () => {
    const agg = aggregateClassifications([]);
    expect(agg.total).toBe(0);
    expect(agg.avgTouched).toBeNull();
    expect(agg.byPredictedTier[0]).toBe(0);
    expect(agg.timeRange).toBeNull();
  });

  it('respects since/until ts filters', () => {
    const records: FeatureBiasRecord[] = [
      { ts: '2026-01-01T00:00:00Z', jobId: 'a', predictedTier: 0, actualTouched: 0, escalated: false },
      { ts: '2026-06-01T00:00:00Z', jobId: 'b', predictedTier: 2, actualTouched: 5, escalated: false },
      { ts: '2026-12-01T00:00:00Z', jobId: 'c', predictedTier: 3, actualTouched: 9, escalated: true },
    ];
    const agg = aggregateClassifications(records, {
      since: '2026-05-01T00:00:00Z',
      until: '2026-10-01T00:00:00Z',
    });
    expect(agg.total).toBe(1);
    expect(agg.byPredictedTier[2]).toBe(1);
  });
});

describe('featureBiases — summarizeFeatureBiases integration', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-fbias-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it('reads + aggregates in one call', async () => {
    await recordClassification({
      featurePath: tmpDir,
      jobId: 'j1',
      predictedTier: 2,
      actualTouched: 5,
      escalated: true,
    });
    const agg = await summarizeFeatureBiases(tmpDir);
    expect(agg.total).toBe(1);
    expect(agg.escalatedCount).toBe(1);
    expect(agg.byPredictedTier[2]).toBe(1);
  });
});
