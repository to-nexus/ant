/**
 * Execute Router - execute 응답 분석해서 다음 노드 결정
 *
 * 라우팅 로직 (평가 순서):
 * 0. File errors → checkTaskStatus (self-healing, tool 불필요)
 * B. 최근 5분 내 tool 실패 5회 이상 → checkTaskStatus 강제 (실패 tool 루프 차단)
 * 1. Tool calls → tool 노드
 * 2. Done → verification 책임자는 plan 재검증, 그 외 checkTaskStatus
 * A. Final task recursion budget 부족 AND tool/done 없음 → checkTaskStatus (graceful drain)
 * 3. 그 외 → execute 노드 (재추론)
 *
 * Safety Net B는 toolCalls 검사 *위*에 둔다(실패 batch가 매번 tool로 라우팅되어 무력화되지
 * 않도록). Safety Net A는 toolCalls·done 검사 *아래*에 둔다(대기 중 gate-rerun / `<done>` 을
 * 폐기하지 않도록 — A는 진짜 비생산 turn 에서만 발동).
 */

import { ArchitectGraphState, RECURSION_DRAIN_THRESHOLD } from '../state';
import { isVerificationTask } from '../tasks/verification';
import { hooksIfActive } from '../tasks/_shared/registry';
import { isErrorTask } from '../tasks/error';
import { isVerifyModeActive } from '../tasks/_shared/verify';
import { getExecutionLogger } from '../../../../../core/utils/executionLogger';

/**
 * Detect recent tool failures from command history
 */
function detectRecentToolFailures(state: ArchitectGraphState): number {
  if (!state.commandHistory || state.commandHistory.length === 0) {
    return 0;
  }
  
  const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
  const recentFailures = state.commandHistory.filter(h => 
    !h.success && 
    h.timestamp > fiveMinutesAgo
  );
  
  return recentFailures.length;
}

export function routeAfterExecute(state: ArchitectGraphState): string {
  const response = state.llmResponse;
  
  if (!response) {
    console.log('⚠️  [Router] No LLM response, ending');
    return '__end__';
  }
  
  const currentTask = state.currentTask;
  // "Final task" = verify-mode active (Tier 3/4 verification task, or a
  // Tier 2 self-verify task whose plan-node `handleReverifyEntry` committed
  // `_verifyEntered = true` on the apply→verify boundary). Safety Nets A/B
  // defer to checkTaskStatus only in the verification phase, so the
  // predicate is task-type-blind.
  const isVerificationTaskType = currentTask ? isVerificationTask(currentTask) : false;
  const isFinalTask = isVerifyModeActive(state) || isVerificationTaskType;
  const isCurrentErrorTask = currentTask ? isErrorTask(currentTask) : false;

  // Mirror the channel signals the plan node will read on re-entry. Required
  // to triangulate Tier-2 reverify gate failures (cool-mossing-jewel
  // regression, 2026-05-16): a mismatch between values here and the
  // `[PlanEntry] Channel snapshot` line proves the channel was clobbered
  // between router exit and plan entry.
  const selfVerifyOnDone = (currentTask as { selfVerifyOnDone?: boolean } | undefined)?.selfVerifyOnDone;
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📍 [executeRouter] Current Task Info:`);
  console.log(`   Task: ${currentTask?.name || 'none'}`);
  console.log(`   Type: ${currentTask?.type || 'none'}`);
  console.log(`   Priority: ${currentTask?.priority || 'none'}`);
  console.log(`   isFinalTask: ${isFinalTask}`);
  console.log(`   isErrorTask: ${isCurrentErrorTask}`);
  console.log(`   response.done: ${response.done}`);
  console.log(`   response.toolCalls: ${response.toolCalls?.length || 0}`);
  console.log(`   _activePhase: ${state._activePhase}`);
  console.log(`   _verifyEntered: ${state._verifyEntered}`);
  console.log(`   selfVerifyOnDone: ${selfVerifyOnDone}`);
  console.log(`   planTextLen: ${state.planText?.length ?? 0}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  
  // Safety Net A (recursion-budget drain) is evaluated LAST — after the
  // toolCalls and done checks below — so a pending gate-rerun or a `<done>`
  // is never discarded. It fires only on a genuinely non-productive turn
  // (no tool call, no done) near budget exhaustion. See the block before the
  // final `execute` fallback.

  // Safety Net B: Check for repeated tool failures
  if (isFinalTask || isCurrentErrorTask) {
    const recentFailures = detectRecentToolFailures(state);

    if (recentFailures >= 5) {
      console.warn(`⚠️  [Router] ${recentFailures} recent tool failures detected`);
      console.warn(`   🚨 Forcing checkTaskStatus`);
      return 'checkTaskStatus';
    }
  }

  // Runaway is bounded by Safety Net A (recursionLimit), Safety Net B
  // (repeated tool failures), LangGraph's `recursionLimit` ceiling, and
  // `batch_cycle_limit` for queue-side fan-out. Per-task call-count
  // budgets have been retired.


  // 0. File errors 있으면 → checkTaskStatus (tool 실행 불필요, 바로 self-healing)
  if (state.fileErrors && state.fileErrors.length > 0) {
    console.log(`⚠️  [Router] ${state.fileErrors.length} file error(s) detected → checkTaskStatus (skip tool execution)`);
    return 'checkTaskStatus';
  }

  // 1. Tool calls 있으면 → tool 노드
  if (response.toolCalls && response.toolCalls.length > 0) {
    console.log(`🔧 [Router] ${response.toolCalls.length} tool call(s) detected → tool node`);
    return 'tool';
  }
  
  // 2. Done이면 → task 훅에 위임 (verification responsibility holders → plan 재검증, 그 외는 checkTaskStatus)
  // R1 — the router is blind to task.type. `hooksIfActive?.router.routeAfterDone`
  // returns the next node name; the shared verify-mode router (used by both
  // verification task type AND self-verify Tier 2 tasks via composeBundle)
  // chooses 'plan' for reverify whenever the verification cycle is not
  // complete.
  //
  // ★ This router is PURE — no state writes. `_verifyEntered` and the
  // reverify-mode plan-entry path are owned by the plan node
  // (`resolvePlanEntry`/`handleReverifyEntry`), which detects the
  // apply→verify boundary from observable channel state and commits
  // `_verifyEntered:true` in its return delta. Conditional-edge mutations
  // do not propagate to the next node in LangGraph (state is read fresh
  // from channels); see `markVerifyEntered.ts` anti-pattern note.
  if (response.done) {
    const hookNext = hooksIfActive(state)?.router?.routeAfterDone?.(state);
    if (hookNext) {
      console.log(`\n🎯 [Router] ✅ task hook → ${hookNext}\n`);
      return hookNext;
    }
    console.log(`\n🎯 [Router] ✅ TASK DONE → checkTaskStatus\n`);
    return 'checkTaskStatus';
  }
  
  // Safety Net A: recursion-budget drain for a final task that is neither
  // calling a tool nor done — i.e. a genuinely non-productive re-reasoning
  // turn near budget exhaustion. Evaluated here (after toolCalls/done) so a
  // pending gate-rerun or `<done>` is honoured first. Threshold is the shared
  // RECURSION_DRAIN_THRESHOLD, matching the checkTaskStatus drains in
  // routing.ts / workerGraph.ts so there is no dead-band where this forces
  // checkTaskStatus but the drain cannot catch it.
  if (isFinalTask && state.recursionLimit && state.recursionCount) {
    const remaining = state.recursionLimit - state.recursionCount;

    if (remaining < RECURSION_DRAIN_THRESHOLD) {
      console.warn(`⚠️  [Router] Final task recursion budget low (${state.recursionCount}/${state.recursionLimit}), no pending tool/done`);
      console.warn(`   🚨 Forcing checkTaskStatus → graceful drain`);

      const _taskId = currentTask?.id || 'unknown';
      const _lastText = (response as any).lastTextSnippet || '';
      if (state.context?.featurePath && state._httpJobId) {
        // Static import + synchronous writeQueue update — see
        // executionLogger contract (vast-curling-perch C-3 RCA).
        const execLogger = getExecutionLogger({
          featurePath: state.context.featurePath,
          jobId: state._httpJobId,
          jobType: 'code',
        });
        void execLogger.logRecursionBudgetWarning(_taskId, {
          taskName: currentTask?.name || 'unknown',
          current: state.recursionCount!,
          limit: state.recursionLimit!,
          remaining,
          forcedNode: 'checkTaskStatus',
        }).catch(() => { /* non-blocking */ });
        if (!response.done && _lastText) {
          void execLogger.logExecuteInterrupted(_taskId, {
            taskName: currentTask?.name || 'unknown',
            callIndex: state._executeCallIndex || 0,
            lastResponseSnippet: _lastText.slice(0, 200),
            reason: 'recursion_limit',
          }).catch(() => { /* non-blocking */ });
        }
      }

      return 'checkTaskStatus';
    }
  }

  // 3. 그 외 → execute 노드 (재추론 - 드물지만 가능)
  console.log(`🔄 [Router] Continue reasoning → execute node`);
  return 'execute';
}

