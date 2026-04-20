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
 *   - `task.type === 'verification'` branches here are transitional. They
 *     will migrate onto `hooks.plan.classifyEntry` / `onEntry` during the
 *     remainder of T6b-α. For now they stay inline so the split is a
 *     pure refactor with no semantic change.
 */

import { getTechTier } from '@ant/shared';
import { CONV_KEYS } from '../../../../../../common/graph/conversations';
import { ArchitectGraphState } from '../../../state';
import { CodeTask } from '../../../../../types/task';
import { formatViolations } from '../../shared/violationFormatter';
import { detectTestFilesFromDisk } from '../testFileDetector';
import {
  MAX_VERIFICATION_ATTEMPTS,
  remainingBudget,
  usedAttempts,
} from '../../../utils/verificationAttempts';
import { lastPlanHash } from '../../../utils/verificationLoopEscape';
import { snapshotFromState } from '../../../parallel/TaskWorker';
import { VerificationTerminalError } from '../../../utils/verificationErrors';
import { hooksIfActive } from '../../../tasks/_shared/registry';
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

export function isTypeScriptProject(state: ArchitectGraphState): boolean {
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
 * Bump the unified verification attempt counter. Called on every retry/reverify
 * re-entry into a verification task. A fresh task entry does NOT call this
 * (attempts=0 represents "first cycle").
 */
function bumpVerificationAttempt(state: ArchitectGraphState): void {
  state._verificationAttempts = (state._verificationAttempts || 0) + 1;
}

/**
 * Recompute install-needed status from the dep-file hash on disk via
 * `invalidationScope.deriveInstallDecision`.
 * Single source of truth for all plan entry paths (first-entry, retry, reverify).
 */
export async function recomputeInstallNeeded(
  state: ArchitectGraphState,
  opts?: { detectPmIfMissing?: boolean },
): Promise<void> {
  const featureRoot = state.deps?.fileSystem?.getRootPath?.();
  if (!featureRoot) return;
  try {
    const { computeDepFileHash, hasInstalledDeps, detectPackageManager } = await import(
      '../../../../../../common/tool/handlers/runCommand'
    );
    const currentHash = await computeDepFileHash(featureRoot);
    const savedHash = state._depFileHash;
    const depsExist = await hasInstalledDeps(featureRoot);

    const { deriveInstallDecision } = await import(
      '../../../../../../common/tool/handlers/invalidationScope'
    );
    const decision = deriveInstallDecision(savedHash, currentHash, depsExist);
    state._installNeeded = decision.installNeeded;
    if (decision.adoptedHash) {
      state._depFileHash = decision.adoptedHash;
    }
    // T4b-α: mirror dep-hash / install-needed decision into the Session.
    // `markInstallNeeded` touches only the flag (matching the legacy
    // `state._installNeeded = decision.installNeeded` behaviour — gate
    // invalidation happens via the tool hook on actual file writes, not
    // here). When the decision concludes deps are freshly consistent,
    // `onInstallResolved` also persists the adopted hash.
    if (state.verification) {
      state.verification.markInstallNeeded(decision.installNeeded);
      if (!decision.installNeeded && decision.adoptedHash) {
        state.verification.onInstallResolved(decision.adoptedHash);
      }
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
    state._installNeeded = true;
    state.verification?.markInstallNeeded(true);
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
      snapshotFromState(state),
    );
  }

  const prevCallIndex = state._executeCallIndex || 0;
  const isVerificationRetry = nextTask.type === 'verification';
  let retrySummaryText: string | undefined;

  if (isVerificationRetry) {
    bumpVerificationAttempt(state);
    // T4b-α: Session is the authoritative counter for retry/reverify
    // attempts; dual-write keeps legacy consumers working during the
    // coexistence window.
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
    if (state._verificationTracker) {
      state._verificationTracker.buildAttempted = false;
      state._verificationTracker.testAttempted = false;
      state._verificationTracker.typecheckAttempted = false;
    }
    const _retryAttempt = (state.retries || 0) + 1;
    const _retryMax = state.maxRetries || 3;
    console.log(`\n🔄 [Plan] Verification retry: ${nextTask.name} (attempt ${_retryAttempt}/${_retryMax}, verificationAttempts=${usedAttempts(state)}/${MAX_VERIFICATION_ATTEMPTS})`);
    console.log(`   ♻️  Reset: conversations cleared, _executeCallIndex ${prevCallIndex}→0`);
    console.log(`   ♻️  Preserved: _finalTaskLoopCount = ${state._finalTaskLoopCount || 0}\n`);
    if (nextTask && state.context?.featurePath && state._httpJobId) {
      const _taskRef = nextTask;
      const _retention = describeRetryRetention(retrySummaryText, state._verificationTracker);
      const _prevPlanHash = lastPlanHash(state._appliedPlanHistory);
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
          preservedHistoryLength: 0,
          preservedCallIndex: 0,
          violationsFromPrevAttempt: state.violations?.length ?? 0,
          retentionMode: _retention.retentionMode,
          summaryInjected: _retention.summaryInjected,
          summaryLen: _retention.summaryLen,
          passedGatesAtRetry: _retention.passedGatesAtRetry,
          verificationAttempts: usedAttempts(state),
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
  console.log(`   Re-initializing VerificationTracker for fresh build/test check\n`);

  bumpVerificationAttempt(state);
  // T4b-α: mirror attempt bump + plan history push into the Session.
  // `onPlanApplied` pushes the body into the bounded buffer and maintains
  // the hash list that `isPlanRepeated` consults; dual-write keeps the
  // legacy `_appliedPlanHistory` array populated for coexistence.
  state.verification?.onPlanEntry('reverify');
  if (state.planText) {
    state.verification?.onPlanApplied(state.planText);
  }

  if (state.planText) {
    const history = (state._appliedPlanHistory || []) as string[];
    history.push(state.planText);
    state._appliedPlanHistory = history;
  }

  const prev = state._verificationTracker;
  state._verificationTracker = {
    buildPassed: prev?.buildPassed ?? false,
    testPassed: prev?.testPassed ?? false,
    testsRequired: prev?.testsRequired ?? detectTestFilesFromDisk(state.context?.featurePath),
    typecheckPassed: prev?.typecheckPassed ?? false,
    typecheckRequired: prev?.typecheckRequired ?? isTypeScriptProject(state),
    buildAttempted: false,
    testAttempted: false,
    typecheckAttempted: false,
  };

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

  if (nextTask.type === 'verification') {
    const isResumedVerification = state._verificationAttempts !== undefined;
    const tsProject = isTypeScriptProject(state);
    const hasTests = detectTestFilesFromDisk(state.context?.featurePath);

    if (!state._verificationTracker) {
      state._verificationTracker = {
        buildPassed: false,
        testPassed: false,
        testsRequired: hasTests,
        buildAttempted: false,
        testAttempted: false,
        typecheckPassed: false,
        typecheckAttempted: false,
        typecheckRequired: tsProject,
      };
    }
    if (state._appliedPlanHistory === undefined) {
      state._appliedPlanHistory = [];
    }
    if (state._verificationAttempts === undefined) state._verificationAttempts = 0;

    // T4b-α: populate `state.verification` (VerificationSession SSOT) alongside
    // the legacy dual-write. Idempotent: `initSession` is a no-op when the
    // session was already rehydrated by runner resume or worker restore.
    hooksIfActive(state)?.plan?.initSession?.(state, { isTs: tsProject, hasTests });

    console.log(`🔍 [Plan] VerificationTracker ${isResumedVerification ? 'restored (resume)' : 'initialized'}: testsRequired=${state._verificationTracker.testsRequired}, typecheckRequired=${tsProject}`);
    console.log(`🎫 [Plan] verificationAttempts=${state.verification?.attempts() ?? usedAttempts(state)}/${MAX_VERIFICATION_ATTEMPTS} (budget remaining=${state.verification?.remainingBudget() ?? remainingBudget(state)})`);

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
      const { saveCheckpoint } = await import('../../checkpoint');
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
