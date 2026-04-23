/**
 * Plan Node — thin orchestrator.
 *
 * The plan phase is organised as a pipeline of small parts:
 *   1. `parts.entry.resolvePlanEntry`     — STEP 0 entry dispatch.
 *   2. short-circuit checks (skip / prePlanText / setup fast path).
 *   3. `parts.planLLM.runPlanToolLoopPhase` — STEP 0.9 plan↔tool loop.
 *   4. `parts.rag.runPlanRAG`             — STEP 0.8~STEP 2.5 RAG pipeline.
 *   5. STEP 3 — generate planText (optionally via tool-loop first).
 *   6. `parts.batchSplit.processDiagnosticBatchSplit` — STEP 3.5 escalation.
 *   7. STEP 4 — return finalised state.
 *
 * R1 — the orchestrator stays blind to `task.type`; all task-type
 * discrimination is delegated to per-task predicates (`isVerificationTask`,
 * `isErrorTask`, `isSetupTask`) exported from each `tasks/{type}/model/is.ts`
 * bundle, or to hooks (`plan.initSession`, `plan.buildPrompt`, etc.).
 * Sites where BOTH verification and error share behaviour (empty-plan
 * short-circuit, remediation-plan label in execute) spell the disjunction
 * out explicitly instead of hiding it behind a "diagnostic" alias, because
 * the two task types diverge in meaningful ways elsewhere (error never owns
 * a VerificationSession; error is blocked from build/test).
 */

import type { LLMClient } from '../../../../../../core/ports';
import { extractLLMInfo } from '../../../../../../core/ports/workflow';
import { CONV_KEYS, getConv } from '../../../../../common/graph/conversations';
import { ArchitectGraphState } from '../../state';
import { CodeTask } from '../../../../types/task';
import {
  buildPlanPromptBlocks,
  generatePlanText,
  runPlanLLMWithTools,
  taskRequiresPlan,
  PLAN_TOOL_LOOP_MAX,
} from './planGeneration';
import { computeBudgetFromPlanText } from './utils';
import {
  PlanEntryContext,
  composeViolationsText,
  resolvePlanEntry,
} from './parts/entry';
import {
  hasEmptyImplementation,
  isVerificationPassWithoutCodeGen,
  MAX_BATCH_SPLIT_CYCLES,
  processDiagnosticBatchSplit,
} from './parts/batchSplit';
import { runPlanToolLoopPhase } from './parts/planLLM';
import { maybeApplyPlanHistory } from './parts/planHistory';
import { runPlanRAG } from './parts/rag';
import { normalizePlanForHash } from '../../tasks/verification/model/planHash';
import { isVerificationTask } from '../../tasks/verification';
import { isErrorTask } from '../../tasks/error';
import { isSetupTask } from '../../tasks/setup';

// Re-exports for backward-compat with existing imports.
export type { PlanEntryContext } from './parts/entry';
export { resolvePlanEntry } from './parts/entry';
export { runPlanToolLoopPhase } from './parts/planLLM';

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

async function workflowEnter(state: ArchitectGraphState, nextTask: CodeTask): Promise<void> {
  if (!state.deps?.workflowUpdate || !state._httpJobId) return;
  const taskInfo = {
    id: nextTask.id,
    name: nextTask.name,
    type: nextTask.type,
    description: nextTask.description,
    priority: nextTask.priority,
  };
  await state.deps.workflowUpdate.enterNode(
    state._httpJobId,
    'plan',
    state.workerId ?? 0,
    taskInfo,
    state.deps?.llm ? extractLLMInfo(state.deps.llm as LLMClient) : undefined,
    state.recursionCount,
    state.recursionLimit,
  );
}

async function workflowExit(state: ArchitectGraphState): Promise<void> {
  if (!state.deps?.workflowUpdate || !state._httpJobId) return;
  await state.deps.workflowUpdate.exitNode(state._httpJobId, 'plan', state.workerId ?? 0);
}

/**
 * STEP 0.5 — resume an interrupted task without regenerating its plan.
 * Returns a fully-assembled short-circuit state when the conditions hold,
 * otherwise `null` so the orchestrator continues.
 */
async function maybeResumeInterrupted(
  state: ArchitectGraphState,
  entry: PlanEntryContext,
): Promise<ArchitectGraphState | null> {
  const { nextTask, isRetry } = entry;
  const canSkipPlan = (
    !isRetry &&
    nextTask.interrupted === true &&
    state.planText && state.planText.length > 50
  );
  if (!canSkipPlan) return null;

  console.log(`\n⚡ [Plan] Resuming interrupted task "${nextTask.name}" with existing planText (${state.planText!.length} chars)`);
  console.log(`   Skipping: keywords, RAG, planText generation`);
  console.log(`   Conversations: ${getConv(state.conversations, CONV_KEYS.NODE_EXECUTE).length} execute messages preserved`);

  await workflowExit(state);
  return {
    ...state,
    currentTask: nextTask,
    planText: state.planText,
    retries: 0,
    completedTasksDetails: state.completedTasksDetails || [],
    recursionCount: state.recursionCount,
    recursionLimit: state.recursionLimit,
    workspaceConfig: state.workspaceConfig,
  };
}

/**
 * STEP 0.6 — pre-planned error task (batch-split output). Skip planning
 * entirely and go straight into execute with the carried prePlanText.
 */
async function maybePrePlannedFastPath(
  state: ArchitectGraphState,
  entry: PlanEntryContext,
): Promise<ArchitectGraphState | null> {
  const { nextTask, isRetry } = entry;
  const prePlanText = (nextTask as CodeTask).prePlanText;
  // budget_exhausted retry should re-attempt the same fix, not re-run tsc diagnostics.
  // Re-running diagnostics on retry causes cascade: sibling domain errors → duplicate subtasks.
  const hasPrePlanText =
    prePlanText != null &&
    prePlanText.length > 50 &&
    (!isRetry || isErrorTask(nextTask));

  if (!hasPrePlanText) return null;

  console.log(`\n⚡ [Plan] Pre-planned error task "${nextTask.name}" — using prePlanText (${prePlanText!.length} chars)`);
  console.log(`   Skipping: keywords, RAG, diagnostic tool loop, planText generation`);

  await workflowExit(state);
  return {
    ...state,
    currentTask: nextTask,
    planText: prePlanText!,
    _executeBudget: computeBudgetFromPlanText(prePlanText!),
    retries: 0,
    completedTasksDetails: state.completedTasksDetails || [],
    recursionCount: state.recursionCount,
    recursionLimit: state.recursionLimit,
    workspaceConfig: state.workspaceConfig,
    conversations: { [CONV_KEYS.NODE_EXECUTE]: [] },
    _activePhase: 'execute' as const,
    // prePlanText path only fires for error tasks, so the preceding
    // verification session should not leak into the error-task execution.
    verification: undefined,
  };
}

/**
 * Setup task fast-path — new projects have no existing code to search or
 * explore, so keyword/RAG/tool-loop are skipped and planText is rendered
 * directly from the setup variant.
 */
async function maybeSetupFastPath(
  state: ArchitectGraphState,
  entry: PlanEntryContext,
): Promise<ArchitectGraphState | null> {
  const { nextTask, preservedRetries } = entry;
  if (!isSetupTask(nextTask)) return null;
  const llm = state.deps?.llm as LLMClient | undefined;
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
    llm!, nextTask, state, emptyCodeContext,
    state.violations, undefined, setupRemainingTasks,
  );

  await workflowExit(state);

  return {
    ...state,
    currentTask: nextTask,
    lessons: [],
    planText: setupPlanText,
    _executeBudget: computeBudgetFromPlanText(setupPlanText ?? ''),
    retries: preservedRetries,
    completedTasksDetails: state.completedTasksDetails || [],
    recursionCount: state.recursionCount,
    recursionLimit: state.recursionLimit,
    workspaceConfig: state.workspaceConfig,
    _activePhase: 'execute' as const,
    conversations: { [CONV_KEYS.NODE_EXECUTE]: [] },
  };
}

/**
 * STEP 3 — run the main plan-LLM call. Prefers tool-enabled mode when the
 * task requires exploration; falls back to `generatePlanText` otherwise.
 *
 * Returns either:
 *   - a `ArchitectGraphState` when the LLM chose tool calls (caller
 *     short-circuits and the next graph tick re-enters plan),
 *   - a plain `planText` string when the LLM produced a final plan.
 *
 * R1 — this function stays blind to `task.type`. Prior-attempt reasoning
 * continuity is carried exclusively via the Session-driven summary lines
 * rendered inside the verification-variant template (see
 * `tasks/verification/hooks/plan.ts::buildPrompt`) and the
 * rules-level pointer to `sessions/architect/code.json` for LLM-self-
 * service lookup. Previously this phase embedded a verification-only
 * "diagnosticRetryContext" narrative — completed error sub-tasks'
 * prePlanText and planHistory bodies — directly into the system prompt.
 * That embedding violated (a) the task-boundary isolation principle
 * (verification was the sole exception, leaking prior tasks' internals
 * into the next plan), (b) the R1 phase-blind rule (`isVerificationTask`
 * branch inside the phase node), and (c) the "state lives on disk, not
 * in prompts" principle (`sessions/architect/code.json` already holds
 * the same data). The removal fell out of the verification-loop
 * postmortem (see `docs/tmp/verification-loop-postmortem.md` §4.1).
 */
async function runMainPlanLLM(
  state: ArchitectGraphState,
  entry: PlanEntryContext,
  rag: Awaited<ReturnType<typeof runPlanRAG>>,
  forceNoTools: boolean,
): Promise<ArchitectGraphState | { planText: string }> {
  const { nextTask } = entry;
  const llm = state.deps?.llm as LLMClient | undefined;
  const requiresPlan = taskRequiresPlan(nextTask);
  const isVerification = isVerificationTask(nextTask);

  const remainingTasks = (state.taskQueue?.getAll() || [])
    .filter(t => t.id !== nextTask.id)
    .map(t => ({ id: t.id, name: t.name, description: t.description, priority: t.priority }));

  const nodePlan = getConv(state.conversations, CONV_KEYS.NODE_PLAN);
  const planToolRounds = nodePlan.length / 2;
  const tryToolsFirst = llm && (requiresPlan || isVerification) && planToolRounds < PLAN_TOOL_LOOP_MAX && !forceNoTools;

  // UI doc injection is now handled by ArtifactPipeline in planGeneration.ts.
  const uiDocForPlan: string | undefined = undefined;

  if (tryToolsFirst) {
    const violationsText = composeViolationsText(state.violations);
    const { blocks: contentBlocks, vars: hookLogVars } = await buildPlanPromptBlocks(
      state, nextTask, rag.codeContext, violationsText, uiDocForPlan, remainingTasks, { hasTools: true },
    );
    const messages = [{ role: 'user' as const, content: contentBlocks }];
    const result = await runPlanLLMWithTools(state, messages, nextTask, { extraLogVars: hookLogVars });
    if (result && '_activePhase' in result) {
      await workflowExit(state);
      return {
        ...state,
        currentTask: nextTask,
        conversations: { [CONV_KEYS.NODE_PLAN]: result.nodePlanHistory },
        _activePhase: 'plan' as const,
        llmResponse: result.llmResponse,
        lessons: rag.lessons,
      };
    }
    if (result && 'planText' in result) {
      return { planText: result.planText };
    }
  }

  if (isVerification) {
    // Tool loop didn't produce a plan — execute handles via verification template.
    console.log(`📋 [Plan] Verification task "${nextTask.name}": tool loop did not produce plan, proceeding with empty planText`);
    return { planText: '' };
  }

  const planText = await generatePlanText(
    llm!,
    nextTask,
    state,
    rag.codeContext,
    state.violations,
    uiDocForPlan,
    remainingTasks,
  );
  return { planText: planText ?? '' };
}

/**
 * Main plan orchestrator. See module header for the phase ordering.
 */
export async function plan(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  state.recursionCount = (state.recursionCount || 0) + 1;

  // Verification scenario harness — no-op in production.
  const { traceNodeEntry } = await import('../../../../../../utils/verificationTrace');
  traceNodeEntry('plan', state.currentTask ?? undefined);

  // STEP 0: entry classification.
  const entry = await resolvePlanEntry(state);
  const { nextTask, isRetry, preservedRetries, skipKeywordAndRAG } = entry;

  await workflowEnter(state, nextTask);

  // STEP 0.5 — resume interrupted task.
  const resumed = await maybeResumeInterrupted(state, entry);
  if (resumed) return resumed;

  // STEP 0.6 — pre-planned error fast path.
  const prePlanned = await maybePrePlannedFastPath(state, entry);
  if (prePlanned) return prePlanned;

  // STEP 0.7 — verification retry always re-diagnoses (fall through).
  if (isRetry && isVerificationTask(nextTask)) {
    console.log(`\n🔄 [Plan] Verification retry — will re-run build/test via tool loop for fresh error analysis`);
    console.log(`   Violations from previous attempt: ${state.violations?.length || 0}`);
  }

  // STEP 0.9 — plan↔tool loop re-entry.
  const toolLoop = await runPlanToolLoopPhase(state, nextTask, preservedRetries);
  if (toolLoop.kind === 'return') return toolLoop.state;
  const forceNoTools = !!toolLoop.forceNoTools;

  // Setup fast path — skip RAG entirely.
  const setupFast = await maybeSetupFastPath(state, entry);
  if (setupFast) return setupFast;

  // STEP 0.8 ~ STEP 2.5 — RAG pipeline.
  const rag = await runPlanRAG(state, { nextTask, isRetry, skipKeywordAndRAG });

  // STEP 3 — plan LLM.
  const llmOutcome = await runMainPlanLLM(state, entry, rag, forceNoTools);
  if ('_activePhase' in llmOutcome) return llmOutcome; // tool-call re-entry
  const planTextRaw = llmOutcome.planText;

  // Passing violations down — CodeGen still injects them into its prompt.
  if (state.violations && state.violations.length > 0) {
    console.log(`📋 [Plan] Passing ${state.violations.length} violation(s) to CodeGen for prompt injection`);
  }

  // STEP 3.5 — diagnostic batch split.
  const planText = processDiagnosticBatchSplit(state, planTextRaw, nextTask);
  const batchSplitOccurred = planTextRaw.length > 50 && planText === '';
  const diagnosticPass = isVerificationPassWithoutCodeGen(state, planText, batchSplitOccurred);
  // Empty-implementation short-circuit: a remediation-style task (verification
  // with all gates already passed, or error with no pending fixes in the batch
  // plan) whose JSON has no modify/create/delete entries. Router used to mutate
  // `llmResponse` here (R1 violation) — the plan node flips `done:true` itself
  // so the router stays a pure read-only predicate. Feature/setup/ui plans
  // cannot legitimately be empty, so they fall through to execute and let the
  // LLM error surface there.
  const isRemediationTask = isVerificationTask(nextTask) || isErrorTask(nextTask);
  const emptyImplShortCircuit = isRemediationTask && hasEmptyImplementation(planText);

  // Single-writer plan-history push. See `parts/planHistory.ts` for the
  // guard formula — shared with the two short-circuit paths in
  // `parts/planLLM.ts` so the condition stays in one place.
  maybeApplyPlanHistory(state, planText, batchSplitOccurred, nextTask);

  // STEP 4 — return finalised state.
  try {
    const updatedState: ArchitectGraphState = {
      ...state,
      currentTask: nextTask,
      lessons: rag.lessons,
      planText,
      _executeBudget: planText ? computeBudgetFromPlanText(planText) : undefined,
      retries: preservedRetries,
      completedTasksDetails: state.completedTasksDetails || [],
      recursionCount: state.recursionCount,
      recursionLimit: state.recursionLimit,
      workspaceConfig: state.workspaceConfig,
      _activePhase: 'execute' as const,
      conversations: { [CONV_KEYS.NODE_EXECUTE]: [] },
      llmResponse: (batchSplitOccurred || diagnosticPass || emptyImplShortCircuit)
        ? { done: true, textResponse: '', thinking: '', toolCalls: [] }
        : { done: false, textResponse: '', thinking: '', toolCalls: [] },
    };
    if (emptyImplShortCircuit) {
      console.log(`[Plan] Empty implementation plan detected for ${nextTask.type} task → short-circuit to checkTaskStatus`);
    }

    console.log(`🔍 [Plan] Returning state with planText: ${planText ? planText.length : 0} chars`);
    if (planText) {
      console.log(`   ✅ planText stored in state.planText`);
      console.log(`   Preview: "${planText.substring(0, 100).replace(/\n/g, ' ')}..."`);
    } else {
      console.log(`   ⚠️  planText is empty!`);
    }

    await workflowExit(state);
    return updatedState;
  } catch (error: any) {
    console.error('\n❌ [Plan] Failed to update state:', error);
    throw error;
  }
}
