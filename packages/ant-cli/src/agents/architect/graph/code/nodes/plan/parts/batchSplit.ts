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

import { ArchitectGraphState, TASK_PRIORITIES } from '../../../state';
import { CodeTask } from '../../../../../types/task';
import type { TechTier } from '@ant/shared';
import { snapshotFromState } from '../../../parallel/TaskWorker';
import { appendTrace } from '../../../../../../../utils/verificationTrace';
import { VerificationTerminalError } from '../../../tasks/verification/model/errors';
import { isVerificationTask } from '../../../tasks/verification';
import { isErrorTask } from '../../../tasks/error';

/**
 * Final Verification presence check. Mirrors the helper in
 * `tasks/error/hooks/orchestrator.ts` — we duplicate the small predicate
 * instead of importing because the hook's dedup fallback and the escalate
 * path here have different call shapes and lifecycles; the priority check
 * plus "any completed verification" semantics is identical either way.
 */
function hasFinalVerification(
  queue: readonly CodeTask[],
  running: readonly CodeTask[],
  completed: readonly CodeTask[],
): boolean {
  const inFinalPriority = (t: CodeTask): boolean =>
    t.priority === TASK_PRIORITIES.FINAL_VERIFICATION;
  if (queue.some(inFinalPriority)) return true;
  if (running.some(inFinalPriority)) return true;
  if (completed.some((t: CodeTask) => t.type === 'verification')) return true;
  return false;
}

export const MAX_BATCH_SPLIT_CYCLES = 10;

/**
 * Strip markdown code fences from a string if present.
 * Handles: ```json\n...\n```, ```\n...\n```, etc.
 */
function stripMarkdownFences(text: string): string {
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
function computeBatchFileOverlap(batches: any[]): boolean {
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
  // Gate covers three populations:
  //   1. Verification tasks (Tier 3/4 final gate) — existing path.
  //   2. Error tasks emitted by decompose (Tier 3/4) — existing path. Error
  //      sub-tasks produced by a previous split carry `prePlanText` and
  //      fast-path past this function (see `plan/index.ts
  //      maybePrePlannedFastPath`); decompose-emitted error tasks fall
  //      through normal planning and may produce a multi-batch plan.
  //   3. Tier 2 escalate — any task type (feature/ui/error/setup/explain is
  //      filtered out by `selfVerifyOnDone`) whose plan exceeds the split
  //      thresholds. On escalate the original task is DROPPED and a
  //      verification task is enqueued in its place, morphing the queue
  //      into the Tier 3 shape (N sub-tasks + 1 verification).
  //      `executionTier` channel stays at 2 — this is queue-structure
  //      escalation, not a tier-channel promotion. See `.cursorrules`
  //      "Tier-Verification Alignment SSOT → Tier 2 runtime escalate".
  // Cascading splits are bounded by `MAX_BATCH_SPLIT_CYCLES` on the Session.
  const isTier2EscalateCandidate =
    state.executionTier === 2 && (nextTask as CodeTask).selfVerifyOnDone === true;
  const isBatchSplitCandidate =
    isVerificationTask(nextTask) || isErrorTask(nextTask) || isTier2EscalateCandidate;

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
    // `plan_too_short` here is a NORMAL outcome on the happy path: for
    // verification tasks whose Session has all required gates passing,
    // the plan-LLM intentionally emits an empty/near-empty plan. The
    // plan node then fires `isVerificationPassWithoutCodeGen` which
    // flips `llmResponse.done = true` so the task completes without
    // another execute call. Without the extra fields below, an operator
    // reading `batch_split: skipped` followed immediately by
    // `task_complete` could easily mistake it for a "gave up" signal.
    const isVerification = isVerificationTask(nextTask);
    const verificationComplete = state.verification?.isComplete() ?? false;
    const willPassViaShortcut = isVerification && verificationComplete;
    logBatchSplit({
      action: 'skipped',
      reason: 'plan_too_short',
      planTextLen: planText?.length ?? 0,
      taskName: nextTask.name,
      isVerification,
      verificationComplete,
      nextOutcome: willPassViaShortcut
        ? 'pass_via_empty_plan_shortcut'
        : 'skip_to_execute_or_check',
    });
    return planText;
  }
  if (!state.taskQueue || typeof state.taskQueue.push !== 'function' || typeof state.taskQueue.getAll !== 'function') {
    logBatchSplit({ action: 'skipped', reason: 'taskQueue_missing', taskQueueType: typeof state.taskQueue, constructor: state.taskQueue?.constructor?.name ?? 'N/A', taskName: nextTask.name });
    return planText;
  }

  try {
    const jsonStr = stripMarkdownFences(planText);
    const parsed = JSON.parse(jsonStr);

    // Force split-by-file when the error volume or file fan-out crosses the
    // escalation threshold, or when the LLM keeps emitting the same plan.
    const thresholdErrors = parseInt(process.env.ANT_VERIFICATION_SPLIT_ERRORS || '6', 10);
    const thresholdFiles = parseInt(process.env.ANT_VERIFICATION_SPLIT_FILES || '4', 10);
    const totalErrors: number = parsed.diagnostics?.totalErrors ?? 0;
    const modifyArr: any[] = parsed.implementation?.modify ?? [];
    const overErrorBudget = totalErrors >= thresholdErrors;
    const overFileBudget = modifyArr.length >= thresholdFiles;
    const shouldForceSplit = (!parsed.batches || !Array.isArray(parsed.batches) || parsed.batches.length <= 1)
      && (overErrorBudget || overFileBudget);

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
          : overErrorBudget
            ? 'over_error_threshold'
            : 'over_file_threshold',
        totalErrors,
        modifyCount: modifyArr.length,
        taskName: nextTask.name,
      });
      console.warn(`🚨 [BatchSplit] Forcing splitByFile escalate (totalErrors=${totalErrors}, modifyCount=${modifyArr.length})`);
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

      // Sub-task type policy:
      //   - parent = verification (Tier 3/4 Final Verification) → sub = 'error'.
      //     The verification plan narrows into file-level fix batches; each
      //     batch APPLIES a diagnostic fix (that is error-task semantic).
      //     The subsequent Final Verification re-runs gates. Keeping sub-
      //     tasks as 'error' matches the existing Tier 3/4 contract and
      //     avoids loading a verification execute variant that would try
      //     to run gates instead of applying fixes.
      //   - parent = error (Tier 3/4) → sub = 'error' (same as parent).
      //   - parent = Tier 2 runtime escalate (feature/ui/setup/error) →
      //     sub inherits parent.type. The execute variant / hooks must
      //     match the work's semantic (e.g. a feature batch applies
      //     component skeletons, not diagnostic fixes).
      //
      // `selfVerifyOnDone` is intentionally NOT set on sub-tasks — gate
      // responsibility is handed off to the verification task enqueued
      // below (Tier 2 escalate / Tier 3/4 error drop-and-replace) or to
      // the pre-existing Final Verification in the queue (Tier 3/4 verification).
      const subType: CodeTask['type'] = isVerificationTask(nextTask)
        ? 'error'
        : nextTask.type;
      const subTask: CodeTask = {
        id: `${subType}-fix-batch-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        name: `Fix: ${batch.name}`,
        description: batch.rationale || batch.name,
        type: subType,
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

    // Branch on parent role — the two paths have different invariants:
    //
    //   A. parent = verification (Tier 3/4 Final Verification that split
    //      into fix batches). Historical behaviour preserved: re-enqueue
    //      the original so its orchestrator retry budget (`_failedAttempts`)
    //      stays attached to the same task identity. Resetting that budget
    //      by spawning a fresh verification task is the legacy
    //      `still-lacing-north` regression — the snapshot ships via
    //      resumeState.verification but `_failedAttempts` must not reset.
    //
    //   B. parent = error (Tier 3/4) or Tier 2 runtime escalate (any type
    //      with selfVerifyOnDone). Drop the original and enqueue a
    //      dedicated Final Verification (priority 1000). The original's
    //      role was "apply fixes then (for Tier 2) own inline gates";
    //      after splitting, sub-tasks apply the fixes and the Final
    //      Verification (existing or newly-enqueued) owns gates. Keeping
    //      the original around as an `error` task led to the
    //      `firm-jolting-horse` regression: type=error + role=gate
    //      produced an execute prompt that told the LLM to emit a fresh
    //      remediation plan (having no memory of the sub-tasks' edits),
    //      burning minutes on re-discovery before failing on plan format.
    //
    // Both paths capture the same Session snapshot so verification cycle
    // state (batchSplitCount / planHistory / prevDiagnostics) carries to
    // the follow-up verification entry.
    const snapshot = snapshotFromState(state);
    if (isVerificationTask(nextTask)) {
      // Path A — preserve the original verification task's identity &
      // retry budget. `timing` / `_failed*` are cleared because the next
      // run starts fresh, but `_failedAttempts` is deliberately NOT reset
      // (see still-lacing-north comment above).
      const requeuedTask: CodeTask = {
        ...nextTask,
        timing: undefined,
        interrupted: !!snapshot ? true : undefined,
        _failed: undefined,
        _failureReason: undefined,
        resumeState: snapshot ?? undefined,
      } as CodeTask;
      state.taskQueue.push(requeuedTask);
    } else {
      // Path B — drop-and-replace with a dedicated Final Verification.
      // Dedup: if a Final Verification is already queued / running /
      // completed (Tier 3/4 decompose emits one; nested splits may have
      // already enqueued), skip to avoid double-gating. `onTaskComplete`
      // on error tasks has the symmetric fallback.
      const alreadyHasFinalVerification = hasFinalVerification(
        state.taskQueue.getAll(),
        [],
        state.completedTasksDetails ?? [],
      );
      if (!alreadyHasFinalVerification) {
        const techTiers: TechTier[] = [
          state.resolvedAction?.basis?.techTier?.frontend,
          state.resolvedAction?.basis?.techTier?.backend,
        ].filter((t): t is TechTier => !!t);
        const verificationTask: CodeTask = {
          id: `final-verification-batch-split-${Date.now()}`,
          name: `Final Verification (batch-split of "${nextTask.name}")`,
          type: 'verification',
          priority: TASK_PRIORITIES.FINAL_VERIFICATION,
          description: `Verify that the batch-split sub-tasks of "${nextTask.name}" resolved the diagnosed issues.`,
          techTiers,
          resumeState: snapshot ?? undefined,
        };
        state.taskQueue.push(verificationTask);
      }
    }
    // `_batchSplitRequeued` semantics: "this plan cycle is handed off to
    // newly-enqueued tasks; do NOT mark the current task as completed in
    // checkTaskStatus." Applies to both paths — path A re-queues the
    // original so the current cycle shouldn't mark it complete; path B
    // drops the original, which likewise must not be recorded as complete.
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
