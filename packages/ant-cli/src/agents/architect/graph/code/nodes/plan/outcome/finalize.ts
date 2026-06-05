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
import { hooksForTaskType } from '../../../tasks/_shared/registry';
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
  // 빈 planText (no batch-split) 는 task type 무관 cycle 종료 신호다 —
  // "LLM이 자기 surface 에 할 일이 없다고 판단했다". 이 신호는 plan-tool-loop
  // 의 sentinel shortcut (`llm/tools.ts`) 이 LLM이 emit한 parseable no-op JSON
  // (`{diagnostics.totalErrors:0}` 또는 `{implementation:{modify:[],create:[],
  // delete:[]}}`) 을 ''로 변환하면서 발생한다.
  //
  // 두 RCA가 같은 게이트에 모인다:
  // (1) solar-coming-bough — Tier-2 self-verify error의 verify-mode sentinel
  //     이 정적 task-type 게이트에 막혔던 결함.
  // (2) hidden-mooring-rivet — error 외 task type도 sibling이 이미 끝낸 일을
  //     받았을 때 동일 sentinel로 즉시 종료할 수 있어야 함. base.md /
  //     rules.md / variants 모든 template이 동일 empty-plan 계약을 가르치므
  //     로 finalize는 task type을 분기하지 않는다.
  //
  // verify-mode는 isRemediationTask 채널로 trace에 별도로 보존된다.
  const verifyMode = isVerifyModeActive(state);
  // doc renders its output in execute (docgen) and produces no plan body —
  // it must NOT be caught by the empty-`planText` no-op sentinel (which is a
  // tool-loop "nothing to fix" signal). `skipPlanRunExecute` declares this;
  // the type stays blind here (R1) — we read the published flag, not a literal.
  const skipPlanRunExecute =
    hooksForTaskType(nextTask.type)?.plan?.skipPlanRunExecute === true;
  const noOpComplete = planText === '' && !batchSplitOccurred && !skipPlanRunExecute;
  const isDone = batchSplitOccurred || noOpComplete;

  tracePlanFinalize(state, nextTask, {
    callSite,
    preSplitPlanText,
    planText,
    batchSplitOccurred,
    // 옛 `diagnosticPass` 키는 trace 스키마 호환 + 의미 일관성을 위해
    // noOpComplete로 매핑한다 (외부 grep / kibana 쿼리가 키 이름에 의존).
    diagnosticPass: noOpComplete,
    // 옛 `emptyImplShortCircuit` axis는 noOpComplete로 통합. 로그 스키마
    // 호환을 위해 키는 유지 (executionLogger / kibana 쿼리 등 외부 grep).
    emptyImplShortCircuit: false,
    // 옛 `isRemediationTask`는 `allowsEmptyImplShortcut` 플래그였다. 이제
    // verify-mode 진입 여부가 그 의미를 직접 표현한다. 키는 grep 호환으로 보존.
    isRemediationTask: verifyMode,
    decision: isDone ? 'done' : 'execute',
    planEmptyOrigin,
  });

  if (callSite === 'plan-index') {
    if (noOpComplete) {
      const reason = verifyMode ? 'Verify-mode sentinel' : 'Empty-plan no-op';
      console.log(`[Plan] ${reason} detected for ${nextTask.type} task → short-circuit to checkTaskStatus`);
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
