/**
 * CodeGen Router - CodeGen 응답 분석해서 다음 노드 결정
 * 
 * 책임:
 * - llmResponse 분석
 * - 다음 노드 결정 (tool / checkTaskStatus / installDeps / codeGen)
 * 
 * 라우팅 로직:
 * 0. File errors 있으면 → checkTaskStatus (바로 self-healing, tool 불필요)
 * 1. Tool calls 있으면 → tool 노드
 * 2. Done이면:
 *    - Final task (priority=1000) → installDeps → runtimeValidate
 *    - Error task (type=error) → installDeps → runtimeValidate
 *    - Feature task → checkTaskStatus (validation skip)
 * 3. 그 외 → codeGen 노드 (재추론)
 * 
 * Safety Nets:
 * A. Final task approaching recursion limit → Force validation
 * B. Repeated tool failures detected → Force validation
 */

import { ArchitectGraphState, TASK_PRIORITIES } from '../state';
import { isVerificationTask, isFinalVerificationTask } from '../utils/taskClassification';

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

export function routeAfterCodeGen(state: ArchitectGraphState): string {
  const response = state.llmResponse;
  
  if (!response) {
    console.log('⚠️  [Router] No LLM response, ending');
    return '__end__';
  }
  
  const currentTask = state.currentTask;
  const isFinalTask = currentTask ? isFinalVerificationTask(currentTask) : false;
  const isVerifyTask = currentTask?.type === 'verification';
  const isErrorTask = currentTask?.type === 'error';
  
  // ✅ DEBUG: Log task info
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📍 [codeGenRouter] Current Task Info:`);
  console.log(`   Task: ${currentTask?.name || 'none'}`);
  console.log(`   Type: ${currentTask?.type || 'none'}`);
  console.log(`   Priority: ${currentTask?.priority || 'none'}`);
  console.log(`   isFinalTask: ${isFinalTask}`);
  console.log(`   isVerifyTask: ${isVerifyTask}`);
  console.log(`   isErrorTask: ${isErrorTask}`);
  console.log(`   response.done: ${response.done}`);
  console.log(`   response.toolCalls: ${response.toolCalls?.length || 0}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  
  // ✅ Safety Net A: Check recursion limit for final task
  if (isFinalTask && state.recursionLimit && state.recursionCount) {
    const remaining = state.recursionLimit - state.recursionCount;
    
    if (remaining < 50) {
      console.warn(`⚠️  [Router] Final task recursion limit approaching (${state.recursionCount}/${state.recursionLimit})`);
      console.warn(`   🚨 Forcing validation regardless of LLM response`);
      return 'installDeps';
    }
  }
  
  // ✅ Safety Net B: Check for repeated tool failures
  if (isFinalTask || isErrorTask) {
    const recentFailures = detectRecentToolFailures(state);
    
    if (recentFailures >= 5) {
      console.warn(`⚠️  [Router] ${recentFailures} recent tool failures detected`);
      console.warn(`   🚨 Forcing validation to create proper violations`);
      return 'installDeps';
    }
  }
  
  // ✅ Safety Net D: Verification task codeGen call budget
  if (isVerifyTask) {
    const callIndex = state._codeGenCallIndex || 0;
    const maxVerificationCalls = 15;
    if (callIndex >= maxVerificationCalls) {
      console.warn(`⚠️  [Router] Verification codeGen call limit reached (${callIndex}/${maxVerificationCalls})`);
      console.warn(`   🚨 Forcing validation to prevent runaway loop`);
      return 'installDeps';
    }
  }

  // ✅ Safety Net E: Feature/general task codeGen call budget
  // Without this, a feature task can spin until the graph-wide recursion limit (100),
  // consuming hundreds of thousands of tokens before being killed.
  if (!isFinalTask && !isVerifyTask && !isErrorTask) {
    const callIndex = state._codeGenCallIndex || 0;
    const maxFeatureCalls = 20;
    const warningThreshold = Math.floor(maxFeatureCalls * 0.8); // 16
    if (callIndex >= maxFeatureCalls) {
      console.warn(`⚠️  [Router] Feature task codeGen call limit reached (${callIndex}/${maxFeatureCalls})`);
      console.warn(`   🚨 Forcing checkTaskStatus to complete the task`);
      return 'checkTaskStatus';
    }
    if (callIndex === warningThreshold) {
      console.warn(`⚠️  [Router] Feature task approaching codeGen limit (${callIndex}/${maxFeatureCalls}) — ${maxFeatureCalls - callIndex} calls remaining`);
    }
  }

  // ✅ Safety Net C: Final task without progress (no done, no tools, just looping)
  if (isFinalTask && !response.done && (!response.toolCalls || response.toolCalls.length === 0)) {
    // Count how many times we've been in this state
    const loopCount = (state as any)._finalTaskLoopCount || 0;
    (state as any)._finalTaskLoopCount = loopCount + 1;
    
    if (loopCount >= 3) {
      console.warn(`⚠️  [Router] Final task stuck in loop (${loopCount} iterations, no tools, no done)`);
      console.warn(`   🚨 Forcing validation to break the loop`);
      delete (state as any)._finalTaskLoopCount;  // Reset counter
      return 'installDeps';
    }
  }
  
  // ✅ 0. File errors 있으면 → checkTaskStatus (tool 실행 불필요, 바로 self-healing)
  if (state.fileErrors && state.fileErrors.length > 0) {
    console.log(`⚠️  [Router] ${state.fileErrors.length} file error(s) detected → checkTaskStatus (skip tool execution)`);
    return 'checkTaskStatus';
  }

  // ✅ 1. Tool calls 있으면 → tool 노드
  if (response.toolCalls && response.toolCalls.length > 0) {
    console.log(`🔧 [Router] ${response.toolCalls.length} tool call(s) detected → tool node`);
    return 'tool';
  }
  
  // ✅ 2. Done이면 → priority & task type 기반 분기
  if (response.done) {
    if (isFinalTask || isVerifyTask) {
      console.log(`\n🎯 [Router] ✅ VERIFICATION TASK DONE → installDeps (will lead to runtimeValidate)`);
      console.log(`   Expected flow: codeGen → installDeps → runtimeValidate → checkTaskStatus\n`);
      return 'installDeps';
    } else if (isErrorTask) {
      console.log(`\n🎯 [Router] ✅ ERROR TASK DONE → installDeps (runtime validation for bug fix)\n`);
      return 'installDeps';
    } else {
      console.log(`\n🎯 [Router] ✅ FEATURE TASK DONE → checkTaskStatus (skip validation)\n`);
      return 'checkTaskStatus';
    }
  }
  
  // ✅ 3. 그 외 → codeGen 노드 (재추론 - 드물지만 가능)
  console.log(`🔄 [Router] Continue reasoning → codeGen node`);
  return 'codeGen';
}

