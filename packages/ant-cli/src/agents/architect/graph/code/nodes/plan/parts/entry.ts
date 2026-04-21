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
 *
 * Violation guidance (cross_worker_conflict / file_operation_failed) is
 * appended here — formatter authority lives in one place (plan) after the
 * enforce node removal (docs/tmp/enforce-node-removal-handoff.md §3.5).
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

  if (effectiveViolations?.length) {
    parts.push(formatViolations(effectiveViolations));
    const guidance = renderViolationGuidance(effectiveViolations);
    if (guidance) parts.push(guidance);
  }
  if (diagnosticRetryContext) parts.push(diagnosticRetryContext);
  if (retrySummaryText) parts.push(retrySummaryText);
  return parts.length ? parts.join('\n') : undefined;
}

/**
 * Type-specific, actionable guidance that replaces the previous
 * `enforce` node's special formatter branches. Ported verbatim from
 * `nodes/enforce/index.ts` L85~L129 (pre-removal); behaviour-equivalent.
 *
 * The branching key is `violations[0]?.type` — mirrors the original
 * contract where the enforce node routed on the leading violation.
 */
export function renderViolationGuidance(
  violations: import('../../../state').Violation[],
): string | undefined {
  const errorType = violations[0]?.type;

  if (errorType === 'cross_worker_conflict') {
    const conflictFiles = violations
      .map(v => v.file)
      .filter(Boolean);
    const fileList = conflictFiles.map(f => `  - ${f}`).join('\n');

    return [
      '',
      '🚨 CROSS-WORKER FILE CONFLICT',
      '',
      'Another parallel task already created these files:',
      fileList,
      '',
      '⛔ DO NOT use <file> tag to overwrite these files directly.',
      '',
      '✅ REQUIRED (2 steps):',
      '1. Call read_file("path") to get the CURRENT content and version',
      '2. Then EITHER:',
      '   a. Use <file path="path"> with MERGED content (full rewrite)',
      '   b. Use edit_file tool to partially modify',
    ].join('\n');
  }

  if (errorType === 'file_operation_failed') {
    const searchBlockErrors = violations.filter(v =>
      v.message.includes('Search block not found') ||
      v.message.includes('Duplicate edit'),
    );
    if (searchBlockErrors.length === 0) return undefined;

    const files = searchBlockErrors
      .map(v => v.file)
      .filter(Boolean)
      .join(', ');

    return [
      '',
      `🚨 PREVIOUS ATTEMPT FAILED: ${searchBlockErrors.length} file edit error(s)`,
      '',
      `Files: ${files}`,
      '',
      'REASON: Search block mismatch (outdated content)',
      '',
      '✅ REQUIRED FIX (2 steps):',
      '1. Call read_file("path") to get CURRENT content',
      '2. Use EXACT old_str from read_file result in edit_file tool',
    ].join('\n');
  }

  return undefined;
}

/**
 * Recompute install-needed status at plan entry by observing the codebase
 * directly — `package.json` declared deps vs `codebase/node_modules/<name>`.
 * Single source of truth for all plan entry paths (first-entry, retry, reverify).
 *
 * The observation is pushed onto `state.verification` via `markInstallNeeded`
 * so the Session's `dependencyStatus()` / `installNeeded()` readers stay
 * consistent within a task's tool loop (no redundant fs walks between
 * plan↔execute hops). The authoritative source remains the codebase — the
 * Session field is a fresh-per-entry observation cache.
 *
 * `installed === null` (not a JS project) leaves the Session untouched so the
 * prompt's `dependencyStatus` block stays absent, matching the legacy
 * `'unknown'` behaviour for go/python/etc. projects.
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
    const { areDepsInstalled } = await import(
      '../../../../../../common/tool/handlers/invalidationScope'
    );
    const { detectPackageManager } = await import(
      '../../../../../../../core/utils/packageManager'
    );
    const installed = await areDepsInstalled(featureRoot);

    if (installed === true) session.markInstallNeeded(false);
    else if (installed === false) session.markInstallNeeded(true);
    // installed === null → leave Session's flag untouched (not a JS project).

    console.log(`📦 [Plan] areDepsInstalled=${installed}`);

    if (opts?.detectPmIfMissing && !state._detectedPackageManager) {
      const detectedPM = await detectPackageManager(featureRoot);
      if (detectedPM) {
        state._detectedPackageManager = detectedPM;
        console.log(`📦 [Plan] Detected package manager: ${detectedPM}`);
      }
    }
  } catch (err) {
    session.markInstallNeeded(true);
    console.warn(`⚠️ [Plan] Dependency observation failed, defaulting to installNeeded=true: ${err}`);
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

  // Termination dispatch (R1). Hook-owning task types (verification) decide
  // termination themselves; task types without a hook fall through to the
  // generic `state.retries / state.maxRetries` counter.
  const planHook = hooksForTaskType(nextTask.type)?.plan;
  const hookTerminal = planHook?.checkRetryTermination?.(state);
  if (hookTerminal) {
    console.error(`\n❌ [Plan] ${nextTask.name} terminated (${hookTerminal.kind}): ${hookTerminal.message}\n`);
    throw hookTerminal;
  }

  if (!planHook?.checkRetryTermination) {
    state.retries = (state.retries || 0) + 1;
    if (state.retries >= state.maxRetries) {
      throw new VerificationTerminalError(
        'max_retries_exceeded',
        `Task "${nextTask.name}" failed after ${state.retries} attempts (max: ${state.maxRetries}). Cannot proceed with automatic fixes.`,
        snapshotFromState(state)?.verification,
      );
    }
  }

  const prevCallIndex = state._executeCallIndex || 0;
  const isVerificationRetry = isVerificationTask(nextTask);
  let retrySummaryText: string | undefined;

  if (isVerificationRetry) {
    // Snapshot the inbound violation count before clearing so the retry log
    // reflects the previous attempt's failure count rather than the cleared 0.
    const prevViolationCount = state.violations?.length ?? 0;

    // Session owns the retry attempt counter; `state.retries` stays 0 for
    // verification because `checkRetryTermination` owns termination.
    state.verification?.onPlanEntry('retry');
    state._executeCallIndex = 0;
    const sessionAttempts = state.verification?.attempts() ?? 0;
    retrySummaryText = renderRetrySummary(summarizeForRetry({
      violations: state.violations,
      lastPlan: state.planText,
    }, {
      attemptCount: sessionAttempts,
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
    console.log(`\n🔄 [Plan] Verification retry: ${nextTask.name} (verificationAttempts=${sessionAttempts})`);
    console.log(`   ♻️  Reset: conversations cleared, _executeCallIndex ${prevCallIndex}→0`);
    console.log(`   ♻️  Preserved: _finalTaskLoopCount = ${state._finalTaskLoopCount || 0}\n`);
    if (nextTask && state.context?.featurePath && state._httpJobId) {
      const _taskRef = nextTask;
      const _retention = describeRetryRetention(retrySummaryText, state.verification?.passed());
      const _planHashes = state.verification?.snapshot().planHistoryHashes;
      const _prevPlanHash = _planHashes?.[_planHashes.length - 1];
      const _carryOverBytes = JSON.stringify(snapshotFromState(state) || {}).length;
      import('../../../../../../../core/utils/executionLogger').then(({ getExecutionLogger }) => {
        getExecutionLogger({
          featurePath: state.context!.featurePath!,
          jobId: state._httpJobId!,
          jobType: 'code',
        }).logVerificationRetry(_taskRef.id, {
          taskName: _taskRef.name,
          attempt: sessionAttempts,
          // @deprecated placeholders — summary-based retention is the SSOT for carried retry context.
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

  // Session bumps the attempt counter and clears per-cycle attempted gates.
  // Plan-history push lives at `nodes/plan/index.ts` (single-writer).
  state.verification?.onPlanEntry('reverify');

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
    console.log(`🔍 [Plan] VerificationSession ${isResumedVerification ? 'rehydrated' : 'initialised'}: required=${state.verification?.required().join('+') ?? ''}, passed=${state.verification?.passed().join('+') ?? ''}`);
    console.log(`🎫 [Plan] verificationAttempts=${sessionAttempts}`);

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
