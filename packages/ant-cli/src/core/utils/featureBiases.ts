/**
 * Feature Biases — Misclassification signal collector (Phase E / §19).
 *
 * Observability-only helper: accumulates samples into
 * `{featurePath}/featureBiases.jsonl` whenever the learn node detects a
 * potential complexity-misclassification signal (runtime escalation fired
 * or the touched-file count exceeded PROMOTION_TOUCHED_THRESHOLD).
 *
 * Storage shape: append-only JSONL, one record per line:
 *   { ts, jobId, predicted, decidedBy?, actualTouched, escalated, directive? }
 *
 * `decidedBy` mirrors the `user_turn_meta` patch written by decompose
 * (see `responseParser.ts` — "Consumers writing user_turn_meta patches
 * MUST forward this value so the UI tier badge and featureBiases sample
 * can distinguish LLM judgements from degraded fallbacks"). Keeping the
 * provenance in the bias record itself avoids forcing aggregation
 * readers to join with feature.jsonl (which may be Collapsed) by
 * turnId.
 *
 * JSONL is used instead of a JSON array so each write is a single
 * `fs.appendFile` call — atomic at the OS level for small records and
 * free of read-modify-write races between concurrent workers. This
 * mirrors the feature.jsonl / trace.jsonl convention in the session
 * layer.
 *
 * Reader-side consumers are deliberately NOT implemented in this todo
 * (see handoff §19 — "데이터 수집만"). A follow-up heuristic / overrule
 * plan will aggregate these samples.
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import type { Complexity, DecidedBy } from '@ant/shared';

export const FEATURE_BIASES_FILENAME = 'featureBiases.jsonl';

export interface FeatureBiasRecord {
  /** ISO 8601 timestamp of the sample. */
  ts: string;
  /** job that produced the sample (source of predicted/actual). */
  jobId: string;
  /** Complexity predicted by Decompose at the start of the job. */
  predicted: Complexity;
  /**
   * Who produced the final classification:
   *   - `'llm'`       → LLM emitted the `<complexity>` tag
   *   - `'heuristic'` → tag missing/malformed → safe 'task' fallback
   *   - `'user'`      → reserved for future overrule UX
   * Optional for backwards compatibility with samples written before
   * provenance plumbing landed; readers MUST treat absent as unknown
   * rather than substitute a default.
   */
  decidedBy?: DecidedBy;
  /** Observed touched-file count (trace.jsonl file_write SSOT). */
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
  predictedComplexity: Complexity;
  /** Provenance of the classification; forwarded from decompose's parser. */
  decidedBy?: DecidedBy;
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
    predicted: input.predictedComplexity,
    actualTouched: input.actualTouched,
    escalated: input.escalated,
  };
  if (input.decidedBy) record.decidedBy = input.decidedBy;
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
 * Missing file → empty array (AC: "파일이 없으면 빈 배열로 초기화").
 * Malformed lines are skipped with a warning.
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
//
// `aggregateClassifications` is a pure function over the writer's record
// shape. It answers three questions downstream consumers ask:
//
//   1. "Which bucket does Decompose over-predict from?"        → byPredicted
//   2. "Is the heuristic fallback degrading classification?"   → byDecidedBy
//   3. "When do under-predictions escalate / blow up touched?" → escalation*
//
// All fields are observable counts / rates so the output can be fed
// directly into a future prompt hint (e.g. "Your last N llm-decided
// oneshot samples escalated 40% of the time → consider todo when
// unsure"). We deliberately do not invent new dimensions — the plan
// calls out `decidedBy` × `predicted` × `escalated` as the only
// high-signal cross-tab.
// ════════════════════════════════════════════════════════════════════════

/** `DecidedBy` bucket plus a synthetic `'unknown'` slot for records
 * written before provenance plumbing landed (§19 sufuso 복검). Callers
 * treat it as a first-class bucket rather than substituting a default,
 * matching `readClassifications`' "absent MUST mean unknown" contract. */
export type DecidedByBucket = DecidedBy | 'unknown';

export interface AggregateClassifications {
  /** Total records considered (post-filter). */
  total: number;
  /** Count per predicted complexity. */
  byPredicted: Record<Complexity, number>;
  /** Count per decidedBy bucket (incl. 'unknown'). */
  byDecidedBy: Record<DecidedByBucket, number>;
  /**
   * Count for each (predicted × decidedBy) cell. Sparse — only populated
   * cells are present. Keyed as `<predicted>/<decidedBy>` to stay flat.
   */
  crossTab: Record<string, number>;
  /** Number of samples with `escalated === true`. */
  escalatedCount: number;
  /**
   * Escalation rate per decidedBy bucket. Denominator is the per-bucket
   * sample count; a zero-sample bucket emits `null` so callers don't
   * confuse "no data" with "0% rate".
   */
  escalationRateByDecidedBy: Record<DecidedByBucket, number | null>;
  /** Average touched-file count (overall). `null` when total === 0. */
  avgTouched: number | null;
  /**
   * Average touched-file count per predicted complexity. Null for
   * buckets with zero samples.
   */
  avgTouchedByPredicted: Record<Complexity, number | null>;
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
   * session without having to re-read the file — readClassifications is
   * already single-pass so we just filter here.
   */
  jobIds?: string[];
}

const ZERO_BY_PREDICTED: Record<Complexity, number> = {
  oneshot: 0,
  exploratory: 0,
  task: 0,
};

const ZERO_BY_DECIDED_BY: Record<DecidedByBucket, number> = {
  llm: 0,
  heuristic: 0,
  user: 0,
  unknown: 0,
};

function bucketOfDecidedBy(value: DecidedBy | undefined): DecidedByBucket {
  return value ?? 'unknown';
}

/**
 * Pure aggregator — stable / deterministic given the same input. Kept
 * separate from `summarizeFeatureBiases` so callers that already hold
 * the record array (tests, resumable analyses) do not re-read the file.
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

  const byPredicted: Record<Complexity, number> = { ...ZERO_BY_PREDICTED };
  const byDecidedBy: Record<DecidedByBucket, number> = { ...ZERO_BY_DECIDED_BY };
  const crossTab: Record<string, number> = {};
  const touchedSumByPredicted: Record<Complexity, number> = { ...ZERO_BY_PREDICTED };
  const escalatedByDecidedBy: Record<DecidedByBucket, number> = { ...ZERO_BY_DECIDED_BY };

  let escalatedCount = 0;
  let touchedSum = 0;
  let minTs: string | undefined;
  let maxTs: string | undefined;

  for (const r of filtered) {
    byPredicted[r.predicted] += 1;
    const dbBucket = bucketOfDecidedBy(r.decidedBy);
    byDecidedBy[dbBucket] += 1;
    const key = `${r.predicted}/${dbBucket}`;
    crossTab[key] = (crossTab[key] ?? 0) + 1;

    touchedSum += r.actualTouched;
    touchedSumByPredicted[r.predicted] += r.actualTouched;

    if (r.escalated) {
      escalatedCount += 1;
      escalatedByDecidedBy[dbBucket] += 1;
    }

    if (!minTs || r.ts < minTs) minTs = r.ts;
    if (!maxTs || r.ts > maxTs) maxTs = r.ts;
  }

  const total = filtered.length;

  const escalationRateByDecidedBy: Record<DecidedByBucket, number | null> = {
    llm: null,
    heuristic: null,
    user: null,
    unknown: null,
  };
  for (const bucket of Object.keys(byDecidedBy) as DecidedByBucket[]) {
    const n = byDecidedBy[bucket];
    escalationRateByDecidedBy[bucket] =
      n > 0 ? escalatedByDecidedBy[bucket] / n : null;
  }

  const avgTouchedByPredicted: Record<Complexity, number | null> = {
    oneshot: null,
    exploratory: null,
    task: null,
  };
  for (const c of Object.keys(byPredicted) as Complexity[]) {
    const n = byPredicted[c];
    avgTouchedByPredicted[c] = n > 0 ? touchedSumByPredicted[c] / n : null;
  }

  return {
    total,
    byPredicted,
    byDecidedBy,
    crossTab,
    escalatedCount,
    escalationRateByDecidedBy,
    avgTouched: total > 0 ? touchedSum / total : null,
    avgTouchedByPredicted,
    timeRange: minTs && maxTs ? { from: minTs, to: maxTs } : null,
  };
}

/**
 * Convenience wrapper: read + aggregate in one call. Thin — direct
 * consumers that already hold the record array should call
 * `aggregateClassifications` directly to avoid double I/O.
 */
export async function summarizeFeatureBiases(
  featurePath: string,
  opts: AggregateOptions = {},
): Promise<AggregateClassifications> {
  const records = await readClassifications(featurePath);
  return aggregateClassifications(records, opts);
}
