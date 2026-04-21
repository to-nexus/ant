/**
 * §19 `misclassify_guard` — feature biases append-only collector.
 *
 * Covers `recordClassification` / `readClassifications` in
 * `core/utils/featureBiases.ts`: JSONL append format, missing-file
 * handling, directive truncation, and the reader round-trip.
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
      predictedComplexity: 'oneshot',
      actualTouched: 5,
      escalated: true,
    });
    expect(ok).toBe(true);

    const raw = await fs.readFile(getFeatureBiasesPath(tmpDir), 'utf-8');
    expect(raw.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(raw.trim());
    expect(parsed.jobId).toBe('job-1');
    expect(parsed.predicted).toBe('oneshot');
    expect(parsed.actualTouched).toBe(5);
    expect(parsed.escalated).toBe(true);
    expect(typeof parsed.ts).toBe('string');
    expect(parsed.directive).toBeUndefined();
    expect(parsed.decidedBy).toBeUndefined();
  });

  it('forwards decidedBy provenance when provided', async () => {
    await recordClassification({
      featurePath: tmpDir,
      jobId: 'job-llm',
      predictedComplexity: 'task',
      decidedBy: 'llm',
      actualTouched: 7,
      escalated: false,
    });
    await recordClassification({
      featurePath: tmpDir,
      jobId: 'job-heur',
      predictedComplexity: 'oneshot',
      decidedBy: 'heuristic',
      actualTouched: 9,
      escalated: true,
    });
    const samples = await readClassifications(tmpDir);
    expect(samples.map((s) => s.decidedBy)).toEqual(['llm', 'heuristic']);
  });

  it('omits decidedBy field when provenance is unknown', async () => {
    await recordClassification({
      featurePath: tmpDir,
      jobId: 'job-unknown',
      predictedComplexity: 'task',
      actualTouched: 4,
      escalated: false,
    });
    const raw = await fs.readFile(getFeatureBiasesPath(tmpDir), 'utf-8');
    const parsed = JSON.parse(raw.trim());
    expect('decidedBy' in parsed).toBe(false);
  });

  it('appends multiple samples as separate lines (JSONL shape)', async () => {
    await recordClassification({
      featurePath: tmpDir,
      jobId: 'j1',
      predictedComplexity: 'oneshot',
      actualTouched: 4,
      escalated: false,
      ts: '2026-04-20T00:00:00.000Z',
    });
    await recordClassification({
      featurePath: tmpDir,
      jobId: 'j2',
      predictedComplexity: 'exploratory',
      actualTouched: 8,
      escalated: true,
      ts: '2026-04-20T00:00:01.000Z',
    });

    const samples = await readClassifications(tmpDir);
    expect(samples.map((s) => s.jobId)).toEqual(['j1', 'j2']);
    expect(samples.map((s) => s.predicted)).toEqual(['oneshot', 'exploratory']);
    expect(samples[0].escalated).toBe(false);
    expect(samples[1].escalated).toBe(true);
  });

  it('truncates long directives to 200 chars with ellipsis', async () => {
    const longDirective = 'x'.repeat(500);
    await recordClassification({
      featurePath: tmpDir,
      jobId: 'j-long',
      predictedComplexity: 'task',
      actualTouched: 20,
      escalated: false,
      directive: longDirective,
    });
    const [sample] = await readClassifications(tmpDir);
    expect(sample.directive).toBeDefined();
    expect(sample.directive!.length).toBe(200);
    expect(sample.directive!.endsWith('…')).toBe(true);
  });

  it('keeps only the first line of a multi-line directive', async () => {
    await recordClassification({
      featurePath: tmpDir,
      jobId: 'j-multi',
      predictedComplexity: 'oneshot',
      actualTouched: 4,
      escalated: true,
      directive: '  first line  \nsecond line\nthird',
    });
    const [sample] = await readClassifications(tmpDir);
    expect(sample.directive).toBe('first line');
  });

  it('omits directive when blank or whitespace-only', async () => {
    await recordClassification({
      featurePath: tmpDir,
      jobId: 'j-empty',
      predictedComplexity: 'task',
      actualTouched: 1,
      escalated: false,
      directive: '   \n  ',
    });
    const [sample] = await readClassifications(tmpDir);
    expect(sample.directive).toBeUndefined();
  });

  it('creates missing parent directories before appending', async () => {
    const nested = path.join(tmpDir, 'does', 'not', 'exist');
    await recordClassification({
      featurePath: nested,
      jobId: 'j-nested',
      predictedComplexity: 'oneshot',
      actualTouched: 4,
      escalated: true,
    });
    const samples = await readClassifications(nested);
    expect(samples).toHaveLength(1);
    expect(samples[0].jobId).toBe('j-nested');
  });

  it('readClassifications returns empty array when file is absent', async () => {
    const samples = await readClassifications(tmpDir);
    expect(samples).toEqual([]);
  });

  it('readClassifications skips malformed lines but returns valid ones', async () => {
    const filePath = getFeatureBiasesPath(tmpDir);
    await fs.mkdir(tmpDir, { recursive: true });
    const payload = [
      JSON.stringify({
        ts: '2026-04-20T00:00:00.000Z',
        jobId: 'ok',
        predicted: 'oneshot',
        actualTouched: 2,
        escalated: false,
      }),
      '{ not valid json',
      '',
      JSON.stringify({
        ts: '2026-04-20T00:00:01.000Z',
        jobId: 'ok2',
        predicted: 'task',
        actualTouched: 10,
        escalated: true,
      }),
    ].join('\n');
    await fs.writeFile(filePath, payload + '\n', 'utf-8');

    const samples = await readClassifications(tmpDir);
    expect(samples.map((s) => s.jobId)).toEqual(['ok', 'ok2']);
  });

  it('uses the fixed filename at the feature root', () => {
    expect(getFeatureBiasesPath('/feats/foo')).toBe(
      path.join('/feats/foo', FEATURE_BIASES_FILENAME),
    );
  });
});

describe('featureBiases — aggregateClassifications', () => {
  const baseTs = '2026-04-20T00:00:00.000Z';
  const later = '2026-04-20T12:00:00.000Z';
  const latest = '2026-04-21T00:00:00.000Z';

  const sample = (
    partial: Partial<FeatureBiasRecord> & Pick<FeatureBiasRecord, 'predicted'>,
  ): FeatureBiasRecord => ({
    ts: partial.ts ?? baseTs,
    jobId: partial.jobId ?? 'job-x',
    predicted: partial.predicted,
    decidedBy: partial.decidedBy,
    actualTouched: partial.actualTouched ?? 0,
    escalated: partial.escalated ?? false,
    directive: partial.directive,
  });

  it('returns zero-initialised buckets for an empty record set', () => {
    const agg = aggregateClassifications([]);
    expect(agg.total).toBe(0);
    expect(agg.byPredicted).toEqual({ oneshot: 0, exploratory: 0, task: 0 });
    expect(agg.byDecidedBy).toEqual({ llm: 0, heuristic: 0, user: 0, unknown: 0 });
    expect(agg.crossTab).toEqual({});
    expect(agg.escalatedCount).toBe(0);
    expect(agg.avgTouched).toBeNull();
    expect(agg.avgTouchedByPredicted).toEqual({ oneshot: null, exploratory: null, task: null });
    expect(agg.escalationRateByDecidedBy).toEqual({ llm: null, heuristic: null, user: null, unknown: null });
    expect(agg.timeRange).toBeNull();
  });

  it('counts predicted / decidedBy / cross-tab across mixed records', () => {
    const agg = aggregateClassifications([
      sample({ predicted: 'oneshot', decidedBy: 'llm', actualTouched: 2, ts: baseTs }),
      sample({ predicted: 'oneshot', decidedBy: 'llm', actualTouched: 6, escalated: true, ts: later }),
      sample({ predicted: 'task', decidedBy: 'heuristic', actualTouched: 4, ts: later }),
      sample({ predicted: 'exploratory', actualTouched: 8, escalated: true, ts: latest }),
    ]);
    expect(agg.total).toBe(4);
    expect(agg.byPredicted).toEqual({ oneshot: 2, exploratory: 1, task: 1 });
    expect(agg.byDecidedBy).toEqual({ llm: 2, heuristic: 1, user: 0, unknown: 1 });
    expect(agg.crossTab).toEqual({
      'oneshot/llm': 2,
      'task/heuristic': 1,
      'exploratory/unknown': 1,
    });
    expect(agg.escalatedCount).toBe(2);
  });

  it('computes per-bucket escalation rates with null for empty buckets', () => {
    const agg = aggregateClassifications([
      sample({ predicted: 'oneshot', decidedBy: 'llm', escalated: true }),
      sample({ predicted: 'oneshot', decidedBy: 'llm', escalated: false }),
      sample({ predicted: 'task', decidedBy: 'heuristic', escalated: false }),
    ]);
    expect(agg.escalationRateByDecidedBy.llm).toBeCloseTo(0.5, 5);
    expect(agg.escalationRateByDecidedBy.heuristic).toBe(0);
    expect(agg.escalationRateByDecidedBy.user).toBeNull();
    expect(agg.escalationRateByDecidedBy.unknown).toBeNull();
  });

  it('computes avgTouched overall and per-predicted (null when bucket empty)', () => {
    const agg = aggregateClassifications([
      sample({ predicted: 'oneshot', actualTouched: 2 }),
      sample({ predicted: 'oneshot', actualTouched: 6 }),
      sample({ predicted: 'task', actualTouched: 10 }),
    ]);
    expect(agg.avgTouched).toBeCloseTo((2 + 6 + 10) / 3, 5);
    expect(agg.avgTouchedByPredicted.oneshot).toBeCloseTo(4, 5);
    expect(agg.avgTouchedByPredicted.task).toBe(10);
    expect(agg.avgTouchedByPredicted.exploratory).toBeNull();
  });

  it('reports timeRange from min/max ts across all buckets', () => {
    const agg = aggregateClassifications([
      sample({ predicted: 'task', ts: later }),
      sample({ predicted: 'oneshot', ts: baseTs }),
      sample({ predicted: 'exploratory', ts: latest }),
    ]);
    expect(agg.timeRange).toEqual({ from: baseTs, to: latest });
  });

  it('applies since / until filters before aggregating', () => {
    const agg = aggregateClassifications(
      [
        sample({ predicted: 'oneshot', ts: baseTs }),
        sample({ predicted: 'task', ts: later }),
        sample({ predicted: 'exploratory', ts: latest, escalated: true }),
      ],
      { since: later, until: latest },
    );
    expect(agg.total).toBe(2);
    expect(agg.byPredicted).toEqual({ oneshot: 0, exploratory: 1, task: 1 });
    expect(agg.escalatedCount).toBe(1);
  });

  it('applies jobIds allow-list', () => {
    const agg = aggregateClassifications(
      [
        sample({ predicted: 'oneshot', jobId: 'a' }),
        sample({ predicted: 'task', jobId: 'b' }),
        sample({ predicted: 'exploratory', jobId: 'c' }),
      ],
      { jobIds: ['a', 'c'] },
    );
    expect(agg.total).toBe(2);
    expect(agg.byPredicted.oneshot).toBe(1);
    expect(agg.byPredicted.exploratory).toBe(1);
    expect(agg.byPredicted.task).toBe(0);
  });
});

describe('featureBiases — summarizeFeatureBiases', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-fbias-sum-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it('returns zero-state summary when no samples exist', async () => {
    const agg = await summarizeFeatureBiases(tmpDir);
    expect(agg.total).toBe(0);
    expect(agg.timeRange).toBeNull();
  });

  it('reads persisted samples and produces a matching histogram', async () => {
    await recordClassification({
      featurePath: tmpDir,
      jobId: 'j-llm-esc',
      predictedComplexity: 'oneshot',
      decidedBy: 'llm',
      actualTouched: 5,
      escalated: true,
      ts: '2026-04-20T00:00:00.000Z',
    });
    await recordClassification({
      featurePath: tmpDir,
      jobId: 'j-heur',
      predictedComplexity: 'task',
      decidedBy: 'heuristic',
      actualTouched: 2,
      escalated: false,
      ts: '2026-04-20T00:00:01.000Z',
    });

    const agg = await summarizeFeatureBiases(tmpDir);
    expect(agg.total).toBe(2);
    expect(agg.byDecidedBy.llm).toBe(1);
    expect(agg.byDecidedBy.heuristic).toBe(1);
    expect(agg.escalationRateByDecidedBy.llm).toBe(1);
    expect(agg.escalationRateByDecidedBy.heuristic).toBe(0);
    expect(agg.timeRange).toEqual({
      from: '2026-04-20T00:00:00.000Z',
      to: '2026-04-20T00:00:01.000Z',
    });
  });
});
