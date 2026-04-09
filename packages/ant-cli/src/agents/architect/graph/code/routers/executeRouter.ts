/**
 * Execute Router - execute 응답 분석해서 다음 노드 결정
 *
 * 책임:
 * - llmResponse 분석
 * - 다음 노드 결정 (tool / checkTaskStatus / execute)
 *
 * 라우팅 로직:
 * 0. File errors 있으면 → checkTaskStatus (바로 self-healing, tool 불필요)
 * 1. Tool calls 있으면 → tool 노드
 * 2. Done이면 → verification은 plan 재검증, 그 외 checkTaskStatus
 * 3. 그 외 → execute 노드 (재추론)
 *
 * Safety Nets:
 * A. Final task approaching recursion limit → Force checkTaskStatus
 * B. Repeated tool failures detected → Force checkTaskStatus
 */

import { ArchitectGraphState } from '../state';
import type { CodeTask } from '../../../types/task';
import { isFinalVerificationTask } from '../utils/taskClassification';

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
  const isFinalTask = currentTask ? isFinalVerificationTask(currentTask) : false;
  const isErrorTask = currentTask?.type === 'error';
  
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📍 [executeRouter] Current Task Info:`);
  console.log(`   Task: ${currentTask?.name || 'none'}`);
  console.log(`   Type: ${currentTask?.type || 'none'}`);
  console.log(`   Priority: ${currentTask?.priority || 'none'}`);
  console.log(`   isFinalTask: ${isFinalTask}`);
  console.log(`   isErrorTask: ${isErrorTask}`);
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
        import('../../../../../core/utils/executionLogger').then(({ getExecutionLogger }) => {
          const execLogger = getExecutionLogger({
            featurePath: state.context!.featurePath!,
            jobId: state._httpJobId!,
            jobType: 'code',
          });
          execLogger.logRecursionBudgetWarning(_taskId, {
            taskName: currentTask?.name || 'unknown',
            current: state.recursionCount!,
            limit: state.recursionLimit!,
            remaining,
            forcedNode: 'checkTaskStatus',
          }).catch(() => {});
          if (!response.done && _lastText) {
            execLogger.logExecuteInterrupted(_taskId, {
              taskName: currentTask?.name || 'unknown',
              callIndex: state._executeCallIndex || 0,
              lastResponseSnippet: _lastText.slice(0, 200),
              reason: 'recursion_limit',
            }).catch(() => {});
          }
        }).catch(() => {});
      }

      return 'checkTaskStatus';
    }
  }
  
  // Safety Net B: Check for repeated tool failures
  if (isFinalTask || isErrorTask) {
    const recentFailures = detectRecentToolFailures(state);
    
    if (recentFailures >= 5) {
      console.warn(`⚠️  [Router] ${recentFailures} recent tool failures detected`);
      console.warn(`   🚨 Forcing checkTaskStatus`);
      return 'checkTaskStatus';
    }
  }
  
  // Safety Net D: Pre-planned error task execute call budget
  // Pre-planned tasks have a focused scope from batch splitting, so they get a bounded budget.
  const isPrePlannedTask = !!(currentTask as CodeTask)?.prePlanText;
  if (isPrePlannedTask) {
    const callIndex = state._executeCallIndex || 0;
    const maxPrePlannedCalls = 25;
    const warningThreshold = Math.floor(maxPrePlannedCalls * 0.8); // 20
    if (callIndex >= maxPrePlannedCalls) {
      console.warn(`⚠️  [Router] Pre-planned error task execute call limit reached (${callIndex}/${maxPrePlannedCalls})`);
      console.warn(`   🚨 Forcing checkTaskStatus to evaluate the task`);
      return 'checkTaskStatus';
    }
    if (callIndex === warningThreshold) {
      console.warn(`⚠️  [Router] Pre-planned error task approaching execute limit (${callIndex}/${maxPrePlannedCalls}) — ${maxPrePlannedCalls - callIndex} calls remaining`);
    }
  }

  // Safety Net E: Feature/general task execute call budget
  // Budget is computed from planText (create×1 + modify×3) when available, otherwise defaults to 20
  if (!isFinalTask && !isErrorTask) {
    const callIndex = state._executeCallIndex || 0;
    const maxFeatureCalls = state._executeBudget ?? 20;
    const warningThreshold = Math.floor(maxFeatureCalls * 0.8);
    if (callIndex >= maxFeatureCalls) {
      console.warn(`⚠️  [Router] Feature task execute call limit reached (${callIndex}/${maxFeatureCalls}${state._executeBudget ? ' [plan-computed]' : ''})`);
      console.warn(`   🚨 Forcing checkTaskStatus to evaluate the task`);
      return 'checkTaskStatus';
    }
    if (callIndex === warningThreshold) {
      console.warn(`⚠️  [Router] Feature task approaching execute limit (${callIndex}/${maxFeatureCalls}) — ${maxFeatureCalls - callIndex} calls remaining`);
    }
  }

  // Safety Net C: Final task without progress (computed by execute node, read-only here)
  // Verification tasks use threshold=1 by default. When planText is present (inline fix),
  // threshold=2 allows recovery from a thinking-only first call: the second call runs
  // with enableThinking=false (isAfterToolCall=true) and produces actual tool calls.
  const finalTaskLoopCount = state._finalTaskLoopCount || 0;
  const loopThreshold = currentTask?.type === 'verification'
    ? (state.planText ? 2 : 1)
    : 3;
  if (finalTaskLoopCount >= loopThreshold) {
    console.warn(`⚠️  [Router] Task stuck in loop (${finalTaskLoopCount}/${loopThreshold} iterations, no tools, no done)`);
    console.warn(`   🚨 Forcing checkTaskStatus to break the loop`);
    return 'checkTaskStatus';
  }
  
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
  
  // 2. Done이면 → verification은 plan 재검증, 그 외는 checkTaskStatus
  if (response.done) {
    // Verification tasks: route back to plan for final build/test check.
    // verify/base.md states: "The diagnostic phase will re-verify after your changes."
    if (currentTask?.type === 'verification') {
      const hasPlan = !!state.planText?.trim();
      const madeFileChanges = state._executeModifiedFiles === true;

      if (hasPlan && !madeFileChanges) {
        console.warn(`⚠️  [Router] Execute signaled done but made no file changes despite non-empty plan → checkTaskStatus`);
        return 'checkTaskStatus';
      }

      console.log(`\n🎯 [Router] ✅ FIXES APPLIED → plan (final build/test verification)\n`);
      state._planEntryReason = 'reverify';
      state._executeModifiedFiles = false;
      state.violations = [];
      return 'plan';
    }
    console.log(`\n🎯 [Router] ✅ TASK DONE → checkTaskStatus\n`);
    return 'checkTaskStatus';
  }
  
  // 3. 그 외 → execute 노드 (재추론 - 드물지만 가능)
  console.log(`🔄 [Router] Continue reasoning → execute node`);
  return 'execute';
}

