import type { TechTier } from '@ant/shared';
import { ArchitectGraphState, TASK_PRIORITIES } from '../../../state';
import { CodeTask } from '../../../../../types/task';
import { snapshotFromState } from '../../../parallel/TaskWorker';
import { appendTrace } from '../../../../../../../utils/verificationTrace';
import { VerificationTerminalError } from '../verify/terminal/errors';
import { VerificationBudget } from '../verify/terminal/budget';
import { isVerificationTask } from '../../verification';
import { getExecutionLogger } from '../../../../../../../core/utils/executionLogger';
import { stripMarkdownFences } from './parse';
import { computeBatchFileOverlap } from './overlap';
import { hasFinalVerification } from './finalVerification';
import { MAX_BATCH_SPLIT_CYCLES } from './cycleLimit';
import {
  BATCH_SPLIT_POLICY,
  diagnosticBatchShape,
} from './policy';

/**
 * Detect a diagnostic / remediation plan and fan it out into sub-tasks.
 *
 * Always-fan-out: any plan with 1+ implementation entries (modify/create/
 * delete) or 1+ batches[] is split. Top-level entries with no `batches[]`
 * are auto-converted to per-target batches so every entry becomes its own
 * fix-apply sub-task.
 *
 * Hard cap: `MAX_BATCH_SPLIT_CYCLES`. After the cap, throws
 * `VerificationTerminalError('batch_cycle_limit')`.
 *
 * @returns updated planText (`''` when fan-out fired, original otherwise).
 */
export function processDiagnosticBatchSplit(
  state: ArchitectGraphState,
  planText: string,
  nextTask: CodeTask,
): string {
  // Tier 2 escalate (no policy entry) hijacks the gate — `selfVerifyOnDone`
  // tasks are dropped and the queue is morphed into the Tier 3 shape
  // (N sub-tasks + 1 Final Verification).
  const isTier2EscalateCandidate =
    state.executionTier === 2 && (nextTask as CodeTask).selfVerifyOnDone === true;
  const taskPolicy = BATCH_SPLIT_POLICY[nextTask.type];
  const isBatchSplitCandidate = !!taskPolicy || isTier2EscalateCandidate;

  const logBatchSplit = (data: Record<string, any>) => {
    if (state.context?.featurePath && state._httpJobId) {
      void getExecutionLogger({
        featurePath: state.context.featurePath,
        jobId: state._httpJobId,
        jobType: 'code',
      })
        .log('batch_split', data, nextTask.id)
        .catch(() => { /* non-blocking */ });
    }
  };

  if (!isBatchSplitCandidate) {
    return planText;
  }
  if (!planText || planText.length <= 50) {
    // For a verification task, an empty plan flips `done:true` via
    // `isVerificationPassWithoutCodeGen`. Surface that distinction so the
    // log isn't mistaken for a "gave up" signal.
    const isVerification = isVerificationTask(nextTask);
    logBatchSplit({
      action: 'skipped',
      reason: 'plan_too_short',
      planTextLen: planText?.length ?? 0,
      taskName: nextTask.name,
      parentType: nextTask.type,
      isVerification,
      nextOutcome: isVerification
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

    const totalErrors: number = parsed.diagnostics?.totalErrors ?? 0;
    const modifyArr: any[] = Array.isArray(parsed.implementation?.modify) ? parsed.implementation.modify : [];
    const createArr: any[] = Array.isArray(parsed.implementation?.create) ? parsed.implementation.create : [];
    const deleteArr: any[] = Array.isArray(parsed.implementation?.delete) ? parsed.implementation.delete : [];
    const hasExistingBatches = Array.isArray(parsed.batches) && parsed.batches.length > 0;
    const topLevelImplCount = modifyArr.length + createArr.length + deleteArr.length;

    if (!hasExistingBatches && topLevelImplCount > 0) {
      logBatchSplit({
        action: 'auto_convert_top_level',
        modifyCount: modifyArr.length,
        createCount: createArr.length,
        deleteCount: deleteArr.length,
        totalErrors,
        taskName: nextTask.name,
      });
      const batchesAcc: any[] = [];
      for (const m of modifyArr) {
        const target = typeof m === 'string' ? m : (m.target || m.file || `modify-${batchesAcc.length}`);
        batchesAcc.push({
          name: `Fix ${target}`,
          rationale: (m && m.action) || `Apply modifications to ${target}`,
          modify: [m],
          create: [],
          delete: [],
        });
      }
      for (const c of createArr) {
        const target = typeof c === 'string' ? c : (c.target || c.file || `create-${batchesAcc.length}`);
        batchesAcc.push({
          name: `Create ${target}`,
          rationale: (c && c.purpose) || `Create ${target}`,
          modify: [],
          create: [c],
          delete: [],
        });
      }
      for (const d of deleteArr) {
        const target = typeof d === 'string' ? d : (d.target || d.file || `delete-${batchesAcc.length}`);
        batchesAcc.push({
          name: `Delete ${target}`,
          rationale: (d && d.reason) || `Delete ${target}`,
          modify: [],
          create: [],
          delete: [d],
        });
      }
      parsed.batches = batchesAcc;
    }

    if (!parsed.batches || !Array.isArray(parsed.batches) || parsed.batches.length === 0) {
      logBatchSplit({ action: 'skipped', reason: 'no_implementation_entries', batchCount: 0, taskName: nextTask.name });
      return planText;
    }

    // Cycle counter lives on `task.batchSplitCount` (carried across re-queue
    // via the resumeState snapshot + the explicit field assignment in the
    // Path A / Path B branches below). Pre-bump value so the terminal-throw
    // snapshot below sees the magnitude that the upcoming write will set.
    const splitCount = VerificationBudget.peekNextBatchSplit(state, nextTask);

    if (splitCount > MAX_BATCH_SPLIT_CYCLES) {
      logBatchSplit({ action: 'cycle_limit_failed', splitCount, taskName: nextTask.name });
      console.error(`❌ [BatchSplit] Cycle limit (${MAX_BATCH_SPLIT_CYCLES}) exceeded for "${nextTask.name}". Throwing terminal error.`);
      appendTrace({
        node: 'plan',
        taskId: nextTask.id,
        taskType: nextTask.type,
        extra: { reason: 'cycle_limit_terminal', splitCount },
      });
      throw new VerificationTerminalError(
        'batch_cycle_limit',
        `Batch split cycle limit (${MAX_BATCH_SPLIT_CYCLES}) exceeded for "${nextTask.name}" after ${splitCount} cycles.`,
      );
    }

    const hasFileOverlap = computeBatchFileOverlap(parsed.batches);
    const batchGroupBase = hasFileOverlap ? null : `${nextTask.type}-batch-${Date.now()}`;

    // `rootCauseSelfCheck.mode` propagates to each sub-task; fall back to
    // a heuristic when the LLM did not self-report.
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

      // `selfVerifyOnDone` is intentionally NOT set on sub-tasks — gate
      // responsibility hands off to the Final Verification (Path B) or
      // to the pre-existing FV (Path A).
      const subType: CodeTask['type'] = taskPolicy?.subType ?? nextTask.type;
      const shape = taskPolicy?.shape ?? diagnosticBatchShape;
      const batchPlanText = shape({ parsed, batch, batchIndex: i, planMode });

      const namePrefix = subType === 'test-code' ? 'Tests' : 'Fix';
      const subTask: CodeTask = {
        id: `${subType}-batch-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        name: `${namePrefix}: ${batch.name}`,
        description: batch.rationale || batch.name,
        type: subType,
        priority: (nextTask.priority || 500) - 1,
        prePlanText: batchPlanText,
        exclusive: hasFileOverlap,
        parallelGroup: batchGroupBase ? `${batchGroupBase}-${i}` : undefined,
      };
      if (taskPolicy?.populateRemediationMode !== false) {
        subTask.remediationMode = planMode;
      }
      state.taskQueue.push(subTask);
      subTaskIds.push(subTask.id);
    }

    // Bump the batch-split counter on the originating verification task.
    // Carried across re-queues by `task.resumeState`; the `batch_cycle_limit`
    // fail-safe reads it via `VerificationBudget.fromState`.
    const newBatchSplitCount = (nextTask.batchSplitCount ?? 0) + 1;

    // Path A re-enqueues the original to preserve identity / `_failedAttempts`;
    // Path B drops it and (optionally) enqueues a Final Verification.
    const snapshot = snapshotFromState(state);
    const effectiveKind: 'requeue-parent' | 'drop-and-replace' =
      taskPolicy?.kind ?? 'drop-and-replace';
    if (effectiveKind === 'requeue-parent') {
      const requeuedTask: CodeTask = {
        ...nextTask,
        timing: undefined,
        interrupted: !!snapshot ? true : undefined,
        _failed: undefined,
        _failureReason: undefined,
        resumeState: snapshot ?? undefined,
        batchSplitCount: newBatchSplitCount,
      } as CodeTask;
      state.taskQueue.push(requeuedTask);
      // Clear keyword-RAG dedup so the parent's next plan entry re-fires
      // keyword RAG (vast-curling-perch D-0). Lazy-required to keep the
      // batchSplit module free of plan-layer imports at module init time.
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { clearKeywordDedupForTask } = require('../../../nodes/plan/rag');
        clearKeywordDedupForTask(nextTask.id);
      } catch { /* non-blocking */ }
    } else {
      const shouldAppendFV = taskPolicy?.appendFinalVerification ?? true;
      if (shouldAppendFV) {
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
            batchSplitCount: newBatchSplitCount,
          };
          state.taskQueue.push(verificationTask);
        }
      }
    }
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
      parentType: nextTask.type,
      subType: taskPolicy?.subType ?? nextTask.type,
      kind: effectiveKind,
      hasFileOverlap,
      splitCount,
    });
    return '';
  } catch (err) {
    // T8 — `VerificationTerminalError` must propagate; only swallow JSON-
    // parse / coercion errors that would otherwise lose the terminal signal.
    if (err instanceof VerificationTerminalError) {
      throw err;
    }
    logBatchSplit({ action: 'skipped', reason: 'json_parse_error', error: (err as Error).message, planTextPreview: planText.substring(0, 120), taskName: nextTask.name });
    return planText;
  }
}
