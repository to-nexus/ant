/**
 * nodes/checkTaskStatus/evaluate.ts — pure, task-type-blind completion judgement
 *
 * Shared by both checkTaskStatus entry points (main graph + worker subgraph).
 * Responsibility boundary (R1 / R3):
 *
 *   1. Convert `state.fileErrors` into structured `Violation` records. The
 *      classifier recognises a small, universally applicable set of
 *      messages (missing file, stale search block, cross-worker conflict).
 *      The cross-worker case is only produced by the parallel runtime, so
 *      the branch is a no-op in the main graph path.
 *   2. Budget-exhaustion guard — if control reached `checkTaskStatus`
 *      without the LLM emitting `<done>`, the task hit its call budget
 *      regardless of task type. Violation is injected before any hook is
 *      consulted.
 *   3. Delegate ALL task-type-specific completion judgement to
 *      `hooksIfActive(state)?.check?.evaluate(state)`. Today that covers:
 *
 *        - verification  → gate check (build / typecheck / test)
 *        - test-code     → disk scan for *.test.*|*.spec.*
 *
 *      New task-type checks slot in by adding `check.evaluate` to the
 *      bundle — no changes to this file or to the phase wrappers.
 *
 * The wrappers (`index.ts` / `workerIndex.ts`) decide what to do with the
 * verdict: whether to mark the task complete, emit SSE, save checkpoint,
 * invoke orchestrator hooks, etc. This module owns only the judgement.
 */

import type { ArchitectGraphState, Violation, ViolationType } from '../../state';
import { NO_PROGRESS_HARD_CAP } from '../../state';
import { hooksIfActive } from '../../tasks/_shared/registry';

export interface TaskStatusEvaluation {
  violations: Violation[];
  llmExplicitlyDone: boolean;
  stopRequested: boolean;
  batchSplitRequeued: boolean;
}

/**
 * Classify a raw fileError message into a typed violation. Callers pass a
 * `logPrefix` so sequential vs. worker logs remain distinguishable.
 */
function fileErrorsToViolations(
  state: ArchitectGraphState,
  logPrefix: string,
): Violation[] {
  const out: Violation[] = [];
  const fileErrors = state.fileErrors ?? [];
  if (fileErrors.length === 0) return out;

  console.log(`⚠️  [${logPrefix}] Converting ${fileErrors.length} file error(s) to violations`);

  for (const errorMsg of fileErrors) {
    const fileMatch = errorMsg.match(/File "([^"]+)"|file "([^"]+)"/);
    const filePath = fileMatch ? (fileMatch[1] || fileMatch[2]) : undefined;

    let violationType: ViolationType;
    let suggestedFix: string | undefined;

    if (errorMsg.includes('already created by task') || errorMsg.includes('was already created by')) {
      // Parallel-only: another worker owns this file. Sequential runs
      // never generate this message, so the branch is a no-op there.
      violationType = 'cross_worker_conflict';
      suggestedFix = filePath
        ? `This file was created by another parallel task. Use read_file("${filePath}") to read the current content, then use edit_file to merge your changes.`
        : `This file was created by another parallel task. Read the file first, then use edit_file to merge.`;
    } else if (errorMsg.includes('Cannot edit non-existing file') || errorMsg.includes('non-existing file')) {
      violationType = 'missing_file';
      suggestedFix = filePath
        ? `File does not exist. Use <file path="${filePath}"> to create it first, or verify the file path is correct.`
        : undefined;
    } else if (errorMsg.includes('Search block not found')) {
      violationType = 'file_operation_failed';
      suggestedFix = filePath
        ? `The file content has changed since you last saw it.\n` +
          `Call read_file("${filePath}") to get current content, then retry edit_file with the exact match.`
        : undefined;
    } else {
      violationType = 'file_operation_failed';
      suggestedFix = undefined;
    }

    out.push({
      type: violationType,
      message: errorMsg,
      file: filePath,
      isRetryable: true,
      suggestedFix,
    });
  }
  return out;
}

/**
 * Summarize the dominant repeated failure from commandHistory (5-min window).
 * Used by noDoneSignalViolation to provide concrete diagnostic info to the
 * plan node instead of generic "Safety Net forced exit" message.
 */
function summarizeDominantFailure(
  commandHistory: ArchitectGraphState['commandHistory'],
): { command: string; count: number; lastErrorSnippet?: string } | null {
  if (!commandHistory || commandHistory.length === 0) return null;
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  const recentFailures = commandHistory.filter(h => !h.success && h.timestamp > fiveMinutesAgo);
  if (recentFailures.length === 0) return null;

  const counts = new Map<string, { count: number; lastErrorSnippet?: string }>();
  for (const h of recentFailures) {
    const entry = counts.get(h.command) ?? { count: 0, lastErrorSnippet: undefined };
    entry.count += 1;
    entry.lastErrorSnippet = h.errorSnippet ?? entry.lastErrorSnippet;
    counts.set(h.command, entry);
  }

  let dominant: { command: string; count: number; lastErrorSnippet?: string } | null = null;
  for (const [command, v] of counts) {
    if (!dominant || v.count > dominant.count) dominant = { command, ...v };
  }
  return dominant;
}

/**
 * Missing-done-signal guard. `<done>` is the only LLM-driven completion
 * signal; reaching checkTaskStatus without it means the task exited via
 * a Safety Net (A: recursionLimit, B: repeated tool failures) or a file
 * error short-circuit. Applies universally — not task-type-gated.
 *
 * Violation message is concrete when dominated by a single failure pattern
 * (Safety Net B case), generic when dominated by pure recursion (Safety Net A).
 * Suggested fix is also context-specific per the failure pattern.
 */
function noDoneSignalViolation(
  state: ArchitectGraphState,
  logPrefix: string,
): Violation | null {
  const task = state.currentTask;
  if (!task) return null;
  const llmExplicitlyDone = state.llmResponse?.done === true;
  if (llmExplicitlyDone) return null;

  console.warn(
    `⚠️  [${logPrefix}] Task "${task.name}" (type=${task.type}) reached checkTaskStatus without <done> tag`,
  );

  const dominant = summarizeDominantFailure(state.commandHistory);
  const filePathMatch = dominant?.command.match(/^tool:\w+:(.+)$/);
  const hookHint = hooksIfActive(state)?.check?.noDoneSignalHint;

  // No-progress breaker framing (Safety Net C, rocky-beating-coral): all
  // reads SUCCEEDED, so `summarizeDominantFailure` is null and the generic
  // message would misleadingly blame recursionLimit/failures. Name the
  // degenerate re-read loop so the retry plan gets accurate context.
  const noProgressTripped = (state._noProgressStreak || 0) >= NO_PROGRESS_HARD_CAP;
  if (noProgressTripped) {
    return {
      type: 'no_done_signal',
      message: `Task was stopped by the no-progress circuit breaker: ${state._noProgressStreak} ` +
        `consecutive turns re-read file regions already read verbatim earlier (every read was ` +
        `duplicate-elided), with zero file output, zero tool mutations, and no <done>.`,
      isRetryable: true,
      suggestedFix: hookHint ??
        'The needed file contents were already gathered — do not re-read them. Trust ' +
        '[duplicate read elided] stubs and the already-read manifest: the earlier tool_result ' +
        'content is still valid. Proceed directly to applying the planned changes with ' +
        '<file path="...">full file body</file> tags, then output <done>true</done>.',
    };
  }

  return {
    type: 'no_done_signal',
    message: dominant
      ? `Task reached checkTaskStatus without <done>. Repeated failure detected: "${dominant.command}" ` +
        `failed ${dominant.count} time(s) in the last 5 minutes` +
        (dominant.lastErrorSnippet ? ` — latest error: ${dominant.lastErrorSnippet.slice(0, 300)}` : '') +
        `. Repeating the identical call will not fix this.`
      : 'Task reached checkTaskStatus without LLM signaling completion via <done> tag. ' +
        'A Safety Net (recursionLimit / repeated tool failures) likely forced the exit.',
    file: filePathMatch?.[1],
    isRetryable: true,
    suggestedFix: hookHint ?? (dominant
      ? 'Do not repeat the exact same call. If the error indicates a missing file, verify the path with list_files or create it explicitly with a <file> tag before reading/editing it. If it is a persistent command/environment error, try a different approach.'
      : 'Break down the task scope or provide clearer implementation direction.'),
  };
}

/**
 * Pure completion judgement. Callers supply a log prefix and get back the
 * aggregated violations plus a few precomputed flags they would otherwise
 * derive on their own (so both wrappers stay consistent).
 */
export async function evaluateTaskStatus(
  state: ArchitectGraphState,
  opts: { logPrefix: string },
): Promise<TaskStatusEvaluation> {
  const llmExplicitlyDone = state.llmResponse?.done === true;
  const stopRequested = typeof state._isStopRequested === 'function'
    ? state._isStopRequested()
    : false;
  const batchSplitRequeued = state._batchSplitRequeued === true;

  const violations: Violation[] = [];
  violations.push(...fileErrorsToViolations(state, opts.logPrefix));

  if (violations.length === 0 && state.currentTask) {
    const missing = noDoneSignalViolation(state, opts.logPrefix);
    if (missing) violations.push(missing);
  }

  // Task-type-specific completion judgement via hooks.
  //  - verification → gate check (build / typecheck / test)
  //  - test-code    → async disk scan for real test files
  // Only invoked when no baseline violation has fired AND the LLM has
  // explicitly signalled completion; this mirrors the preconditions of
  // the inlined branches being replaced.
  if (violations.length === 0 && llmExplicitlyDone) {
    const hook = hooksIfActive(state)?.check;
    if (hook?.evaluate) {
      const extra = await hook.evaluate(state);
      if (extra) violations.push(extra);
    }
  }

  return { violations, llmExplicitlyDone, stopRequested, batchSplitRequeued };
}
