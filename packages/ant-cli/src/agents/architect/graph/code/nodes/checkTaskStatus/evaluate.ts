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
      severity: 'critical',
      file: filePath,
      isRetryable: true,
      suggestedFix,
    });
  }
  return out;
}

/**
 * Budget-exhaustion guard. `<done>` is the only LLM-driven completion
 * signal; reaching checkTaskStatus without it means the call budget was
 * exhausted. Applies universally — not task-type-gated.
 *
 * The retry-oriented hint for diagnostic tasks is opt-in via the
 * task-check hook's `budgetExhaustedHint` (set on verification). Task
 * types that do not override receive the generic "break down the scope"
 * direction.
 */
function budgetExhaustionViolation(
  state: ArchitectGraphState,
  logPrefix: string,
): Violation | null {
  const task = state.currentTask;
  if (!task) return null;
  const llmExplicitlyDone = state.llmResponse?.done === true;
  if (llmExplicitlyDone) return null;

  console.warn(
    `⚠️  [${logPrefix}] Task "${task.name}" (type=${task.type}) reached checkTaskStatus without <done> tag — budget exhausted`,
  );
  const hookHint = hooksIfActive(state)?.check?.budgetExhaustedHint;
  return {
    type: 'budget_exhausted' as ViolationType,
    severity: 'critical',
    message:
      'Task reached checkTaskStatus without LLM signaling completion via <done> tag. ' +
      'The LLM could not complete within the call budget.',
    isRetryable: true,
    suggestedFix: hookHint ?? 'Break down the task scope or provide clearer implementation direction.',
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
    const budget = budgetExhaustionViolation(state, opts.logPrefix);
    if (budget) violations.push(budget);
  }

  // Task-type-specific completion judgement via hooks.
  //  - verification → gate check (build / typecheck / test)
  //  - test-code    → async disk scan for real test files
  // Only invoked when no baseline violation has fired AND the LLM has
  // explicitly signalled completion; this mirrors the preconditions of
  // the inlined branches being replaced.
  if (violations.length === 0 && llmExplicitlyDone) {
    const hook = hooksIfActive(state)?.check;
    if (hook) {
      const extra = await hook.evaluate(state);
      if (extra) violations.push(extra);
    }
  }

  return { violations, llmExplicitlyDone, stopRequested, batchSplitRequeued };
}
