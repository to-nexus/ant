/**
 * plan/parts/batchSplit.ts — diagnostic batch-split orchestration.
 *
 * Extracted from `nodes/plan/index.ts` as part of T6b-α. Behaviour is
 * byte-identical to the inline implementation; only module boundary moves.
 *
 * Responsibilities:
 *   - `processDiagnosticBatchSplit`: detect a batched diagnostic plan and
 *     split it into sub-tasks. Re-enqueue the original task behind the
 *     per-batch error tasks when the split fires.
 *   - `isVerificationPassWithoutCodeGen`: detect the "diagnostic task
 *     finished tool loop but there's nothing left to apply" case so the
 *     plan node can mark `done:true` directly and skip the execute call.
 *
 * Kept local because both helpers are only called from the plan node's
 * orchestration path; exposing them elsewhere would bypass the phase
 * boundary intentionally established by R1.
 */

import { ArchitectGraphState } from '../../../state';
import { CodeTask } from '../../../../../types/task';
import { snapshotFromState } from '../../../parallel/TaskWorker';
import { appendTrace } from '../../../../../../../utils/verificationTrace';
import { VerificationTerminalError } from '../../../tasks/verification/model/errors';
import { isVerificationTask } from '../../../tasks/verification';
import { isErrorTask } from '../../../tasks/error';

export const MAX_BATCH_SPLIT_CYCLES = 10;

/**
 * Strip markdown code fences from a string if present.
 * Handles: ```json\n...\n```, ```\n...\n```, etc.
 */
export function stripMarkdownFences(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n\s*```$/);
  if (fenceMatch) return fenceMatch[1].trim();
  return trimmed;
}

/**
 * Detect a plan JSON whose implementation is literally empty
 * (no modify/create/delete entries and no batches). An empty plan followed by
 * execute is a guaranteed no-op that will still consume LLM calls; the plan
 * node flips `llmResponse.done = true` so planRouter short-circuits to
 * `checkTaskStatus`. Router itself stays pure (read-only) per R1.
 */
export function hasEmptyImplementation(planText: string | undefined): boolean {
  if (!planText) return false;
  const body = stripMarkdownFences(planText);
  if (!body.length) return false;
  try {
    const parsed = JSON.parse(body);
    const impl = parsed.implementation || {};
    const modifyCount = Array.isArray(impl.modify) ? impl.modify.length : 0;
    const createCount = Array.isArray(impl.create) ? impl.create.length : 0;
    const deleteCount = Array.isArray(impl.delete) ? impl.delete.length : 0;
    const hasBatches = Array.isArray(parsed.batches) && parsed.batches.length > 0;
    return !hasBatches && modifyCount === 0 && createCount === 0 && deleteCount === 0;
  } catch {
    return false;
  }
}

/**
 * Check whether any two batches share files in their modify/create/delete lists.
 * When overlap exists, error sub-tasks must run exclusively (sequential).
 * When no overlap, they can safely run in parallel.
 */
export function computeBatchFileOverlap(batches: any[]): boolean {
  const extractFiles = (b: any): Set<string> => {
    const files = new Set<string>();
    for (const m of (b.modify || [])) files.add(typeof m === 'string' ? m : m.file);
    for (const c of (b.create || [])) files.add(typeof c === 'string' ? c : c.file);
    for (const d of (b.delete || [])) files.add(typeof d === 'string' ? d : d);
    return files;
  };
  const allFiles = batches.map(extractFiles);
  for (let i = 0; i < allFiles.length; i++) {
    for (let j = i + 1; j < allFiles.length; j++) {
      for (const file of allFiles[i]) {
        if (allFiles[j].has(file)) return true;
      }
    }
  }
  return false;
}

/**
 * When a verification task finishes its plan tool-loop with build/test already
 * passing and no plan to execute, execute would only ask the LLM to output
 * `<done>true</done>` — a wasted call. Detect this and let the plan node set
 * `done: true` directly so planRouter skips execute entirely.
 *
 * Scope is intentionally verification-only: completeness is decided by
 * `VerificationSession.isComplete()`, which is populated exclusively by the
 * verification plan hook's `initSession`. Error tasks never own a session
 * (they apply fixes from `prePlanText`) so they would always read `false`
 * here anyway — narrowing the gate to verification makes the semantics
 * honest instead of relying on session-absence as an implicit filter.
 */
export function isVerificationPassWithoutCodeGen(
  state: ArchitectGraphState,
  planText: string,
  batchSplitOccurred: boolean,
): boolean {
  if (batchSplitOccurred) return false;
  if (planText !== '') return false;
  if (!isVerificationTask(state.currentTask)) return false;
  return state.verification?.isComplete() ?? false;
}

/**
 * Detect batched diagnostic plan and split into sub-tasks.
 * Called from every path that produces a planText for diagnostic tasks.
 *
 * When the plan JSON contains a `batches` array with >1 entries,
 * each batch becomes an independent error sub-task with prePlanText.
 * The original task is re-enqueued (not completed) so it re-runs after all error fixes.
 *
 * Hard limit: after MAX_BATCH_SPLIT_CYCLES cycles, batch splitting is aborted and
 * planText is returned as-is (single consolidated task). This prevents infinite loops
 * from cascading compiler errors that reveal new layers after each fix cycle.
 *
 * @returns updated planText (empty string if split occurred, original otherwise)
 */
export function processDiagnosticBatchSplit(
  state: ArchitectGraphState,
  planText: string,
  nextTask: CodeTask,
): string {
  // Gate is BOTH verification and error. Error tasks created by a previous
  // batch-split carry `prePlanText` and fast-path past this function (see
  // `nodes/plan/index.ts maybePrePlannedFastPath`). But error tasks emitted
  // directly by decompose (no prePlanText) fall through to normal planning
  // and may legitimately produce a multi-batch remediation plan that should
  // also be split. Cascading splits are bounded by
  // `MAX_BATCH_SPLIT_CYCLES` on the Session.
  const isBatchSplitCandidate = isVerificationTask(nextTask) || isErrorTask(nextTask);

  const logBatchSplit = (data: Record<string, any>) => {
    if (state.context?.featurePath && state._httpJobId) {
      import('../../../../../../../core/utils/executionLogger').then(({ getExecutionLogger }) => {
        getExecutionLogger({
          featurePath: state.context!.featurePath!,
          jobId: state._httpJobId!,
          jobType: 'code',
        }).log('batch_split', data, nextTask.id);
      }).catch(() => {});
    }
  };

  if (!isBatchSplitCandidate) {
    return planText;
  }
  if (!planText || planText.length <= 50) {
    logBatchSplit({ action: 'skipped', reason: 'plan_too_short', planTextLen: planText?.length ?? 0, taskName: nextTask.name });
    return planText;
  }
  if (!state.taskQueue || typeof state.taskQueue.push !== 'function' || typeof state.taskQueue.getAll !== 'function') {
    logBatchSplit({ action: 'skipped', reason: 'taskQueue_missing', taskQueueType: typeof state.taskQueue, constructor: state.taskQueue?.constructor?.name ?? 'N/A', taskName: nextTask.name });
    return planText;
  }

  try {
    const jsonStr = stripMarkdownFences(planText);
    const parsed = JSON.parse(jsonStr);

    // Force split-by-file when LLM produced a consolidated plan but the error
    // volume or file fan-out crosses the escalation threshold, OR when the
    // verification attempt budget is exhausted. Safety valve for "LLM keeps
    // outputting a single plan that we keep failing to apply".
    const budget = state.verification?.remainingBudget() ?? 0;
    const thresholdErrors = parseInt(process.env.ANT_VERIFICATION_SPLIT_ERRORS || '6', 10);
    const thresholdFiles = parseInt(process.env.ANT_VERIFICATION_SPLIT_FILES || '4', 10);
    const totalErrors: number = parsed.diagnostics?.totalErrors ?? 0;
    const modifyArr: any[] = parsed.implementation?.modify ?? [];
    const budgetExhausted = budget <= 0;
    const overErrorBudget = totalErrors >= thresholdErrors;
    const overFileBudget = modifyArr.length >= thresholdFiles;
    const shouldForceSplit = (!parsed.batches || !Array.isArray(parsed.batches) || parsed.batches.length <= 1)
      && (budgetExhausted || overErrorBudget || overFileBudget);

    // Repeat detection — when the same plan structure surfaced again
    // without progress, escalate to force-split. Session owns the
    // authoritative hash list (produced by `onPlanApplied`).
    const repeatedDetection = planText
      ? state.verification?.isPlanRepeated(planText) ?? { repeated: false, count: 0 }
      : { repeated: false, count: 0 };
    if (repeatedDetection.repeated) {
      console.warn(`🔁 [BatchSplit] Same plan hash as previous attempt (count=${repeatedDetection.count}) — escalating`);
    }
    const forceByRepeat = repeatedDetection.repeated
      && (!parsed.batches || !Array.isArray(parsed.batches) || parsed.batches.length <= 1)
      && modifyArr.length > 0;

    if ((shouldForceSplit || forceByRepeat) && modifyArr.length >= 2) {
      logBatchSplit({
        action: 'force_split_escalate',
        reason: forceByRepeat
          ? 'repeated_plan_hash'
          : budgetExhausted
            ? 'budget_exhausted'
            : overErrorBudget
              ? 'over_error_threshold'
              : 'over_file_threshold',
        totalErrors,
        modifyCount: modifyArr.length,
        taskName: nextTask.name,
        budget,
      });
      console.warn(`🚨 [BatchSplit] Forcing splitByFile escalate (budgetExhausted=${budgetExhausted}, totalErrors=${totalErrors}, modifyCount=${modifyArr.length})`);
      parsed.batches = modifyArr.map((m: any, i: number) => {
        const target = typeof m === 'string' ? m : (m.target || m.file || `file-${i}`);
        return {
          name: `Fix ${target}`,
          rationale: (m && m.action) || `Apply modifications to ${target}`,
          modify: [m],
          create: [],
          delete: [],
        };
      });
    }

    if (!parsed.batches || !Array.isArray(parsed.batches) || parsed.batches.length <= 1) {
      logBatchSplit({ action: 'skipped', reason: 'no_batches', batchCount: parsed.batches?.length ?? 0, taskName: nextTask.name });
      return planText;
    }

    // ── Hard limit: cap batch split cycles to prevent infinite loops ──
    // The count lives on the Session (carried across re-queue via the
    // `resumeState.verification` snapshot), not on the task.
    const splitCount = (state.verification?.batchSplitCount() ?? 0) + 1;

    if (splitCount > MAX_BATCH_SPLIT_CYCLES) {
      logBatchSplit({ action: 'cycle_limit_failed', splitCount, taskName: nextTask.name });
      console.error(`❌ [BatchSplit] Cycle limit (${MAX_BATCH_SPLIT_CYCLES}) exceeded for "${nextTask.name}". Throwing terminal error.`);
      appendTrace({
        node: 'plan',
        taskId: nextTask.id,
        taskType: nextTask.type,
        extra: { reason: 'cycle_limit_terminal', splitCount },
      });
      // T8 — single terminal sink: propagate as a typed VerificationTerminalError
      // so `TaskOrchestrator.reportFailure` classifies it and marks the task as
      // permanently failed (the orchestrator now owns every `_failed=true`
      // write). Replaces the former `_failed=true + _batchSplitRequeued`
      // side-effect path that required the worker subgraph to unwind through
      // checkTaskStatus' batch-split branch to release its slot — the throw
      // path releases the slot via the standard worker `catch → reportFailure`
      // flow without any "task silently lost" edge case.
      throw new VerificationTerminalError(
        'batch_cycle_limit',
        `Batch split cycle limit (${MAX_BATCH_SPLIT_CYCLES}) exceeded for "${nextTask.name}" after ${splitCount} cycles.`,
        snapshotFromState(state)?.verification,
      );
    }

    const hasFileOverlap = computeBatchFileOverlap(parsed.batches);
    // Each batch gets a unique parallelGroup so TaskOrchestrator can run them concurrently.
    // Batches with file overlap use exclusive:true (sequential) instead.
    const batchGroupBase = hasFileOverlap ? null : `error-batch-${Date.now()}`;

    // Phase 3-11 — carry the plan-level `rootCauseSelfCheck.mode` onto each
    // batch so the error execute variant can branch its scope rules.
    // Falls back to a heuristic (max affectedFiles across rootCauses ≥ 5 →
    // 'upstream', otherwise 'patch') when the LLM did not self-report.
    const selfCheck = (parsed as any).rootCauseSelfCheck;
    const allowedModes = ['patch', 'upstream', 'refactor'] as const;
    type RemediationMode = typeof allowedModes[number];
    let planMode: RemediationMode;
    if (selfCheck?.mode && allowedModes.includes(selfCheck.mode)) {
      planMode = selfCheck.mode;
    } else {
      const maxAffected = (parsed.diagnostics?.rootCauses ?? []).reduce(
        (m: number, rc: any) => Math.max(m, Array.isArray(rc.affectedFiles) ? rc.affectedFiles.length : 0),
        0,
      );
      planMode = maxAffected >= 5 ? 'upstream' : 'patch';
    }

    const subTaskIds: string[] = [];
    for (let i = 0; i < parsed.batches.length; i++) {
      const batch = parsed.batches[i];
      const batchPlanText = JSON.stringify({
        task: { id: `batch-${i}`, goal: batch.name },
        diagnostics: parsed.diagnostics,
        implementation: {
          modify: batch.modify || [],
          create: batch.create || [],
          delete: batch.delete || [],
        },
        rootCauseSelfCheck: selfCheck ?? { mode: planMode },
      });

      const subTask: CodeTask = {
        id: `error-fix-batch-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        name: `Fix: ${batch.name}`,
        description: batch.rationale || batch.name,
        type: 'error',
        priority: (nextTask.priority || 500) - 1,
        prePlanText: batchPlanText,
        exclusive: hasFileOverlap,
        parallelGroup: batchGroupBase ? `${batchGroupBase}-${i}` : undefined,
        remediationMode: planMode,
      };
      state.taskQueue.push(subTask);
      subTaskIds.push(subTask.id);
    }

    // Record the batch-split cycle on the Session BEFORE capturing the
    // snapshot so the carried `verification.batchSplitCount` reflects the
    // new cycle (matches the hard-limit check above). `onBatchSplit`
    // bumps the counter by one and stores the diagnostics summary used
    // by the follow-up plan prompt to avoid re-triggering the same split.
    state.verification?.onBatchSplit(JSON.stringify({
      cycle: splitCount,
      totalErrors: parsed.diagnostics?.totalErrors ?? 0,
      rootCauses: parsed.diagnostics?.rootCauses ?? [],
      batchNames: parsed.batches.map((b: any) => b.name),
    }));

    // Re-enqueue the original task (clean state) instead of creating a new one.
    // Priority FINAL_VERIFICATION(1000) > error priority(999) ensures it runs last.
    //
    // Capture the current state as a `WorkerSnapshot` and attach it to the
    // task's `resumeState` so the next worker invocation rehydrates the
    // verification session (attempts, plan history, batch-split counter,
    // previous diagnostics). Error sub-tasks pushed above do NOT need a
    // snapshot — their `prePlanText` is self-contained.
    //
    // `_failedAttempts` is NOT reset here: verification tasks read the
    // attempt counter off `resumeState.verification.attempts` while other
    // task types preserve their orchestrator retry budget. Resetting was a
    // legacy pattern that accidentally granted unlimited orchestrator
    // retries — root cause of the post-batch-split transient-retry cycle
    // observed in the `still-lacing-north` incident.
    const snapshot = snapshotFromState(state);
    const requeuedTask: CodeTask = {
      ...nextTask,
      timing: undefined,
      interrupted: !!snapshot ? true : undefined,
      _failed: undefined,
      _failureReason: undefined,
      resumeState: snapshot ?? undefined,
    } as CodeTask;
    state.taskQueue.push(requeuedTask);
    state._batchSplitRequeued = true;
    appendTrace({
      node: 'plan',
      taskId: nextTask.id,
      taskType: nextTask.type,
      extra: {
        flagSet: ['_batchSplitRequeued'],
        batchCount: parsed.batches.length,
        splitCount,
      },
    });

    logBatchSplit({
      action: 'created',
      batchCount: parsed.batches.length,
      totalErrors: parsed.diagnostics?.totalErrors ?? 0,
      rootCauses: parsed.diagnostics?.rootCauses?.length ?? 0,
      subTaskIds,
      taskQueueSize: state.taskQueue.size(),
      taskName: nextTask.name,
      hasFileOverlap,
      splitCount,
    });
    return '';
  } catch (err) {
    // T8 — `VerificationTerminalError('batch_cycle_limit')` must propagate to
    // `TaskOrchestrator.reportFailure` unchanged; the catch below is a best-
    // effort guard around JSON.parse / env coercion that would otherwise
    // swallow the terminal signal and silently re-queue the task.
    if (err instanceof VerificationTerminalError) {
      throw err;
    }
    logBatchSplit({ action: 'skipped', reason: 'json_parse_error', error: (err as Error).message, planTextPreview: planText.substring(0, 120), taskName: nextTask.name });
    return planText;
  }
}
