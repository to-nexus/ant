/**
 * plan/parts/entry.ts — STEP 0 entry dispatcher for the plan node.
 *
 * Extracted from `nodes/plan/index.ts` as part of T6b-α. Behaviour is
 * byte-identical to the inline implementation; only module boundary moves.
 *
 * Responsibilities:
 *   - `resolvePlanEntry(state)` selects one of four handlers based on the
 *     entry reason and returns a `PlanEntryContext` the orchestrator
 *     consumes to drive STEP 0.5~STEP 4.
 *   - Handlers own the per-reason state mutations (conversations clears,
 *     tracker resets, retry-summary rendering) so the orchestrator has no
 *     branching on entry reason.
 *   - `recomputeInstallNeeded` centralises the dep-file-hash probe shared
 *     across retry / reverify / fresh paths.
 *
 * R1 invariants preserved:
 *   - Task-type discrimination uses the `isVerificationTask` predicate
 *     from `tasks/verification/model/is.ts` (imported via the bundle
 *     barrel). No literal `task.type === '...'` comparisons remain.
 *     Session hydration dispatches through `hooksForTaskType(nextTask.type)
 *     ?.plan?.initSession` so task types that do not carry a session
 *     (error/setup/ui/...) are no-ops automatically.
 */

import { getTechTier } from '@ant/shared';
import { CONV_KEYS } from '../../../../../../common/graph/conversations';
import { ArchitectGraphState } from '../../../state';
import { CodeTask } from '../../../../../types/task';
import { formatViolations } from '../../../utils/violationFormatter';
import { detectTestFilesFromDisk } from '../testFileDetector';
import {
  MAX_VERIFICATION_ATTEMPTS,
} from '../../../tasks/verification/model/Session';
import { snapshotFromState } from '../../../parallel/TaskWorker';
import { VerificationTerminalError } from '../../../tasks/verification/model/errors';
import { isVerificationTask } from '../../../tasks/verification';
import { hooksForTaskType } from '../../../tasks/_shared/registry';
import {
  summarizeForRetry,
  renderRetrySummary,
  describeRetryRetention,
  dedupeViolationsAgainstSummary,
} from '../../../../../../../core/context/taskRetryRetention';

export interface PlanEntryContext {
  nextTask: CodeTask;
  isRetry: boolean;
  preservedRetries: number;
  retrySummaryText: string | undefined;
  skipKeywordAndRAG: boolean;
  inToolLoop: boolean;
}

interface PlanEntryFlags {
  inToolLoop: boolean;
  isRetry: boolean;
  preservedRetries: number;
}

function isTypeScriptProject(state: ArchitectGraphState): boolean {
  const taskTiers = state.currentTask?.techTiers;
  const firstTierLang = taskTiers && taskTiers.length > 0
    ? taskTiers[0].language
    : getTechTier(state)?.language;
  return (firstTierLang ?? '').toLowerCase().includes('typescript');
}

/**
 * Compose the verification prompt's `violationsText` from its three
 * possible sources (current violations, accumulated diagnostic retry context,
 * prior-attempt summary). Returning undefined when everything is empty keeps
 * the prompt template's `{{#if isRetry}}` branch clean.
 */
export function composeViolationsText(
  violations: import('../../../state').Violation[] | undefined,
  diagnosticRetryContext: string | undefined,
  retrySummaryText: string | undefined,
): string | undefined {
  const parts: string[] = [];

  // Delegate dedupe to the shared retention module so the policy "retry
  // summary already describes this failure — drop verification_incomplete"
  // lives next to the summary rendering logic.
  const effectiveViolations = dedupeViolationsAgainstSummary(violations, retrySummaryText);

  if (effectiveViolations?.length) parts.push(formatViolations(effectiveViolations));
  if (diagnosticRetryContext) parts.push(diagnosticRetryContext);
  if (retrySummaryText) parts.push(retrySummaryText);
  return parts.length ? parts.join('\n') : undefined;
}

/**
 * Recompute install-needed status from the dep-file hash on disk via
 * `invalidationScope.deriveInstallDecision`.
 * Single source of truth for all plan entry paths (first-entry, retry, reverify).
 *
 * The decision is written directly onto `state.verification`: the Session is
 * the SSOT for dependency status (`dependencyStatus()` / `installNeeded()`).
 * `markInstallNeeded` touches only the flag — gate invalidation happens via
 * the tool hook on actual file writes, not here — while `onInstallResolved`
 * also persists the adopted hash when deps are newly consistent.
 */
async function recomputeInstallNeeded(
  state: ArchitectGraphState,
  opts?: { detectPmIfMissing?: boolean },
): Promise<void> {
  const featureRoot = state.deps?.fileSystem?.getRootPath?.();
  if (!featureRoot) return;
  const session = state.verification;
  if (!session) return;
  try {
    const { computeDepFileHash, hasInstalledDeps, detectPackageManager } = await import(
      '../../../../../../common/tool/handlers/runCommand'
    );
    const currentHash = await computeDepFileHash(featureRoot);
    const savedHash = session.depHash();
    const depsExist = await hasInstalledDeps(featureRoot);

    const { deriveInstallDecision } = await import(
      '../../../../../../common/tool/handlers/invalidationScope'
    );
    const decision = deriveInstallDecision(savedHash, currentHash, depsExist);
    session.markInstallNeeded(decision.installNeeded);
    if (!decision.installNeeded && decision.adoptedHash) {
      session.onInstallResolved(decision.adoptedHash);
    }
    console.log(
      `📦 [Plan] Dependency install needed: ${decision.installNeeded} (${decision.reason}; ` +
      `savedHash=${savedHash?.substring(0, 8) ?? 'none'}, currentHash=${currentHash?.substring(0, 8) ?? 'none'}, depsExist=${depsExist})`,
    );

    if (opts?.detectPmIfMissing && !state._detectedPackageManager) {
      const detectedPM = await detectPackageManager(featureRoot);
      if (detectedPM) {
        state._detectedPackageManager = detectedPM;
        console.log(`📦 [Plan] Detected package manager: ${detectedPM}`);
      }
    }
  } catch (err) {
    session.markInstallNeeded(true);
    console.warn(`⚠️ [Plan] Dependency hash check failed, defaulting to installNeeded=true: ${err}`);
  }
}

export async function resolvePlanEntry(state: ArchitectGraphState): Promise<PlanEntryContext> {
  const inToolLoop = state._activePhase === 'plan' && !!state.currentTask;
  const entryReason = inToolLoop ? undefined : state._nextPlanEntry;
  if (!inToolLoop) state._nextPlanEntry = undefined;
  const isRetry = entryReason === 'retry';
  // Scenario harness escape hatch: when ANT_SCENARIO_PRESERVE_RETRIES=1,
  // never reset retries from a non-retry plan entry either.
  const preserveRetriesAlways = process.env.ANT_SCENARIO_PRESERVE_RETRIES === '1';
  const preservedRetries = (inToolLoop || isRetry || preserveRetriesAlways) ? state.retries : 0;
  const flags: PlanEntryFlags = { inToolLoop, isRetry, preservedRetries };

  if (inToolLoop) {
    return handleToolLoopReentry(state, flags);
  }
  if (entryReason === 'retry' && state.currentTask) {
    return await handleRetryEntry(state, flags);
  }
  if (entryReason === 'reverify' && state.currentTask) {
    return await handleReverifyEntry(state, flags);
  }
  return await handleFreshTaskEntry(state, flags);
}

function handleToolLoopReentry(
  state: ArchitectGraphState,
  flags: PlanEntryFlags,
): PlanEntryContext {
  const nextTask = state.currentTask!;
  console.log(`\n🔄 [Plan] Re-entry from tool loop for task: ${nextTask.name}\n`);
  return {
    nextTask,
    isRetry: flags.isRetry,
    preservedRetries: flags.preservedRetries,
    retrySummaryText: undefined,
    skipKeywordAndRAG: false,
    inToolLoop: flags.inToolLoop,
  };
}

async function handleRetryEntry(
  state: ArchitectGraphState,
  flags: PlanEntryFlags,
): Promise<PlanEntryContext> {
  const nextTask = state.currentTask!;

  if (state.retries >= state.maxRetries) {
    console.error(`\n❌ [Plan] Max retries (${state.maxRetries}) exceeded for task: ${nextTask.name}`);
    console.error(`   Current retries: ${state.retries}`);
    console.error(`   This task has failed repeatedly and cannot be fixed automatically.\n`);

    throw new VerificationTerminalError(
      'max_retries_exceeded',
      `Task "${nextTask.name}" failed after ${state.retries} attempts (max: ${state.maxRetries}). Cannot proceed with automatic fixes.`,
      snapshotFromState(state)?.verification,
    );
  }

  const prevCallIndex = state._executeCallIndex || 0;
  const isVerificationRetry = isVerificationTask(nextTask);
  let retrySummaryText: string | undefined;

  if (isVerificationRetry) {
    // Snapshot the inbound violation count before clearing so the retry log
    // reflects the previous attempt's failure count rather than the cleared 0.
    const prevViolationCount = state.violations?.length ?? 0;

    // Session owns the retry/reverify attempt counter and per-cycle gate
    // invalidation (onPlanEntry('retry') clears `attemptedThisCycle`).
    state.verification?.onPlanEntry('retry');
    state._executeCallIndex = 0;
    retrySummaryText = renderRetrySummary(summarizeForRetry({
      violations: state.violations,
      lastPlan: state.planText,
    }, {
      attemptCount: (state.retries || 0) + 1,
      commandHistory: state.commandHistory,
    }));
    state.violations = [];
    state.conversations = {
      ...state.conversations,
      [CONV_KEYS.NODE_EXECUTE]: [],
      [CONV_KEYS.NODE_PLAN]: [],
    };
    state._executeModifiedFiles = false;
    await recomputeInstallNeeded(state);
    const _retryAttempt = (state.retries || 0) + 1;
    const _retryMax = state.maxRetries || 3;
    const sessionAttempts = state.verification?.attempts() ?? 0;
    console.log(`\n🔄 [Plan] Verification retry: ${nextTask.name} (attempt ${_retryAttempt}/${_retryMax}, verificationAttempts=${sessionAttempts}/${MAX_VERIFICATION_ATTEMPTS})`);
    console.log(`   ♻️  Reset: conversations cleared, _executeCallIndex ${prevCallIndex}→0`);
    console.log(`   ♻️  Preserved: _finalTaskLoopCount = ${state._finalTaskLoopCount || 0}\n`);
    if (nextTask && state.context?.featurePath && state._httpJobId) {
      const _taskRef = nextTask;
      const _retention = describeRetryRetention(retrySummaryText, state.verification?.passed());
      const _prevPlanHash = state.verification?.snapshot().planHistoryHashes.at(-1);
      const _carryOverBytes = JSON.stringify(snapshotFromState(state) || {}).length;
      import('../../../../../../../core/utils/executionLogger').then(({ getExecutionLogger }) => {
        getExecutionLogger({
          featurePath: state.context!.featurePath!,
          jobId: state._httpJobId!,
          jobType: 'code',
        }).logVerificationRetry(_taskRef.id, {
          taskName: _taskRef.name,
          attempt: _retryAttempt,
          maxAttempts: _retryMax,
          // preservedHistoryLength / preservedCallIndex are @deprecated schema
          // placeholders — summary-based retention (RetrySummary injection) is
          // the SSOT for carried retry context, so these stay 0.
          preservedHistoryLength: 0,
          preservedCallIndex: 0,
          violationsFromPrevAttempt: prevViolationCount,
          retentionMode: _retention.retentionMode,
          summaryInjected: _retention.summaryInjected,
          summaryLen: _retention.summaryLen,
          passedGatesAtRetry: _retention.passedGatesAtRetry,
          verificationAttempts: sessionAttempts,
          prevPlanHash: _prevPlanHash,
          carryOverSize: _carryOverBytes,
        }).catch(() => {});
      }).catch(() => {});
    }
  } else {
    state._executeCallIndex = 0;
    state._finalTaskLoopCount = 0;
    retrySummaryText = renderRetrySummary(summarizeForRetry({
      violations: state.violations,
      lastPlan: state.planText,
    }, {
      attemptCount: (state.retries || 0) + 1,
      commandHistory: state.commandHistory,
    }));
    state.violations = [];
    state.conversations = {
      ...state.conversations,
      [CONV_KEYS.NODE_EXECUTE]: [],
      [CONV_KEYS.NODE_PLAN]: [],
    };
    console.log(`\n🔄 [Plan] Retry task: ${nextTask.name} (attempt ${(state.retries || 0) + 1}/${state.maxRetries})`);
    console.log(`   ♻️  Reset: _executeCallIndex ${prevCallIndex}→0, conversations cleared; retry summary flows via violationsText\n`);
  }

  return {
    nextTask,
    isRetry: flags.isRetry,
    preservedRetries: flags.preservedRetries,
    retrySummaryText,
    skipKeywordAndRAG: false,
    inToolLoop: flags.inToolLoop,
  };
}

async function handleReverifyEntry(
  state: ArchitectGraphState,
  flags: PlanEntryFlags,
): Promise<PlanEntryContext> {
  const nextTask = state.currentTask!;
  console.log(`\n🔄 [Plan] Post-execute final verification: ${nextTask.name}`);
  console.log(`   Resetting per-cycle attempted gates via Session.onPlanEntry('reverify')\n`);

  // Session is authoritative — `onPlanEntry('reverify')` bumps the attempt
  // counter and clears `attemptedThisCycle` while preserving already-passed
  // gates. `onPlanApplied` pushes the body into the bounded history buffer
  // and records the hash list consumed by `isPlanRepeated`.
  state.verification?.onPlanEntry('reverify');
  if (state.planText) {
    state.verification?.onPlanApplied(state.planText);
  }

  state._executeCallIndex = 0;
  state.conversations = { ...state.conversations, [CONV_KEYS.NODE_EXECUTE]: [], [CONV_KEYS.NODE_PLAN]: [] };
  state._executeModifiedFiles = false;
  state.violations = [];

  await recomputeInstallNeeded(state, { detectPmIfMissing: true });

  return {
    nextTask,
    isRetry: flags.isRetry,
    preservedRetries: flags.preservedRetries,
    retrySummaryText: undefined,
    skipKeywordAndRAG: true,
    inToolLoop: flags.inToolLoop,
  };
}

async function handleFreshTaskEntry(
  state: ArchitectGraphState,
  flags: PlanEntryFlags,
): Promise<PlanEntryContext> {
  const _wid = state.workerId;
  const isWorkerCtx = _wid !== undefined && _wid !== null;

  let nextTask: CodeTask;
  if (isWorkerCtx && state.currentTask) {
    nextTask = state.currentTask;
    console.log(`\n📋 [Plan] Task pre-assigned by orchestrator (worker ${_wid}): ${nextTask.name}\n`);
  } else {
    const popped = state.taskQueue?.pop();
    if (!popped) {
      throw new Error('[Plan] No tasks in queue');
    }
    nextTask = popped;
    console.log(`\n📋 [Plan] Next task: ${nextTask.name}\n`);
  }

  const { TaskTimingHelper } = await import('../../../state');
  console.log(`⏱️  Starting timer for task: ${nextTask.name}`);
  nextTask = TaskTimingHelper.startTask(nextTask);

  const { resetTaskTokenUsage } = await import('../../../../../../common/graph/llmHelpers');
  resetTaskTokenUsage(state);
  state._executeCallIndex = 0;
  state._planSearchWebCount = 0;

  if (isVerificationTask(nextTask)) {
    const isResumedVerification = !!state.verification && state.verification.attempts() > 0;
    const tsProject = isTypeScriptProject(state);
    const hasTests = detectTestFilesFromDisk(state.context?.featurePath);

    // Single writer of `state.verification` on fresh entry. Merge-aware:
    //   - missing         → createFresh(env)
    //   - seeded partial  → hydrateEnv(env) populates required/passed
    //   - fully rehydrated → no-op
    // Dispatched via `hooksForTaskType(nextTask.type)` rather than
    // `hooksIfActive(state)` because `state.currentTask` is not yet
    // assigned in the fresh-entry path — `nextTask` is still a local.
    hooksForTaskType(nextTask.type)?.plan?.initSession?.(state, { isTs: tsProject, hasTests });

    const sessionAttempts = state.verification?.attempts() ?? 0;
    const sessionBudget = state.verification?.remainingBudget() ?? MAX_VERIFICATION_ATTEMPTS;
    console.log(`🔍 [Plan] VerificationSession ${isResumedVerification ? 'rehydrated' : 'initialised'}: required=${state.verification?.required().join('+') ?? ''}, passed=${state.verification?.passed().join('+') ?? ''}`);
    console.log(`🎫 [Plan] verificationAttempts=${sessionAttempts}/${MAX_VERIFICATION_ATTEMPTS} (budget remaining=${sessionBudget})`);

    await recomputeInstallNeeded(state, { detectPmIfMissing: true });
  }

  if (state.context?.featurePath && state._httpJobId) {
    const { getExecutionLogger } = await import('../../../../../../../core/utils/executionLogger');
    const execLogger = getExecutionLogger({
      featurePath: state.context.featurePath,
      jobId: state._httpJobId,
      jobType: 'code',
    });
    execLogger.logTaskStart(nextTask.id, {
      taskName: nextTask.name,
      taskType: nextTask.type,
      priority: nextTask.priority,
      isParallel: !!(nextTask as any).parallelGroup,
      parallelGroup: (nextTask as any).parallelGroup,
    }).catch(() => {});
  }

  // Skip in worker context — TaskOrchestrator handles kanban for parallel mode.
  if (!isWorkerCtx && state._httpJobId && state.deps?.kanbanUpdate) {
    console.log(`🔥 [Plan] Updating Kanban → task started`);
    console.log(`   Current: ${nextTask.name}`);
    console.log(`   Remaining in queue: ${state.taskQueue?.size() || 0}\n`);

    state.deps.kanbanUpdate.updateTaskQueue(
      state._httpJobId,
      nextTask,
      state.taskQueue?.getAll() || [],
      state.completedTasksDetails || [],
      state.recursionCount,
      state.recursionLimit,
    );
  } else if (!isWorkerCtx) {
    if (!state._httpJobId) console.warn(`⚠️ [Plan] Kanban skipped: _httpJobId is missing`);
    if (!state.deps?.kanbanUpdate) console.warn(`⚠️ [Plan] Kanban skipped: deps.kanbanUpdate is null (broadcaster not injected)`);
  } else {
    console.log(`📋 [Plan] Kanban skipped: isWorkerCtx=true (orchestrator handles)`);
  }

  // Checkpoint save
  if (!isWorkerCtx && state.deps?.session && state.context.featureFolder) {
    try {
      const { saveCheckpoint } = await import('../../../session/checkpoint');
      await saveCheckpoint({
        ...state,
        currentTask: nextTask,
      });
    } catch (err) {
      console.warn(`⚠️  [Plan] Failed to save task-start checkpoint: ${err}`);
    }
  }

  return {
    nextTask,
    isRetry: flags.isRetry,
    preservedRetries: flags.preservedRetries,
    retrySummaryText: undefined,
    skipKeywordAndRAG: false,
    inToolLoop: flags.inToolLoop,
  };
}
