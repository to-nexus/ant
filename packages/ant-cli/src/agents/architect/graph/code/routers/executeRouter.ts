/**
 * Execute Router - execute 응답 분석해서 다음 노드 결정
 *
 * 라우팅 로직:
 * 0. File errors → checkTaskStatus (self-healing, tool 불필요)
 * 1. Tool calls → tool 노드
 * 2. Done → verification 책임자는 plan 재검증, 그 외 checkTaskStatus
 * 3. 그 외 → execute 노드 (재추론)
 *
 * Safety Nets:
 * A. Final task가 recursion limit에 근접 → checkTaskStatus 강제
 * B. 최근 5분 내 tool 실패 5회 이상 → checkTaskStatus 강제
 */

import { ArchitectGraphState } from '../state';
import { isVerificationTask } from '../tasks/verification';
import { hooksIfActive } from '../tasks/_shared/registry';
import { isErrorTask } from '../tasks/error';
import {
  isVerifyModeActive,
  markVerifyEntered,
  requiresVerification,
} from '../tasks/_shared/verify';
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
  // "Final task" = verify-mode active (Tier 3/4 verification, or Tier 2
  // self-verify after the `<done>` arm flipped `_verifyEntered = true`).
  // Safety Nets A/B defer to checkTaskStatus only in the verification
  // phase, so the predicate is task-type-blind.
  const isVerificationTaskType = currentTask ? isVerificationTask(currentTask) : false;
  const isFinalTask = isVerifyModeActive(state) || isVerificationTaskType;
  const isCurrentErrorTask = currentTask ? isErrorTask(currentTask) : false;

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📍 [executeRouter] Current Task Info:`);
  console.log(`   Task: ${currentTask?.name || 'none'}`);
  console.log(`   Type: ${currentTask?.type || 'none'}`);
  console.log(`   Priority: ${currentTask?.priority || 'none'}`);
  console.log(`   isFinalTask: ${isFinalTask}`);
  console.log(`   isErrorTask: ${isCurrentErrorTask}`);
  console.log(`   response.done: ${response.done}`);
  console.log(`   response.toolCalls: ${response.toolCalls?.length || 0}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  
  // Safety Net A: Check recursion limit for final task
  if (isFinalTask && state.recursionLimit && state.recursionCount) {
    const remaining = state.recursionLimit - state.recursionCount;

    if (remaining < 50) {
      console.warn(`⚠️  [Router] Final task recursion limit approaching (${state.recursionCount}/${state.recursionLimit})`);
      console.warn(`   🚨 Forcing checkTaskStatus regardless of LLM response`);

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
  // complete (Session.isComplete() === false). The retired
  // `madeFileChanges` short-circuit is documented in
  // `tasks/_shared/verify/hooks/router.ts`.
  //
  // The router mutates two channels on the apply→reverify transition:
  //   - `_nextPlanEntry = 'reverify'` for the plan node entry path
  //   - `markVerifyEntered(state)` for self-verify tasks crossing the
  //     phase boundary (verification tasks are already in verify-mode
  //     from initSession; the helper is idempotent).
  // All downstream resets (`violations`, conversations, counters) live
  // in `handleReverifyEntry` per R1.
  if (response.done) {
    const hookNext = hooksIfActive(state)?.router?.routeAfterDone?.(state);
    if (hookNext === 'plan') {
      console.log(`\n🎯 [Router] ✅ FIXES APPLIED → plan (reverify, via task hook)\n`);
      state._nextPlanEntry = 'reverify';
      // Phase mode signal — first transition flips the channel; subsequent
      // reverify cycles re-call the helper which is a no-op. Self-verify
      // task's apply phase ends here on the first done; verification task
      // already had _verifyEntered=true from initSession.
      if (requiresVerification(currentTask)) {
        markVerifyEntered(state);
      }
      return 'plan';
    }
    if (hookNext) {
      console.log(`\n🎯 [Router] ✅ task hook → ${hookNext}\n`);
      return hookNext;
    }
    console.log(`\n🎯 [Router] ✅ TASK DONE → checkTaskStatus\n`);
    return 'checkTaskStatus';
  }
  
  // 3. 그 외 → execute 노드 (재추론 - 드물지만 가능)
  console.log(`🔄 [Router] Continue reasoning → execute node`);
  return 'execute';
}

