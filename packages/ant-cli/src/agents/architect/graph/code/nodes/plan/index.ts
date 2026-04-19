/**
 * Plan Node (Refactored)
 * 
 * Responsibilities:
 * 1. Pop next task from queue
 * 2. Generate task-specific keywords (LLM)
 * 3. Search Vector DB with keywords (task-specific RAG)
 * 4. Load reference projects (if needed)
 * 5. Generate implementation plan (planText)
 * 6. Update state with codeContext, referenceContexts, planText
 * 
 * ✅ MODULAR ARCHITECTURE:
 * - keywordGeneration.ts: Keyword generation & UI display
 * - stackTraceLoader.ts: Stack trace file loading
 * - semanticSearch.ts: Semantic keyword search
 * - referenceLoader.ts: Reference project loading
 * - planGeneration.ts: Plan text generation
 * - utils.ts: Utility functions
 */

import { LLMClient } from "../../../../../../core/ports";
import type { MessageContentBlock } from "../../../../../../core/ports/llm";
import { CONV_KEYS, getConv } from '../../../../../common/graph/conversations';
import { extractLLMInfo } from "../../../../../../core/ports/workflow";
import { getTechTier } from '@ant/shared';
import { ArchitectGraphState, TASK_PRIORITIES } from "../../state";
import { CodeTask } from "../../../../types/task";
import { extractErrorDetails, createErrorViolation } from "../shared/errorHandler";
// ArtifactService import removed — UI doc injection handled by ArtifactPipeline

// Import submodules
import { generateTaskKeywords, displayKeywords, logKeywords } from "./keywordGeneration";
import { combineCodeContext, TaskKeywords } from "./combineCodeContext";
import { loadReferenceContexts } from "./referenceLoader";
import { generatePlanText, runPlanLLMWithTools, buildPlanPrompt, buildPlanPromptBlocks, PLAN_TOOL_LOOP_MAX, taskRequiresPlan, finalizePlanFromExploration } from "./planGeneration";
import { extractFilesFromViolations, formatViolations } from "../shared/violationFormatter";
import { extractFilesFromPlanToolLoop, computeBudgetFromPlanText } from "./utils";
import { detectTestFilesFromDisk } from "./testFileDetector";
import { isVerificationComplete } from "../../utils/verificationCompleteness";
import { summarizeForRetry, renderRetrySummary } from "../../../../../../core/context/taskRetryRetention";
import { appendTrace } from "../../../../../../utils/verificationTrace";
import * as crypto from 'node:crypto';

/**
 * Axis F-4 — normalize plan JSON for stable hashing. Sorts object keys,
 * trims whitespace, and drops trivially-variable metadata so that repeating
 * the same structural plan produces the same hash across attempts.
 */
function normalizePlanForHash(planText: string): string {
  const body = planText.trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```$/, '');
  try {
    const parsed = JSON.parse(body);
    const stable = JSON.stringify(parsed, (_k, v) => {
      if (Array.isArray(v)) return v;
      if (v && typeof v === 'object') {
        return Object.keys(v).sort().reduce((acc: Record<string, unknown>, k) => {
          acc[k] = (v as Record<string, unknown>)[k];
          return acc;
        }, {});
      }
      return v;
    });
    return crypto.createHash('sha1').update(stable).digest('hex');
  } catch {
    const collapsed = body.replace(/\s+/g, ' ').trim();
    return crypto.createHash('sha1').update(collapsed).digest('hex');
  }
}

function isTypeScriptProject(state: ArchitectGraphState): boolean {
  const taskTiers = state.currentTask?.techTiers;
  const firstTierLang = taskTiers && taskTiers.length > 0
    ? taskTiers[0].language
    : getTechTier(state)?.language;
  return (firstTierLang ?? '').toLowerCase().includes('typescript');
}

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
 * Enrich projectCodeContext with files discovered during Plan's tool loop.
 * Extracts read_file results from nodePlanHistory and merges them
 * into projectCodeContext.files, deduplicating against existing RAG files.
 */
function enrichContextFromPlanToolLoop(
  projectCodeContext: any,
  nodePlanHistory: Array<{ role: string; content: string | MessageContentBlock[] }> | undefined,
): any {
  if (!projectCodeContext || !nodePlanHistory?.length) return projectCodeContext;

  const existingPaths = new Set<string>((projectCodeContext.files || []).map((f: any) => f.path));
  const newFiles = extractFilesFromPlanToolLoop(nodePlanHistory, existingPaths);

  if (newFiles.length === 0) return projectCodeContext;

  console.log(`📎 [Plan] Enriching CodeGen context with ${newFiles.length} file(s) from plan tool loop`);

  return {
    ...projectCodeContext,
    files: [...(projectCodeContext.files || []), ...newFiles],
    filePaths: [...(projectCodeContext.filePaths || []), ...newFiles.map(f => f.path)],
    stats: {
      ...projectCodeContext.stats,
      filesLoaded: (projectCodeContext.stats?.filesLoaded || 0) + newFiles.length,
    },
  };
}

/**
 * When a diagnostic task (verification/error) finishes its plan tool-loop with
 * build/test already passing and no plan to execute, execute would only ask the
 * LLM to output `<done>true</done>` — a wasted call.  Detect this and let the
 * plan node set `done: true` directly so planRouter skips execute entirely.
 */
function isVerificationPassWithoutCodeGen(
  state: ArchitectGraphState, planText: string, batchSplitOccurred: boolean,
): boolean {
  if (batchSplitOccurred) return false;
  if (planText !== '') return false;
  const task = state.currentTask;
  if (task?.type !== 'verification' && task?.type !== 'error') return false;
  // Axis B — unified completion check via SSOT
  return isVerificationComplete(state._verificationTracker).ok;
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

const MAX_BATCH_SPLIT_CYCLES = 10;

/**
 * Axis D — compose the verification prompt's `violationsText` from its three
 * possible sources (current violations, accumulated diagnostic retry context,
 * prior-attempt summary). Returning undefined when everything is empty keeps
 * the prompt template's `{{#if isRetry}}` branch clean.
 */
function composeViolationsText(
  violations: import('../../state').Violation[] | undefined,
  diagnosticRetryContext: string | undefined,
  retrySummaryText: string | undefined,
): string | undefined {
  const parts: string[] = [];

  // F3b — when retrySummary carries normalized error signals, `verification_incomplete`
  // violations duplicate that content and create a contradictory signal for the LLM
  // (same failure described twice in different formats). Suppress them here; other
  // violation types remain visible.
  const effectiveViolations = retrySummaryText
    ? violations?.filter(v => v.type !== 'verification_incomplete')
    : violations;

  if (effectiveViolations?.length) parts.push(formatViolations(effectiveViolations));
  if (diagnosticRetryContext) parts.push(diagnosticRetryContext);
  if (retrySummaryText) parts.push(retrySummaryText);
  return parts.length ? parts.join('\n') : undefined;
}

/**
 * Axis E — decrement the verification budget and bump the diagnostic-attempt
 * counter. Called on every retry/reverify re-entry into a verification task.
 */
function consumeVerificationBudget(state: ArchitectGraphState): void {
  if (typeof state._verificationBudget === 'number') {
    state._verificationBudget = Math.max(0, state._verificationBudget - 1);
  }
  state._diagnosticAttempts = (state._diagnosticAttempts || 0) + 1;
}

/**
 * Axis G-7 — one-shot budget top-up when deep-diagnostic mode is engaged.
 * Must be called AFTER consumeVerificationBudget so _diagnosticAttempts
 * reflects the current re-entry.
 */
function maybeGrantDeepDiagnosticBudget(state: ArchitectGraphState): void {
  if ((state._diagnosticAttempts || 0) < 2) return;
  if (state._deepDiagnosticBudgetGranted) return;
  state._verificationBudget = (state._verificationBudget || 0) + 3;
  state._deepDiagnosticBudgetGranted = true;
  console.log(`🧭 [Plan] Deep-diagnostic mode engaged — _verificationBudget += 3 (now ${state._verificationBudget})`);
}

/**
 * Axis A — recompute install-needed status from the dep-file hash on disk.
 * Single source of truth for all plan entry paths (first-entry, retry, reverify).
 *
 * Heuristic (fixes parallel-worker first-time install redundancy):
 *   (disk hash computes) ∧ (node_modules/vendor exists) ∧ (no savedHash yet)
 *     → adopt disk hash as baseline, installNeeded=false.
 *   This handles the common case where a previous task/worker already installed
 *   but the saved hash didn't propagate (e.g. parallel workers or cross-job resume).
 *
 * On failure, conservatively defaults to `installNeeded=true`.
 */
async function recomputeInstallNeeded(
  state: ArchitectGraphState,
  opts?: { detectPmIfMissing?: boolean },
): Promise<void> {
  const featureRoot = state.deps?.fileSystem?.getRootPath?.();
  if (!featureRoot) return;
  try {
    const { computeDepFileHash, hasInstalledDeps, detectPackageManager } = await import(
      '../../../../../common/tool/handlers/runCommand'
    );
    const currentHash = await computeDepFileHash(featureRoot);
    const savedHash = state._depFileHash;
    const depsExist = await hasInstalledDeps(featureRoot);

    const { deriveInstallDecision } = await import(
      '../../../../../common/tool/handlers/invalidationScope'
    );
    const decision = deriveInstallDecision(savedHash, currentHash, depsExist);
    state._installNeeded = decision.installNeeded;
    if (decision.adoptedHash) {
      state._depFileHash = decision.adoptedHash;
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
    console.warn(`⚠️ [Plan] Dependency hash check failed, defaulting to installNeeded=true: ${err}`);
  }
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
function processDiagnosticBatchSplit(
  state: ArchitectGraphState,
  planText: string,
  nextTask: CodeTask,
): string {
  const isVerificationOrErrorTask = nextTask.type === 'verification' || nextTask.type === 'error';

  const logBatchSplit = (data: Record<string, any>) => {
    if (state.context?.featurePath && state._httpJobId) {
      import('../../../../../../core/utils/executionLogger').then(({ getExecutionLogger }) => {
        getExecutionLogger({
          featurePath: state.context!.featurePath!,
          jobId: state._httpJobId!,
          jobType: 'code',
        }).log('batch_split', data, nextTask.id);
      }).catch(() => {});
    }
  };

  if (!isVerificationOrErrorTask) {
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

    // Axis E — force split-by-file when LLM produced a consolidated plan
    // but the error volume or file fan-out crosses the escalation threshold,
    // OR when the verification budget is exhausted. This is the safety valve
    // for "LLM keeps outputting a single plan that we keep failing to apply".
    const budget = state._verificationBudget;
    const thresholdErrors = parseInt(process.env.ANT_VERIFICATION_SPLIT_ERRORS || '6', 10);
    const thresholdFiles = parseInt(process.env.ANT_VERIFICATION_SPLIT_FILES || '4', 10);
    const totalErrors: number = parsed.diagnostics?.totalErrors ?? 0;
    const modifyArr: any[] = parsed.implementation?.modify ?? [];
    const budgetExhausted = typeof budget === 'number' && budget <= 0;
    const overErrorBudget = totalErrors >= thresholdErrors;
    const overFileBudget = modifyArr.length >= thresholdFiles;
    const shouldForceSplit = (!parsed.batches || !Array.isArray(parsed.batches) || parsed.batches.length <= 1)
      && (budgetExhausted || overErrorBudget || overFileBudget);

    // Axis F-4 — repeat detection. If the same plan structure surfaced again
    // without progress, escalate to force-split to break the loop.
    let repeatedHash = false;
    if (planText) {
      const thisHash = normalizePlanForHash(planText);
      if (state._lastPlanHash && state._lastPlanHash === thisHash) {
        repeatedHash = true;
        console.warn(`🔁 [BatchSplit] Same plan hash as previous attempt (${thisHash.substring(0, 8)}) — escalating`);
      }
      state._lastPlanHash = thisHash;
    }
    const forceByRepeat = repeatedHash
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
    const splitCount = (nextTask._batchSplitCount || 0) + 1;

    if (splitCount > MAX_BATCH_SPLIT_CYCLES) {
      logBatchSplit({ action: 'cycle_limit_failed', splitCount, taskName: nextTask.name });
      console.error(`❌ [BatchSplit] Cycle limit (${MAX_BATCH_SPLIT_CYCLES}) exceeded for "${nextTask.name}". Failing task.`);
      (nextTask as any)._failed = true;
      (nextTask as any)._failureReason = `batch_split_cycle_limit_exceeded (${splitCount} cycles)`;
      state._batchSplitRequeued = true; // release worker slot
      appendTrace({
        node: 'plan',
        taskId: nextTask.id,
        taskType: nextTask.type,
        extra: { flagSet: ['_batchSplitRequeued'], reason: 'cycle_limit_failed', splitCount },
      });
      return ''; // batchSplitOccurred=true → llmResponse.done=true → skip execute
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

    // Re-enqueue the original task (clean state) instead of creating a new one.
    // Priority FINAL_VERIFICATION(1000) > error priority(999) ensures it runs last.
    // Batch split tracking fields are preserved so the re-enqueued task can detect
    // repeated errors and break the loop on subsequent cycles.
    const requeuedTask: CodeTask = {
      ...nextTask,
      timing: undefined,
      interrupted: undefined,
      _failedAttempts: undefined,
      _failed: undefined,
      _failureReason: undefined,
      // Preserve batch split cycle counter for hard limit
      _batchSplitCount: splitCount,
      _previousBatchDiagnostics: JSON.stringify({
        cycle: splitCount,
        totalErrors: parsed.diagnostics?.totalErrors ?? 0,
        rootCauses: parsed.diagnostics?.rootCauses ?? [],
        batchNames: parsed.batches.map((b: any) => b.name),
      }),
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
    logBatchSplit({ action: 'skipped', reason: 'json_parse_error', error: (err as Error).message, planTextPreview: planText.substring(0, 120), taskName: nextTask.name });
    return planText;
  }
}

/**
 * STEP 0 entry dispatcher — routes plan() entry into exactly one of the
 * four handlers below and returns a `PlanEntryContext` that downstream
 * STEP 0.5 / STEP 3 consume.
 *
 * The four entry reasons are orthogonal:
 *   - inToolLoop: re-entry from the plan↔tool loop (no resets)
 *   - retry:     enforce→plan retry (violations triage)
 *   - reverify:  post-codefix final verification
 *   - fresh:     a new task popped from the queue (or pre-assigned to a worker)
 *
 * Strict invariants (see docs/architecture/14-code-job.md Axis A–G):
 *   - `preservedRetries` MUST carry through when entering via retry, tool-loop,
 *     or scenario-preserve env; otherwise reset to 0.
 *   - retry/reverify both consume the verification budget and clear
 *     `state.violations` after rendering `retrySummaryText` (which becomes the
 *     sole violations carrier in STEP 3).
 *   - `recomputeInstallNeeded` is called from every branch that mutates the
 *     task-level context — do NOT merge the calls across handlers, the
 *     conditions differ (`detectPmIfMissing` is only set by reverify/fresh).
 *
 * Phase 2-9: the dispatcher only splits branching; no behavior change intended.
 */
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

export async function resolvePlanEntry(state: ArchitectGraphState): Promise<PlanEntryContext> {
  const inToolLoop = state._activePhase === 'plan' && !!state.currentTask;
  const entryReason = inToolLoop ? undefined : state._planEntryReason;
  if (!inToolLoop) state._planEntryReason = undefined;
  const isRetry = entryReason === 'retry';
  // Scenario harness escape hatch: when ANT_SCENARIO_PRESERVE_RETRIES=1,
  // never reset retries from a non-retry plan entry either. Without this,
  // seeded `retries` would survive runCodeGraph's resume hydration only to
  // be wiped here on the first pop. Production path (env unset) is unaffected.
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

  // 🚨 CRITICAL: Check if maxRetries exceeded
  if (state.retries >= state.maxRetries) {
    console.error(`\n❌ [Plan] Max retries (${state.maxRetries}) exceeded for task: ${nextTask.name}`);
    console.error(`   Current retries: ${state.retries}`);
    console.error(`   This task has failed repeatedly and cannot be fixed automatically.\n`);

    throw new Error(
      `Task "${nextTask.name}" failed after ${state.retries} attempts (max: ${state.maxRetries}). ` +
      `Cannot proceed with automatic fixes.`
    );
  }

  const prevCallIndex = state._executeCallIndex || 0;
  const isVerificationRetry = nextTask.type === 'verification';
  let retrySummaryText: string | undefined;

  if (isVerificationRetry) {
    consumeVerificationBudget(state);
    maybeGrantDeepDiagnosticBudget(state);
    state._executeCallIndex = 0;
    // NOTE: _finalTaskLoopCount is intentionally NOT reset here (matching
    // the reverify path below). Accumulating across retry cycles lets
    // Safety Net C in executeRouter detect stuck loops faster. Previously
    // resetting to 0 allowed infinite retry×2-execute cycles.
    // Axis D — capture a rendered prior-attempt summary (plan JSON +
    // error signals + command history) and let it flow through the
    // prompt via violationsText in STEP 3.
    retrySummaryText = renderRetrySummary(summarizeForRetry({
      violations: state.violations,
      lastPlan: state.planText,
    }, {
      attemptCount: (state.retries || 0) + 1,
      commandHistory: state.commandHistory,
    }));
    // F3a — violations were just captured into retrySummaryText's normalizedErrors.
    // Clearing them prevents composeViolationsText from double-injecting the same
    // signal via formatViolations + retrySummary in STEP 3.
    state.violations = [];
    state.conversations = {
      ...state.conversations,
      [CONV_KEYS.NODE_EXECUTE]: [],
      [CONV_KEYS.NODE_PLAN]: [],
    };
    state._executeModifiedFiles = false;
    // Axis A — recompute installNeeded from the actual dep-file hash
    // instead of hardcoding true. Keeps cached installs reusable when
    // package.json/go.mod/etc. have not changed since the last success.
    await recomputeInstallNeeded(state);
    if (state._verificationTracker) {
      state._verificationTracker.buildAttempted = false;
      state._verificationTracker.testAttempted = false;
      state._verificationTracker.typecheckAttempted = false;
    }
    const _retryAttempt = (state.retries || 0) + 1;
    const _retryMax = state.maxRetries || 3;
    console.log(`\n🔄 [Plan] Verification retry: ${nextTask.name} (attempt ${_retryAttempt}/${_retryMax})`);
    console.log(`   ♻️  Reset: conversations cleared, _executeCallIndex ${prevCallIndex}→0`);
    console.log(`   ♻️  Preserved: _finalTaskLoopCount = ${state._finalTaskLoopCount || 0}\n`);
    if (nextTask && state.context?.featurePath && state._httpJobId) {
      const _taskRef = nextTask;
      const _summaryText = retrySummaryText;
      const _passedGates: Array<'typecheck' | 'build' | 'test'> = [];
      const _tracker = state._verificationTracker;
      if (_tracker?.typecheckPassed) _passedGates.push('typecheck');
      if (_tracker?.buildPassed) _passedGates.push('build');
      if (_tracker?.testPassed) _passedGates.push('test');
      import('../../../../../../core/utils/executionLogger').then(({ getExecutionLogger }) => {
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
          // F3c — reflect Axis D summary retention policy + tracker cache state at retry entry.
          retentionMode: 'summary',
          summaryInjected: !!_summaryText,
          summaryLen: _summaryText?.length ?? 0,
          passedGatesAtRetry: _passedGates,
        }).catch(() => {});
      }).catch(() => {});
    }
  } else {
    state._executeCallIndex = 0;
    state._finalTaskLoopCount = 0;
    // Axis D — non-verification retries also receive a prior-attempt
    // summary (appended to violationsText later) so LLM solution quality
    // doesn't collapse when previous reasoning is wiped mid-task.
    retrySummaryText = renderRetrySummary(summarizeForRetry({
      violations: state.violations,
      lastPlan: state.planText,
    }, {
      attemptCount: (state.retries || 0) + 1,
      commandHistory: state.commandHistory,
    }));
    // F3a — same invariant as the verification retry path: violations have
    // been distilled into retrySummaryText, so the originals are spent.
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
  // POST-CODEFIX: execute applied fixes, now re-run full diagnostic for final verification
  const nextTask = state.currentTask!;
  console.log(`\n🔄 [Plan] Post-execute final verification: ${nextTask.name}`);
  console.log(`   Re-initializing VerificationTracker for fresh build/test check\n`);

  consumeVerificationBudget(state);
  maybeGrantDeepDiagnosticBudget(state);

  // Accumulate applied plans so plan LLM can see ALL previous attempts
  if (state.planText) {
    const history = (state._appliedPlanHistory || []) as string[];
    history.push(state.planText);
    state._appliedPlanHistory = history;
  }

  // Axis C — reset only attempted flags, preserve already-passed steps
  // that weren't invalidated by the edited files. The tool hook
  // (`verificationInvalidated`) already flipped the `*Passed` flags for
  // the affected scope during execute; reverify should surface exactly
  // those gaps, not wipe clean state.
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

  // Reset execute state for potential next fix cycle.
  // NOTE: _finalTaskLoopCount is intentionally NOT reset here so that
  // the Safety Net C guard in executeRouter accumulates across reverify
  // cycles and can break infinite loops.
  state._executeCallIndex = 0;
  state.conversations = { ...state.conversations, [CONV_KEYS.NODE_EXECUTE]: [], [CONV_KEYS.NODE_PLAN]: [] };
  state._executeModifiedFiles = false;
  // F3a — invariant parity with retry paths: prior-cycle violations must
  // not leak into the next diagnostic prompt's violationsText. The fresh
  // diagnostic cycle produces its own violations from rerunning gates.
  state.violations = [];

  // Recompute installNeeded — execute may have modified dependency declaration files
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
  // ✅ Worker context: TaskWorker pre-assigns currentTask via orchestrator
  // Sequential context: pop next task from queue
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

  // Start timing
  const { TaskTimingHelper } = await import('../../state');
  console.log(`⏱️  Starting timer for task: ${nextTask.name}`);
  nextTask = TaskTimingHelper.startTask(nextTask);

  // ✅ Initialize token usage tracking for new task
  const { resetTaskTokenUsage } = await import('../../../../../common/graph/llmHelpers');
  resetTaskTokenUsage(state);
  state._executeCallIndex = 0;
  // Phase 3-15 — reset plan-phase search_web budget per fresh task.
  state._planSearchWebCount = 0;

  // ✅ Initialize verification tracker for verification tasks only.
  // Error tasks are code-fix only — build verification is deferred to the re-enqueued verification task.
  if (nextTask.type === 'verification') {
    // Axis D/resume — TaskWorker restores axis state from resumeState for
    // interrupted tasks. A resumed task that did NOT qualify for canSkipPlan
    // (e.g. stopped mid-tool-loop with short planText) must NOT lose its
    // budget / diagnostic-attempts / lastPlanHash. `nextTask.interrupted`
    // is already cleared by TaskWorker right after restore, so we detect
    // resume by the presence of previously-initialized axis fields.
    const isResumedVerification = state._verificationBudget !== undefined;
    const tsProject = isTypeScriptProject(state);

    if (!state._verificationTracker) {
      state._verificationTracker = {
        buildPassed: false,
        testPassed: false,
        testsRequired: detectTestFilesFromDisk(state.context?.featurePath),
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
    // Axis E — initialise verification budget on first entry into this task.
    // Only seed when undefined so a resumed task keeps its remaining budget.
    if (state._verificationBudget === undefined) {
      const envBudget = parseInt(process.env.ANT_VERIFICATION_BUDGET || '8', 10);
      state._verificationBudget = Number.isFinite(envBudget) && envBudget > 0 ? envBudget : 8;
    }
    if (state._diagnosticAttempts === undefined) state._diagnosticAttempts = 0;
    if (state._deepDiagnosticBudgetGranted === undefined) state._deepDiagnosticBudgetGranted = false;
    // _lastPlanHash: undefined on a truly fresh task; preserved on resume.
    console.log(`🔍 [Plan] VerificationTracker ${isResumedVerification ? 'restored (resume)' : 'initialized'}: testsRequired=${state._verificationTracker.testsRequired}, typecheckRequired=${tsProject}`);
    console.log(`🎫 [Plan] _verificationBudget=${state._verificationBudget}, _diagnosticAttempts=${state._diagnosticAttempts}`);

    // Axis A — single-source-of-truth dep hash check (same helper as retry/reverify paths)
    await recomputeInstallNeeded(state, { detectPmIfMissing: true });
  }

  // ✅ Log task_start event to debug/logs/
  if (state.context?.featurePath && state._httpJobId) {
    const { getExecutionLogger } = await import('../../../../../../core/utils/executionLogger');
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

  // Update Kanban UI
  // Skip in worker context — TaskOrchestrator handles kanban for parallel mode
  // (per-worker kanban would overwrite multi-task inProgress with just this worker's task)
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
      state.recursionLimit
    );
  } else if (!isWorkerCtx) {
    if (!state._httpJobId) console.warn(`⚠️ [Plan] Kanban skipped: _httpJobId is missing`);
    if (!state.deps?.kanbanUpdate) console.warn(`⚠️ [Plan] Kanban skipped: deps.kanbanUpdate is null (broadcaster not injected)`);
  } else {
    console.log(`📋 [Plan] Kanban skipped: isWorkerCtx=true (orchestrator handles)`);
  }

  // ✅ CRITICAL: Save checkpoint after task started so session has correct currentTask
  // Without this, manual cancel during execute can't find the in-progress task
  // (session still has stale currentTask from previous learn node save)
  // Skip in worker context — orchestrator manages parallel checkpoints separately
  if (!isWorkerCtx && state.deps?.session && state.context.featureFolder) {
    try {
      const { saveCheckpoint } = await import('../checkpoint');
      await saveCheckpoint({
        ...state,
        currentTask: nextTask
      });
    } catch (err) {
      // Non-critical: checkpoint save failure shouldn't block plan execution
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

/**
 * STEP 0.9 helper — runs the plan↔tool loop and either produces a
 * finalized plan state (to short-circuit plan()) or asks the caller to
 * fall through into normal plan generation.
 *
 * Phase 4-19 — extracted from plan() inline STEP 0.9 block. No behavior
 * change: the inner call graph (runPlanLLMWithTools / finalizePlanFromExploration
 * / processDiagnosticBatchSplit / enrichContextFromPlanToolLoop) is identical;
 * the only difference is the module boundary.
 */
export type PlanToolLoopOutcome =
  | { kind: 'return'; state: ArchitectGraphState }
  | { kind: 'fallthrough'; forceNoTools?: boolean };

export async function runPlanToolLoopPhase(
  state: ArchitectGraphState,
  nextTask: CodeTask,
  preservedRetries: number,
): Promise<PlanToolLoopOutcome> {
  const nodePlan = getConv(state.conversations, CONV_KEYS.NODE_PLAN);
  if (!(state._activePhase === 'plan' && nodePlan.length > 0)) {
    return { kind: 'fallthrough' };
  }

  const overLimit = nodePlan.length >= PLAN_TOOL_LOOP_MAX * 2; // ~2 messages per round

  if (overLimit) {
    console.log(`\n⚠️ [Plan] Plan↔tool loop limit (${PLAN_TOOL_LOOP_MAX}) reached; finalizing plan from exploration context`);
    let finalizedPlan = await finalizePlanFromExploration(state, nodePlan as any, nextTask);
    if (finalizedPlan) {
      const preSplitPlan = finalizedPlan;
      finalizedPlan = processDiagnosticBatchSplit(state, finalizedPlan, nextTask);
      const batchSplitOccurred = preSplitPlan.length > 50 && finalizedPlan === '';
      const diagnosticPass = isVerificationPassWithoutCodeGen(state, finalizedPlan, batchSplitOccurred);
      const enrichedContext = enrichContextFromPlanToolLoop(state.projectCodeContext, nodePlan);
      state._activePhase = 'execute';
      if (state.deps?.workflowUpdate && state._httpJobId) {
        await state.deps.workflowUpdate.exitNode(state._httpJobId, 'plan', state.workerId ?? 0);
      }
      const returned: ArchitectGraphState = {
        ...state,
        currentTask: nextTask,
        projectCodeContext: enrichedContext,
        referenceCodeContexts: state.referenceCodeContexts,
        lessons: state.lessons ?? [],
        planText: finalizedPlan,
        _executeBudget: computeBudgetFromPlanText(finalizedPlan),
        _activePhase: 'execute' as const,
        conversations: { [CONV_KEYS.NODE_PLAN]: [] },
        retries: preservedRetries,
        completedTasksDetails: state.completedTasksDetails || [],
        recursionCount: state.recursionCount,
        recursionLimit: state.recursionLimit,
        workspaceConfig: state.workspaceConfig,
        llmResponse: (batchSplitOccurred || diagnosticPass)
          ? { done: true, textResponse: '', thinking: '', toolCalls: [] }
          : { done: false, textResponse: '', thinking: '', toolCalls: [] },
      };
      return { kind: 'return', state: returned };
    }
    console.log(`⚠️ [Plan] finalizePlanFromExploration failed; falling back to generatePlanText`);
    if (nodePlan.length > 0) {
      state.projectCodeContext = enrichContextFromPlanToolLoop(state.projectCodeContext, nodePlan);
    }
    state._activePhase = 'execute';
    return { kind: 'fallthrough', forceNoTools: true };
  }

  const result = await runPlanLLMWithTools(state, nodePlan as any, nextTask);
  if (result && '_activePhase' in result) {
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'plan', state.workerId ?? 0);
    }
    const returned: ArchitectGraphState = {
      ...state,
      conversations: { [CONV_KEYS.NODE_PLAN]: result.nodePlanHistory },
      _activePhase: 'plan' as const,
      llmResponse: result.llmResponse,
      projectCodeContext: state.projectCodeContext,
      referenceCodeContexts: state.referenceCodeContexts,
      lessons: state.lessons,
    };
    return { kind: 'return', state: returned };
  }
  if (result && 'planText' in result) {
    const preSplitPlan = result.planText;
    const planText = processDiagnosticBatchSplit(state, preSplitPlan, nextTask);
    const batchSplitOccurred = preSplitPlan.length > 50 && planText === '';
    const diagnosticPass = isVerificationPassWithoutCodeGen(state, planText, batchSplitOccurred);
    const enrichedContext = enrichContextFromPlanToolLoop(state.projectCodeContext, nodePlan);
    const updatedState: ArchitectGraphState = {
      ...state,
      currentTask: nextTask,
      projectCodeContext: enrichedContext,
      referenceCodeContexts: state.referenceCodeContexts,
      lessons: state.lessons ?? [],
      planText,
      _executeBudget: computeBudgetFromPlanText(planText),
      _activePhase: 'execute' as const,
      conversations: { [CONV_KEYS.NODE_PLAN]: [] },
      retries: preservedRetries,
      completedTasksDetails: state.completedTasksDetails || [],
      recursionCount: state.recursionCount,
      recursionLimit: state.recursionLimit,
      workspaceConfig: state.workspaceConfig,
      llmResponse: (batchSplitOccurred || diagnosticPass)
        ? { done: true, textResponse: '', thinking: '', toolCalls: [] }
        : { done: false, textResponse: '', thinking: '', toolCalls: [] },
    };
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'plan', state.workerId ?? 0);
    }
    return { kind: 'return', state: updatedState };
  }

  // null: fall through to normal flow — but first enrich context with any files read during tool loop
  if (nodePlan.length > 0) {
    state.projectCodeContext = enrichContextFromPlanToolLoop(state.projectCodeContext, nodePlan);
  }
  state._activePhase = 'execute';
  return { kind: 'fallthrough' };
}

/**
 * Test-only exports for verification scenario harness L1 unit tests.
 * Not part of the public API; see docs/testing/verification-scenarios.md.
 */
export const __testing__ = {
  processDiagnosticBatchSplit,
  normalizePlanForHash,
  MAX_BATCH_SPLIT_CYCLES,
  resolvePlanEntry,
  runPlanToolLoopPhase,
};

export async function plan(state: ArchitectGraphState): Promise<ArchitectGraphState> {

  state.recursionCount = (state.recursionCount || 0) + 1;

  // Verification scenario harness — no-op in production.
  const { traceNodeEntry } = await import('../../../../../../utils/verificationTrace');
  traceNodeEntry('plan', state.currentTask ?? undefined);

  const llm = state.deps?.llm as LLMClient;

  /** Set when plan↔tool loop limit hit so STEP 3 skips tools and uses generatePlanText only. */
  let forceNoTools = false;

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 0: Determine entry reason and set up task
  //
  // Two orthogonal axes:
  //   _activePhase ('plan'|'execute') — "where are we?" — routing & tool node branching
  //   _planEntryReason ('retry'|'reverify'|undefined) — "why are we here?" — consumed immediately
  //
  // Actual dispatching lives in `resolvePlanEntry` above; each branch
  // mutates `state` and returns the fields the downstream steps need.
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const entryCtx = await resolvePlanEntry(state);
  /** Re-verification fast-path: skip keyword/RAG when we only need to re-run build/test. */
  const skipKeywordAndRAG = entryCtx.skipKeywordAndRAG;
  /**
   * Axis D — rendered prior-attempt summary produced when entering via retry.
   * Appended to `violationsText` in STEP 3 so it flows through the verification
   * prompt template instead of hijacking the NODE_PLAN conversation.
   */
  const retrySummaryText: string | undefined = entryCtx.retrySummaryText;
  const isRetry = entryCtx.isRetry;
  const preservedRetries = entryCtx.preservedRetries;
  let nextTask: CodeTask = entryCtx.nextTask;
  // Workflow instrumentation
  if (state.deps?.workflowUpdate && state._httpJobId) {
    const taskInfo = {
      id: nextTask.id,
      name: nextTask.name,
      type: nextTask.type,
      description: nextTask.description,
      priority: nextTask.priority
    };
    
    await state.deps.workflowUpdate.enterNode(
      state._httpJobId,
      'plan',
      state.workerId ?? 0,
      taskInfo,
      state.deps?.llm ? extractLLMInfo(state.deps.llm as LLMClient) : undefined,
      state.recursionCount,
      state.recursionLimit
    );
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 0.5: Check if planText generation can be skipped (task-level resume)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Skip conditions:
  //   1. Not an enforce retry (retry always needs fresh plan with violation context)
  //   2. Task was previously interrupted (not a fresh task from queue)
  //   3. Valid planText already exists from the previous session
  // When skipped: preserves planText + conversations → execute continues from interruption point
  const canSkipPlan = (
    !isRetry &&
    nextTask.interrupted === true &&
    state.planText && state.planText.length > 50
  );
  
  if (canSkipPlan) {
    console.log(`\n⚡ [Plan] Resuming interrupted task "${nextTask.name}" with existing planText (${state.planText!.length} chars)`);
    console.log(`   Skipping: keywords, RAG, planText generation`);
    console.log(`   Conversations: ${getConv(state.conversations, CONV_KEYS.NODE_EXECUTE).length} execute messages preserved`);
    
    // Exit node for workflow tracking
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'plan', state.workerId ?? 0);
    }
    
    return {
      ...state,
      currentTask: nextTask,
      planText: state.planText,    // Preserve existing plan
      retries: 0,
      completedTasksDetails: state.completedTasksDetails || [],
      recursionCount: state.recursionCount,
      recursionLimit: state.recursionLimit,
      workspaceConfig: state.workspaceConfig,
      // conversations preserved in state (not cleared)
    };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 0.6: Pre-planned error task — skip plan generation entirely
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // When a diagnostic task splits into batches, each batch becomes an error task
  // with prePlanText already set. Skip all plan generation and go straight to execute.
  // Error tasks always use prePlanText — even on retry.
// budget_exhausted retry should re-attempt the same fix, not re-run tsc diagnostics.
// Re-running diagnostics on retry causes cascade: sibling domain errors → duplicate subtasks.
const hasPrePlanText =
  (nextTask as CodeTask).prePlanText != null &&
  (nextTask as CodeTask).prePlanText!.length > 50 &&
  (!isRetry || nextTask.type === 'error');
  
  if (hasPrePlanText) {
    console.log(`\n⚡ [Plan] Pre-planned error task "${nextTask.name}" — using prePlanText (${(nextTask as CodeTask).prePlanText!.length} chars)`);
    console.log(`   Skipping: keywords, RAG, diagnostic tool loop, planText generation`);

    // Exit node for workflow tracking
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'plan', state.workerId ?? 0);
    }

    return {
      ...state,
      currentTask: nextTask,
      planText: (nextTask as CodeTask).prePlanText!,
      _executeBudget: computeBudgetFromPlanText((nextTask as CodeTask).prePlanText!),
      retries: 0,
      completedTasksDetails: state.completedTasksDetails || [],
      recursionCount: state.recursionCount,
      recursionLimit: state.recursionLimit,
      workspaceConfig: state.workspaceConfig,
      conversations: { [CONV_KEYS.NODE_EXECUTE]: [], [CONV_KEYS.NODE_PLAN]: [] },
      _activePhase: 'execute' as const,
      _verificationTracker: undefined,
    };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 0.7: Verification task retry — always re-diagnose
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Verification tasks must re-run build/test on retry to get fresh error state.
  // Error tasks are code-fix only — they don't run a diagnostic loop even on retry.
  if (isRetry && nextTask.type === 'verification') {
    console.log(`\n🔄 [Plan] Verification retry — will re-run build/test via tool loop for fresh error analysis`);
    console.log(`   Violations from previous attempt: ${state.violations?.length || 0}`);
    // Fall through to full plan flow (keyword/RAG/tool-loop/planText generation)
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 0.9: Re-entry from tool (plan↔tool loop)
  //
  // Delegates to `runPlanToolLoopPhase`. That helper may:
  //   - Produce a final plan and return the fully-assembled state here
  //     (kind: 'return') — plan() short-circuits with that state.
  //   - Decide to fall through into normal plan generation, optionally
  //     forcing no-tools on the next LLM call (kind: 'fallthrough').
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const toolLoopOutcome = await runPlanToolLoopPhase(state, nextTask, preservedRetries);
  if (toolLoopOutcome.kind === 'return') {
    return toolLoopOutcome.state;
  }
  if (toolLoopOutcome.forceNoTools) {
    forceNoTools = true;
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SETUP FAST PATH: Skip keyword/RAG/tool-loop entirely.
  // New projects have no existing code to search or explore.
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (nextTask.type === 'setup') {
    console.log(`⚡ [Plan] Setup task — skipping keyword/RAG/tool-loop (no existing code to search)`);

    const emptyCodeContext = {
      source: 'plan' as const,
      filePaths: [] as string[],
      files: [] as any[],
      stats: { filesLoaded: 0, stackTraceCount: 0, semanticCount: 0, deduplicatedCount: 0, estimatedTokens: 0 },
    };

    const setupRemainingTasks = (state.taskQueue?.getAll() || [])
      .filter(t => t.id !== nextTask.id)
      .map(t => ({ id: t.id, name: t.name, description: t.description, priority: t.priority }));

    const setupPlanText = await generatePlanText(
      llm, nextTask, state, emptyCodeContext, [],
      state.violations, undefined, setupRemainingTasks,
    );

    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'plan', state.workerId ?? 0);
    }

    return {
      ...state,
      currentTask: nextTask,
      projectCodeContext: emptyCodeContext,
      referenceCodeContexts: [],
      lessons: [],
      planText: setupPlanText,
      _executeBudget: computeBudgetFromPlanText(setupPlanText ?? ''),
      retries: preservedRetries,
      completedTasksDetails: state.completedTasksDetails || [],
      recursionCount: state.recursionCount,
      recursionLimit: state.recursionLimit,
      workspaceConfig: state.workspaceConfig,
      _activePhase: 'execute' as const,
      conversations: { [CONV_KEYS.NODE_PLAN]: [] },
    };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 0.8: Generate directory tree early (for keyword LLM)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  let directoryTree: string | undefined;
  const planFileSystem = state.deps?.fileSystem;
  if (planFileSystem) {
    try {
      const { generateDirectoryTree } = await import('./combineCodeContext');
      directoryTree = await generateDirectoryTree(planFileSystem, 4);
      if (directoryTree) {
        console.log(`📂 [Plan] Directory tree generated early for keyword LLM`);
      }
    } catch {
      // Non-critical: keyword LLM works without directory tree
    }
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 1: Generate task-specific keywords (LLM 1st request)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  let taskKeywords: TaskKeywords;
  
  if (isRetry || skipKeywordAndRAG) {
    // On retry or re-verification: skip LLM keyword generation.
    // Retry extracts error files from violations; reverify has context from prior cycle.
    const errorFilesFromViolations = isRetry ? extractFilesFromViolations(state.violations) : [];
    taskKeywords = {
      errorFiles: errorFilesFromViolations,
      keywords: [],
      requiredFiles: [],
      references: new Map<string, string[]>()
    };
    if (errorFilesFromViolations.length > 0) {
      console.log(`🔄 [Plan] Retry: extracted ${errorFilesFromViolations.length} error file(s) from violations`);
      errorFilesFromViolations.forEach(f => console.log(`   - ${f}`));
    } else {
      console.log(`🔄 [Plan] Retry: no error files in violations, skipping keyword generation`);
    }
  } else if (llm) {
    console.log(`🔑 [Plan] Generating search keywords...`);
    const generatedKeywords = await generateTaskKeywords(llm, nextTask, state, directoryTree);
    
    // Merge with violation files (after LLM response)
    const errorFilesFromViolations = extractFilesFromViolations(state.violations);
    
    if (errorFilesFromViolations.length > 0) {
      console.log(`🔍 [Plan] Merging ${errorFilesFromViolations.length} file(s) from violations:`);
      errorFilesFromViolations.forEach(f => console.log(`   - ${f}`));
    }
    
    taskKeywords = {
      errorFiles: [...errorFilesFromViolations, ...generatedKeywords.errorFiles],
      keywords: generatedKeywords.keywords,
      requiredFiles: generatedKeywords.requiredFiles,
      references: generatedKeywords.references
    };
    
    // Display merged keywords to UI
    await displayKeywords(taskKeywords);
    logKeywords(taskKeywords);
  } else {
    // Fallback without LLM
    taskKeywords = {
      errorFiles: extractFilesFromViolations(state.violations),
      keywords: [],
      requiredFiles: [],
      references: new Map<string, string[]>()
    };
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 2: Combine code context (RAG: Vector DB + Git + Local)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  let projectCodeContext: any = undefined;
  let referenceCodeContexts: any[] = [];
  let lessons: any[] = [];  // ✅ Lessons from RAG
  
  // RAG: Combines files from Vector DB, Git changes, and local reads.
  // Skip on re-verification — context from prior cycle is already enriched.
  const retriever = state.deps?.retriever;
  const vectorDB = state.deps?.vectorDB;
  const git = state.deps?.git;
  
  if (retriever && vectorDB && git && !skipKeywordAndRAG) {
    const combinedResult = await combineCodeContext(
      taskKeywords,
      state,
      retriever,
      vectorDB,
      git,
      directoryTree
    );
    
    // ✅ Extract context and lessons from result
    if (combinedResult) {
      projectCodeContext = combinedResult.context;
      lessons = combinedResult.lessons || [];
      
    }
    
    // Load reference projects if needed
    if (projectCodeContext && state.referenceRequests && state.referenceRequests.length > 0) {
      const { extractFilesFromCode } = await import('./utils');
      referenceCodeContexts = await loadReferenceContexts(
        state,
        taskKeywords,
        retriever,
        vectorDB,
        git,
        extractFilesFromCode
      );
    }
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 2.5: Ensure projectCodeContext is always defined
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Even if no files were loaded, create empty context for checkpoint
  if (!projectCodeContext) {
    projectCodeContext = {
      source: 'plan' as const,
      filePaths: [],
      files: [],
      stats: {
        filesLoaded: 0,
        stackTraceCount: 0,
        semanticCount: 0,
        deduplicatedCount: 0,
        estimatedTokens: 0
      }
    };
    console.log(`   ℹ️  No files loaded - using empty projectCodeContext`);
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 3: Generate implementation plan (LLM 2nd request)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  
  // UI doc injection is now handled by ArtifactPipeline in planGeneration.ts
  // (task.include selects the right UI artifacts, no separate uiDoc needed)
  const uiDocForPlan: string | undefined = undefined;
  
  // ✅ Extract remaining tasks for cross-task awareness in plan prompt
  const remainingTasks = (state.taskQueue?.getAll() || [])
    .filter(t => t.id !== nextTask.id)
    .map(t => ({ id: t.id, name: t.name, description: t.description, priority: t.priority }));

  let planText: string | undefined;
  const requiresPlan = taskRequiresPlan(nextTask);
  const isVerificationTask = nextTask.type === 'verification';
  // Re-read node-plan history here — STEP 0.9 (`runPlanToolLoopPhase`) may
  // have appended to or cleared it before we reach the main plan LLM call.
  const nodePlan = getConv(state.conversations, CONV_KEYS.NODE_PLAN);
  const planToolRounds = nodePlan.length / 2;
  // error tasks use tool loop via requiresPlan (true), verification via isVerificationTask
  const tryToolsFirst = llm && (requiresPlan || isVerificationTask) && planToolRounds < PLAN_TOOL_LOOP_MAX && !forceNoTools;

  // ── Inject previous batch split context for re-enqueued verification tasks ──
  // When a verification task was previously batch-split and re-enqueued, attach
  // the history of previous attempts so the LLM can try a different strategy.
  let diagnosticRetryContext: string | undefined;
  if (isVerificationTask && nextTask._previousBatchDiagnostics) {
    const cycle = nextTask._batchSplitCount || 0;
    diagnosticRetryContext =
      `\n\n### PREVIOUS BATCH SPLIT ATTEMPT (Cycle ${cycle})\n` +
      `Error sub-tasks were created and executed, but errors persist.\n` +
      `Previous diagnostics: ${nextTask._previousBatchDiagnostics}\n` +
      `Analyze whether these are NEW errors (cascading from compiler) or SAME errors (fix failed). ` +
      `Adjust strategy accordingly.`;
    console.log(`📋 [Plan] Injecting previous batch split context (cycle ${cycle}) into diagnostic prompt`);
  }

  // Inject completed error task details so the LLM knows what was already tried
  if (isVerificationTask && nextTask._batchSplitCount && nextTask._batchSplitCount > 0) {
    const completedErrorTasks = (state.completedTasksDetails || [])
      .filter((t: any) => t.type === 'error' && (t as any).prePlanText);

    if (completedErrorTasks.length > 0) {
      const MAX_PLAN_CHARS = 2000;
      const MAX_TOTAL_CHARS = 8000;
      let totalChars = 0;
      const attempts: string[] = [];
      for (const [i, t] of completedErrorTasks.entries()) {
        const plan = (t as any).prePlanText!;
        const truncated = plan.length > MAX_PLAN_CHARS
          ? plan.substring(0, MAX_PLAN_CHARS) + '... [truncated]'
          : plan;
        const entry = `#### Error Fix ${i + 1}: ${t.name}\n${t.description || ''}\n\`\`\`json\n${truncated}\n\`\`\``;
        totalChars += entry.length;
        if (totalChars > MAX_TOTAL_CHARS) {
          attempts.push(`... and ${completedErrorTasks.length - i} more error tasks (truncated)`);
          break;
        }
        attempts.push(entry);
      }

      const previousAttemptsContext =
        `\n\n### COMPLETED ERROR FIX TASKS (${completedErrorTasks.length} tasks)\n` +
        `These fixes were applied. Current errors may be cascading (new layer revealed) ` +
        `or regression (fix introduced new issues). Use this context to plan accurately.\n\n` +
        attempts.join('\n\n');

      diagnosticRetryContext = (diagnosticRetryContext || '') + previousAttemptsContext;
    }
  }

  // Inject accumulated plan history so plan LLM can see ALL previous attempts
  const planHistory = (state._appliedPlanHistory || []) as string[];
  if (planHistory.length > 0 && nextTask.type === 'verification') {
    const recentHistory = planHistory.slice(-3);
    let historyContext = `\n\n### PREVIOUS FIXES APPLIED BUT ERROR PERSISTS\n` +
      `${planHistory.length} remediation plan(s) were applied but the error was NOT resolved:\n\n`;
    recentHistory.forEach((plan, i) => {
      const attemptNum = planHistory.length - recentHistory.length + i + 1;
      historyContext += `#### Attempt ${attemptNum}\n\`\`\`json\n${plan}\n\`\`\`\n\n`;
    });
    if (planHistory.length >= 2) {
      historyContext +=
        `**ESCALATION**: ${planHistory.length} different fixes have failed. ` +
        `The error message is likely a SYMPTOM, not the root cause. ` +
        `Broaden your analysis:\n` +
        `- Observe **warnings and non-error output** from failed commands — they may identify the true cause\n` +
        `- Observe **mode-specific behavior** — success in one mode but failure in another points to environment, not code\n` +
        `- Consider environment-level fixes (scripts, config files, runtime settings) rather than source code changes\n` +
        `- Do NOT try another variation of the same category of fix\n`;
    } else {
      historyContext += `You MUST try a FUNDAMENTALLY DIFFERENT approach. Do NOT repeat the same fix.\n`;
    }
    diagnosticRetryContext = (diagnosticRetryContext || '') + historyContext;
    console.log(`📋 [Plan] Injected ${planHistory.length} previous plan(s) as context — ${planHistory.length >= 2 ? 'ESCALATION triggered' : 'different approach requested'}`);
  }

  if (tryToolsFirst) {
    const violationsText = composeViolationsText(
      state.violations,
      diagnosticRetryContext,
      retrySummaryText,
    );
    const contentBlocks = await buildPlanPromptBlocks(state, nextTask, projectCodeContext, violationsText, uiDocForPlan, remainingTasks, { hasTools: true });
    const messages = [{ role: 'user' as const, content: contentBlocks }];
    const result = await runPlanLLMWithTools(state, messages, nextTask);
    if (result && '_activePhase' in result) {
      if (state.deps?.workflowUpdate && state._httpJobId) {
        await state.deps.workflowUpdate.exitNode(state._httpJobId, 'plan', state.workerId ?? 0);
      }
        return {
          ...state,
          currentTask: nextTask,
          conversations: { [CONV_KEYS.NODE_PLAN]: result.nodePlanHistory },
          _activePhase: 'plan' as const,
          llmResponse: result.llmResponse,
          projectCodeContext,
          referenceCodeContexts,
          lessons,
        };
    }
    if (result && 'planText' in result) {
      planText = result.planText;
    }
  }

  if (planText === undefined) {
    if (isVerificationTask) {
      // Verification tasks: tool loop didn't produce a plan,
      // meaning build/test wasn't run in exploration. Generate empty plan —
      // execute will handle via its verification template.
      planText = '';
      console.log(`📋 [Plan] Verification task "${nextTask.name}": tool loop did not produce plan, proceeding with empty planText`);
    } else {
      planText = await generatePlanText(
        llm,
        nextTask,
        state,
        projectCodeContext,
        referenceCodeContexts,
        state.violations,
        uiDocForPlan,
        remainingTasks,
        retrySummaryText,
      );
    }
  }
  
  // ✅ DO NOT clear violations here! They need to be passed to CodeGen node for retry context
  // Plan node consumes violations to generate retry context, but CodeGen also needs them
  // to inject violation warnings into the LLM prompt
  if (state.violations && state.violations.length > 0) {
    console.log(`📋 [Plan] Passing ${state.violations.length} violation(s) to CodeGen for prompt injection`);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 3.5: Diagnostic batch split — large error sets become sub-tasks
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const preSplitPlanText = planText ?? '';
  planText = processDiagnosticBatchSplit(state, preSplitPlanText, nextTask);
  const batchSplitOccurred = preSplitPlanText.length > 50 && planText === '';
  const diagnosticPass = isVerificationPassWithoutCodeGen(state, planText, batchSplitOccurred);
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 4: Update state
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  try {
    const updatedState = { 
      ...state,
      currentTask: nextTask,
      projectCodeContext,
      referenceCodeContexts,
      lessons,
      planText,
      _executeBudget: planText ? computeBudgetFromPlanText(planText) : undefined,
      retries: preservedRetries,
      completedTasksDetails: state.completedTasksDetails || [],
      recursionCount: state.recursionCount,
      recursionLimit: state.recursionLimit,
      workspaceConfig: state.workspaceConfig,
      _activePhase: 'execute' as const,
      conversations: { [CONV_KEYS.NODE_PLAN]: [] },
      llmResponse: (batchSplitOccurred || diagnosticPass)
        ? { done: true, textResponse: '', thinking: '', toolCalls: [] }
        : { done: false, textResponse: '', thinking: '', toolCalls: [] },
    };
    
    // ✅ DEBUG: Verify planText is properly stored
    console.log(`🔍 [Plan] Returning state with planText: ${planText ? planText.length : 0} chars`);
    if (planText) {
      console.log(`   ✅ planText stored in state.planText`);
      console.log(`   Preview: "${planText.substring(0, 100).replace(/\n/g, ' ')}..."`);
    } else {
      console.log(`   ⚠️  planText is empty!`);
    }
    
    // Exit node for workflow tracking
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'plan', state.workerId ?? 0);
    }
    
    return updatedState;
  } catch (error: any) {
    console.error('\n❌ [Plan] Failed to update state:', error);
    throw error;
  }
}
