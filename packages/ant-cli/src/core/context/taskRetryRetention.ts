/**
 * Task-internal retry retention — single source of truth for how we preserve
 * context across re-entries into the same task.
 *
 * Retry / reverify / resumeState / Orchestrator re-queue are four distinct entry
 * points back into the same task. Before this module they had conflicting
 * conversation-handling policies: retry wiped, resumeState preserved-everything,
 * orchestrator wiped-then-retried. That inconsistency was the root of "LLM
 * solution quality collapses on inline verification retries".
 *
 * Policy: convert the previous attempt into a compact `RetrySummary` and
 * render it as a single markdown block that the plan prompt appends to its
 * violation context. Critical signals (last plan, normalized errors, command
 * history, failure reason) are preserved without dragging in file contents
 * or full tool traces.
 *
 * Ant context-pollution rules still apply at *task boundaries* (learn → new
 * task pop remains a full wipe). This module is strictly for intra-task
 * re-entries.
 *
 * Absorbs two formerly-inline behaviours from `plan/index.ts`:
 *   - Dedupe `verification_incomplete` violations against an already-rendered
 *     retry summary (so the LLM doesn't see the same failure described twice).
 *   - Produce the observability meta-data (summaryInjected, retentionMode,
 *     passedGatesAtRetry) logged at every retry boundary.
 */

import type { Violation, VerificationTracker } from '../../agents/architect/graph/code/state';

const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_PLAN_JSON_CHARS = 2000;
const MAX_ERROR_LINES = 8;
const MAX_COMMAND_HISTORY = 10;

export interface RetrySummary {
  attemptCount: number;
  lastPlanJson?: string;
  /** Normalized, de-duplicated error lines (top N) */
  normalizedErrors: string[];
  /** Recent tool/shell invocations with success + exit code */
  commandHistory: Array<{ command: string; success: boolean; exitCode?: number }>;
  failureReason: string;
  lastAttemptAt: string;
}

export interface ViolationContext {
  violations?: Violation[];
  lastPlan?: string;
}

export interface CommandHistoryEntry {
  command: string;
  success?: boolean;
  exitCode?: number;
  timestamp?: number;
  errorSnippet?: string;
}

function truncatePlan(plan: string | undefined): string | undefined {
  if (!plan) return undefined;
  const trimmed = plan.trim();
  if (trimmed.length <= MAX_PLAN_JSON_CHARS) return trimmed;
  return trimmed.substring(0, MAX_PLAN_JSON_CHARS) + '\n... [truncated]';
}

function normalizeErrorLines(violations: Violation[] | undefined, limit: number): string[] {
  if (!violations?.length) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of violations) {
    const firstLine = (v.message || '').split('\n')[0].trim();
    if (!firstLine) continue;
    const normalized = firstLine
      .replace(/\b\d+:\d+\b/g, 'L:C')
      .replace(/\/[\w.\-/]+/g, '<path>');
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(firstLine);
    if (out.length >= limit) break;
  }
  return out;
}

function tailCommandHistory(
  history: CommandHistoryEntry[] | undefined,
  limit: number,
): RetrySummary['commandHistory'] {
  if (!history?.length) return [];
  return history.slice(-limit).map(h => ({
    command: h.command,
    success: !!h.success,
    exitCode: h.exitCode,
  }));
}

/**
 * Produce a retry summary after a failed attempt (retry entry).
 */
export function summarizeForRetry(
  violationContext: ViolationContext,
  options?: {
    attemptCount?: number;
    commandHistory?: CommandHistoryEntry[];
  },
): RetrySummary {
  const violations = violationContext.violations || [];
  const failureReason = violations[0]?.message?.split('\n')[0] || 'Previous attempt did not resolve all issues.';
  return {
    attemptCount: options?.attemptCount ?? 1,
    lastPlanJson: truncatePlan(violationContext.lastPlan),
    normalizedErrors: normalizeErrorLines(violations, MAX_ERROR_LINES),
    commandHistory: tailCommandHistory(options?.commandHistory, MAX_COMMAND_HISTORY),
    failureReason,
    lastAttemptAt: new Date().toISOString(),
  };
}

/**
 * Produce a retry summary for the resume path (interrupted task returning
 * after user stop, recursion limit, rate limit, etc.). Unlike retry, the
 * previous attempt did not fail semantically — it was paused mid-stream.
 */
export function summarizeForResume(
  lastPlanText: string | undefined,
  options?: {
    attemptCount?: number;
    commandHistory?: CommandHistoryEntry[];
    violations?: Violation[];
  },
): RetrySummary {
  return {
    attemptCount: options?.attemptCount ?? 1,
    lastPlanJson: truncatePlan(lastPlanText),
    normalizedErrors: normalizeErrorLines(options?.violations, MAX_ERROR_LINES),
    commandHistory: tailCommandHistory(options?.commandHistory, MAX_COMMAND_HISTORY),
    failureReason: 'Task was interrupted before completion — resuming with prior attempt context.',
    lastAttemptAt: new Date().toISOString(),
  };
}

/**
 * Render a retry summary as markdown suitable for appending to the plan
 * prompt's violations section. Consumed by `buildPlanPrompt` via
 * `violationsText` in the verification/error variants.
 */
export function renderRetrySummary(summary: RetrySummary): string {
  const parts: string[] = [];
  parts.push('');
  parts.push(`### Prior attempt summary (attempt #${summary.attemptCount})`);
  parts.push(`Captured: ${summary.lastAttemptAt}`);
  parts.push(`Failure reason: ${summary.failureReason}`);

  if (summary.normalizedErrors.length > 0) {
    parts.push('');
    parts.push('**Outstanding errors (top signals)**:');
    for (const err of summary.normalizedErrors) parts.push(`- ${err}`);
  }

  if (summary.commandHistory.length > 0) {
    parts.push('');
    parts.push('**Recent command history**:');
    for (const c of summary.commandHistory) {
      const status = c.success ? '✓' : `✗(exit=${c.exitCode ?? '?'})`;
      parts.push(`- ${status} ${c.command}`);
    }
  }

  if (summary.lastPlanJson) {
    parts.push('');
    parts.push('**Last applied/attempted plan JSON**:');
    parts.push('```json');
    parts.push(summary.lastPlanJson);
    parts.push('```');
  }

  parts.push('');
  parts.push(
    '**Constraint**: The previous approach did not complete. Observe what changed ' +
    'since the last attempt, and if the same category of fix is attempted again, ' +
    'justify what is different. Do NOT re-read files already known from the prior attempt.',
  );

  return parts.join('\n');
}

export const TASK_RETRY_RETENTION_DEFAULTS = {
  MAX_ATTEMPTS: DEFAULT_MAX_ATTEMPTS,
  MAX_PLAN_JSON_CHARS,
  MAX_ERROR_LINES,
  MAX_COMMAND_HISTORY,
} as const;

// ────────────────────────────────────────────────────────────────────────────
// Violation deduplication
// ────────────────────────────────────────────────────────────────────────────

/**
 * When the plan prompt already carries a rendered retry summary, the
 * `verification_incomplete` violation describes the exact same failure in a
 * different format — the LLM sees it twice and often reacts inconsistently.
 * This helper strips the redundant violation so the retry summary is the sole
 * voice describing the prior outcome. Other violation types are untouched.
 *
 * Call site (plan.composeViolationsText): when `retrySummaryText` is truthy,
 * pass `violations` through this helper before formatting.
 */
export function dedupeViolationsAgainstSummary(
  violations: Violation[] | undefined,
  retrySummaryText: string | undefined,
): Violation[] | undefined {
  if (!retrySummaryText) return violations;
  if (!violations?.length) return violations;
  return violations.filter(v => v.type !== 'verification_incomplete');
}

// ────────────────────────────────────────────────────────────────────────────
// Retention observability metadata
// ────────────────────────────────────────────────────────────────────────────

export type RetentionMode = 'summary' | 'full' | 'none';

export interface RetryRetentionMeta {
  retentionMode: RetentionMode;
  summaryInjected: boolean;
  summaryLen: number;
  passedGatesAtRetry: Array<'typecheck' | 'build' | 'test'>;
}

/**
 * Produce the retention metadata that retry/reverify observability logs should
 * emit. Centralises what used to be inline composition in `plan.index.ts`'s
 * retry-entry handler.
 */
export function describeRetryRetention(
  retrySummaryText: string | undefined,
  tracker: VerificationTracker | undefined,
): RetryRetentionMeta {
  const passedGates: Array<'typecheck' | 'build' | 'test'> = [];
  if (tracker?.typecheckPassed) passedGates.push('typecheck');
  if (tracker?.buildPassed) passedGates.push('build');
  if (tracker?.testPassed) passedGates.push('test');
  return {
    retentionMode: 'summary',
    summaryInjected: !!retrySummaryText,
    summaryLen: retrySummaryText?.length ?? 0,
    passedGatesAtRetry: passedGates,
  };
}
