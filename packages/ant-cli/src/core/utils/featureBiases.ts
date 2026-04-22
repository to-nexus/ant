/**
 * Feature Biases — Misclassification signal collector (Phase E / §19).
 *
 * Observability-only helper: accumulates samples into
 * `{featurePath}/featureBiases.jsonl` whenever the learn node detects a
 * potential execution-tier misclassification signal (runtime escalation
 * fired or the touched-file count exceeded PROMOTION_TOUCHED_THRESHOLD).
 *
 * Storage shape: append-only JSONL, one record per line:
 *   { ts, jobId, predictedTier, actualTouched, escalated, directive? }
 *
 * JSONL is used instead of a JSON array so each write is a single
 * `fs.appendFile` call — atomic at the OS level for small records and
 * free of read-modify-write races between concurrent workers. This
 * mirrors the feature.jsonl / chat.jsonl convention in the session
 * layer.
 *
 * Reader-side consumers intentionally aggregate only on the predicted
 * tier; a follow-up heuristic / overrule plan builds on these samples.
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import type { ExecutionTierId } from '@ant/shared';

export const FEATURE_BIASES_FILENAME = 'featureBiases.jsonl';

export interface FeatureBiasRecord {
  /** ISO 8601 timestamp of the sample. */
  ts: string;
  /** job that produced the sample (source of predicted/actual). */
  jobId: string;
  /** Execution tier predicted by the Tier Entry Node at the start of the job. */
  predictedTier: ExecutionTierId;
  /** Observed touched-file count (chat.jsonl file_write SSOT). */
  actualTouched: number;
  /** Whether the direct → decompose runtime escalation fired. */
  escalated: boolean;
  /**
   * Optional one-line directive preview for analyst context. Trimmed
   * to 200 chars to keep the file compact; full directive lives in
   * feature.jsonl and can be joined later by jobId/turnId.
   */
  directive?: string;
}

export interface RecordClassificationInput {
  featurePath: string;
  jobId: string;
  predictedTier: ExecutionTierId;
  actualTouched: number;
  escalated: boolean;
  directive?: string;
  /** Override for tests; defaults to `new Date().toISOString()`. */
  ts?: string;
}

function truncateDirective(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const firstLine = raw.split(/\r?\n/)[0] ?? '';
  const trimmed = firstLine.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.length > 200 ? `${trimmed.slice(0, 199)}…` : trimmed;
}

/**
 * Resolve the path to featureBiases.jsonl for a given feature directory.
 * Exported so tests can point the reader at the exact file.
 */
export function getFeatureBiasesPath(featurePath: string): string {
  return path.join(featurePath, FEATURE_BIASES_FILENAME);
}

/**
 * Append a single classification sample. Safe to call concurrently — each
 * append is an atomic OS-level write; the only shared resource is the
 * destination path.
 *
 * Failures (permission / path issues) are wrapped with a warning and
 * swallowed so the learn node never aborts a job for observability data.
 *
 * Returns `true` when the record was persisted, `false` on swallowed
 * failure. Callers can use the return value to avoid logging a
 * misleading "recorded" message when the write actually failed.
 */
export async function recordClassification(
  input: RecordClassificationInput,
): Promise<boolean> {
  const record: FeatureBiasRecord = {
    ts: input.ts ?? new Date().toISOString(),
    jobId: input.jobId,
    predictedTier: input.predictedTier,
    actualTouched: input.actualTouched,
    escalated: input.escalated,
  };
  const directive = truncateDirective(input.directive);
  if (directive) record.directive = directive;

  const filePath = getFeatureBiasesPath(input.featurePath);
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, JSON.stringify(record) + '\n', 'utf-8');
    return true;
  } catch (err) {
    console.warn(
      `⚠️  [featureBiases] failed to append sample at ${filePath}:`,
      err,
    );
    return false;
  }
}

/**
 * Read all recorded samples. Intentionally kept tiny — the writer side is
 * the SSOT for §19; aggregation consumers layer on top via
 * `aggregateClassifications` / `summarizeFeatureBiases`.
 *
 * Missing file → empty array. Malformed lines are skipped with a warning.
 */
export async function readClassifications(
  featurePath: string,
): Promise<FeatureBiasRecord[]> {
  const filePath = getFeatureBiasesPath(featurePath);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch (err: any) {
    if (err?.code === 'ENOENT') return [];
    throw err;
  }

  const out: FeatureBiasRecord[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as FeatureBiasRecord;
      out.push(parsed);
    } catch {
      console.warn(
        `⚠️  [featureBiases] skipping malformed line in ${filePath}`,
      );
    }
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════
// Aggregation reader — histogram input for the follow-up heuristic plan.
// ════════════════════════════════════════════════════════════════════════

const TIER_IDS: readonly ExecutionTierId[] = [0, 1, 2, 3, 4] as const;

export interface AggregateClassifications {
  /** Total records considered (post-filter). */
  total: number;
  /** Count per predicted tier. */
  byPredictedTier: Record<ExecutionTierId, number>;
  /** Number of samples with `escalated === true`. */
  escalatedCount: number;
  /** Average touched-file count (overall). `null` when total === 0. */
  avgTouched: number | null;
  /**
   * Average touched-file count per predicted tier. `null` for
   * buckets with zero samples.
   */
  avgTouchedByPredictedTier: Record<ExecutionTierId, number | null>;
  /** Earliest / latest record `ts` observed (ISO 8601), or null when empty. */
  timeRange: { from: string; to: string } | null;
}

export interface AggregateOptions {
  /** Inclusive lower bound on record.ts (ISO 8601). */
  since?: string;
  /** Inclusive upper bound on record.ts (ISO 8601). */
  until?: string;
  /**
   * Optional jobId allow-list. Useful for scoping a histogram to one
   * session without having to re-read the file.
   */
  jobIds?: string[];
}

function zeroTierCounter(): Record<ExecutionTierId, number> {
  return { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
}

/**
 * Pure aggregator — stable / deterministic given the same input.
 */
export function aggregateClassifications(
  records: FeatureBiasRecord[],
  opts: AggregateOptions = {},
): AggregateClassifications {
  const jobIdSet = opts.jobIds?.length ? new Set(opts.jobIds) : undefined;
  const filtered = records.filter((r) => {
    if (opts.since && r.ts < opts.since) return false;
    if (opts.until && r.ts > opts.until) return false;
    if (jobIdSet && !jobIdSet.has(r.jobId)) return false;
    return true;
  });

  const byPredictedTier = zeroTierCounter();
  const touchedSumByTier = zeroTierCounter();

  let escalatedCount = 0;
  let touchedSum = 0;
  let minTs: string | undefined;
  let maxTs: string | undefined;

  for (const r of filtered) {
    byPredictedTier[r.predictedTier] += 1;
    touchedSumByTier[r.predictedTier] += r.actualTouched;
    touchedSum += r.actualTouched;
    if (r.escalated) escalatedCount += 1;
    if (!minTs || r.ts < minTs) minTs = r.ts;
    if (!maxTs || r.ts > maxTs) maxTs = r.ts;
  }

  const total = filtered.length;

  const avgTouchedByPredictedTier: Record<ExecutionTierId, number | null> = {
    0: null, 1: null, 2: null, 3: null, 4: null,
  };
  for (const t of TIER_IDS) {
    const n = byPredictedTier[t];
    avgTouchedByPredictedTier[t] = n > 0 ? touchedSumByTier[t] / n : null;
  }

  return {
    total,
    byPredictedTier,
    escalatedCount,
    avgTouched: total > 0 ? touchedSum / total : null,
    avgTouchedByPredictedTier,
    timeRange: minTs && maxTs ? { from: minTs, to: maxTs } : null,
  };
}

/**
 * Convenience wrapper: read + aggregate in one call.
 */
export async function summarizeFeatureBiases(
  featurePath: string,
  opts: AggregateOptions = {},
): Promise<AggregateClassifications> {
  const records = await readClassifications(featurePath);
  return aggregateClassifications(records, opts);
}
