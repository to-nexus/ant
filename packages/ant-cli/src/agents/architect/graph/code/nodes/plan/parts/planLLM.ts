/**
 * plan/parts/planLLM.ts — plan↔tool loop orchestration.
 *
 * Extracted from `nodes/plan/index.ts` as part of T6b-α. Behaviour is
 * byte-identical to the inline implementation; only module boundary moves.
 *
 * Responsibilities:
 *   - `runPlanToolLoopPhase`: drives the plan↔tool loop and either produces
 *     a finalized plan state (`kind: 'return'`) or asks the caller to fall
 *     through into normal plan generation (`kind: 'fallthrough'`).
 *   - `enrichContextFromPlanToolLoop`: merges files discovered via
 *     `read_file` during the tool loop into `projectCodeContext`.
 *
 * The diagnostic batch-split hook is imported from `./batchSplit.ts` rather
 * than re-inlined so the two helpers stay co-located with their tests.
 */

import { MessageContentBlock } from '../../../../../../../core/ports/llm';
import { CONV_KEYS, getConv } from '../../../../../../common/graph/conversations';
import { ArchitectGraphState } from '../../../state';
import { CodeTask } from '../../../../../types/task';
import {
  finalizePlanFromExploration,
  PLAN_TOOL_LOOP_MAX,
  runPlanLLMWithTools,
} from '../planGeneration';
import { computeBudgetFromPlanText, extractFilesFromPlanToolLoop } from '../utils';
import {
  hasEmptyImplementation,
  isVerificationPassWithoutCodeGen,
  processDiagnosticBatchSplit,
} from './batchSplit';
import { isVerificationTask } from '../../../tasks/verification';
import { isErrorTask } from '../../../tasks/error';

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

export type PlanToolLoopOutcome =
  | { kind: 'return'; state: ArchitectGraphState }
  | { kind: 'fallthrough'; forceNoTools?: boolean };

/**
 * STEP 0.9 helper — runs the plan↔tool loop and either produces a
 * finalized plan state (to short-circuit plan()) or asks the caller to
 * fall through into normal plan generation.
 */
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
      const isRemediationTask = isVerificationTask(nextTask) || isErrorTask(nextTask);
      const emptyImplShortCircuit = isRemediationTask && hasEmptyImplementation(finalizedPlan);
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
        llmResponse: (batchSplitOccurred || diagnosticPass || emptyImplShortCircuit)
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
