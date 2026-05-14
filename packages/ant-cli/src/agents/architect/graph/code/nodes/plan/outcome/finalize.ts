/**
 * STEP 3.5 ~ STEP 4 — finalize the plan-LLM raw output into the graph
 * state shape executed downstream by the execute node.
 *
 * Single SSOT for the post-LLM pipeline:
 *   1. `dispatchBatchSplit` — fan out a remediation plan into sub-tasks
 *      via `outcome/queueDispatch.ts`. Queue mutation (sub-task push,
 *      parent re-queue / drop, `_batchSplitRequeued`,
 *      `task.batchSplitCount` bump) lives there. Returned `planText === ''`
 *      means fan-out fired.
 *   2. Compute shortcut flags (batchSplitOccurred / diagnosticPass /
 *      emptyImplShortCircuit / isDone) — decides short-circuit to
 *      checkTaskStatus vs hand-off to execute.
 *   3. `tracePlanFinalize` — single observation point for all three
 *      call sites (plan/index, plan/llm/toolLoop overlimit + continuation).
 *   4. Return the finalised `ArchitectGraphState` projection.
 */

import { CONV_KEYS } from '../../../../../../common/graph/conversations';
import type { ArchitectGraphState } from '../../../state';
import type { CodeTask } from '../../../../../types/task';
import { isVerifyModeActive } from '../../../tasks/_shared/verify';
import { dispatchBatchSplit } from './queueDispatch';
import { tracePlanFinalize, type PlanEmptyOrigin } from './trace';

export type FinalizeCallSite = 'plan-index' | 'plan-llm-toolloop';

export interface FinalizePlanOutcomeInput {
  /** Plan text produced by the plan-LLM call (or finalize-from-exploration). */
  preSplitPlanText: string;
  /** Trace label so the three former call sites stay distinguishable. */
  callSite: FinalizeCallSite;
  /**
   * RAG lessons collected during this plan entry. The two callers
   * differ in provenance — STEP 4 (`plan-index`) carries `rag.lessons`
   * from the freshly-run RAG pipeline, the tool-loop callers carry
   * `state.lessons` from prior entry. Pass through unchanged.
   */
  lessons?: ArchitectGraphState['lessons'];
  /** Caller-classified empty-`planText` origin; see `outcome/trace.ts`. */
  planEmptyOrigin?: PlanEmptyOrigin;
  /**
   * Skip the `dispatchBatchSplit` step; pass `preSplitPlanText` through
   * unchanged. Used by the plan-node retry-loop after a
   * `BatchSplitSchemaViolation` exhausts its attempts (graceful fallback —
   * parent runs its own plan as a single task) and by the tool-loop path
   * on schema violation (re-running tool loop is too expensive). Default
   * `false` — normal flow always attempts fan-out.
   */
  skipBatchSplit?: boolean;
}

export function finalizePlanOutcome(
  state: ArchitectGraphState,
  nextTask: CodeTask,
  input: FinalizePlanOutcomeInput,
): ArchitectGraphState {
  const { preSplitPlanText, callSite, lessons, planEmptyOrigin, skipBatchSplit } = input;

  const planText = skipBatchSplit
    ? preSplitPlanText
    : dispatchBatchSplit(state, preSplitPlanText, nextTask);

  const batchSplitOccurred = preSplitPlanText.length > 50 && planText === '';
  // Verify-mode + 빈 planText(plan-tool-loop의 sentinel shortcut이 비워줌) 면
  // cycle 종료 신호. task-type-blind — requiresVerification(task)인 모든 task
  // (verification + selfVerifyOnDone) 가 동일 verify-mode 계약을 공유한다.
  // (solar-coming-bough 회귀: 옛 게이트는 isVerificationTask/allowsEmptyImplShortcut
  // 정적 검사라 Tier-2 self-verify의 sentinel을 인식 못 했다.)
  const verifyMode = isVerifyModeActive(state);
  const diagnosticPass = verifyMode && planText === '' && !batchSplitOccurred;
  const isDone = batchSplitOccurred || diagnosticPass;

  tracePlanFinalize(state, nextTask, {
    callSite,
    preSplitPlanText,
    planText,
    batchSplitOccurred,
    diagnosticPass,
    // 옛 `emptyImplShortCircuit` axis는 `diagnosticPass`로 통합. 로그 스키마
    // 호환을 위해 키는 유지 (executionLogger / kibana 쿼리 등 외부 grep).
    emptyImplShortCircuit: false,
    // 옛 `isRemediationTask`는 `allowsEmptyImplShortcut` 플래그였다. 이제
    // verify-mode 진입 여부가 그 의미를 직접 표현한다. 키는 grep 호환으로 보존.
    isRemediationTask: verifyMode,
    decision: isDone ? 'done' : 'execute',
    planEmptyOrigin,
  });

  if (callSite === 'plan-index') {
    if (diagnosticPass) {
      console.log(`[Plan] Verify-mode sentinel detected for ${nextTask.type} task → short-circuit to checkTaskStatus`);
    }
    console.log(`🔍 [Plan] Returning state with planText: ${planText ? planText.length : 0} chars`);
    if (planText) {
      console.log(`   ✅ planText stored in state.planText`);
      console.log(`   Preview: "${planText.substring(0, 100).replace(/\n/g, ' ')}..."`);
    } else {
      console.log(`   ⚠️  planText is empty!`);
    }
  }

  return {
    ...state,
    currentTask: nextTask,
    lessons: lessons ?? state.lessons ?? [],
    planText,
    completedTasksDetails: state.completedTasksDetails || [],
    recursionCount: state.recursionCount,
    recursionLimit: state.recursionLimit,
    workspaceConfig: state.workspaceConfig,
    _activePhase: 'execute' as const,
    conversations: { [CONV_KEYS.NODE_EXECUTE]: [] },
    llmResponse: isDone
      ? { done: true, textResponse: '', thinking: '', toolCalls: [] }
      : { done: false, textResponse: '', thinking: '', toolCalls: [] },
  };
}
