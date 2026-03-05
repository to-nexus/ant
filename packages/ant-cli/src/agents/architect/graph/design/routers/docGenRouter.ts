/**
 * DocGen Router - docGen 응답 분석해서 다음 노드 결정
 * 
 * 책임:
 * - llmResponse 분석
 * - 다음 노드 결정 (tool / checkTaskStatus / docGen)
 * 
 * 라우팅 로직:
 * 1. Tool calls 있으면 → tool 노드
 * 2. Done이면 → checkTaskStatus
 * 3. 그 외 → docGen 노드 (재추론)
 * 
 * Safety Nets:
 * A. Call budget exceeded → Force checkTaskStatus (_callLimitReached)
 * B. Recursion limit approaching → Force checkTaskStatus
 * C. Non-productive loop → Force checkTaskStatus (_callLimitReached)
 *    Consecutive calls with only tool reads and no file output
 */

import { DesignGraphState } from '../state';

const MAX_NO_OUTPUT_CALLS = 10;

export function routeAfterDocGen(state: DesignGraphState): string {
  const response = state.llmResponse;

  if (!response) {
    console.log('⚠️  [DocGenRouter] No LLM response → checkTaskStatus');
    return 'checkTaskStatus';
  }

  const callIndex = state._docGenCallIndex || 0;
  const envMaxCalls = parseInt(process.env.DOCGEN_MAX_CALLS || '', 10);
  const maxCalls = (!isNaN(envMaxCalls) && envMaxCalls >= 10) ? envMaxCalls : 40;

  // Track whether this call produced any file output
  const hasFileOutput = (state.files && state.files.length > 0);
  const hasToolCallsOnly = (response.toolCalls && response.toolCalls.length > 0) && !hasFileOutput;
  const noOutputCount = state._noOutputCallCount || 0;

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📍 [DocGenRouter] Routing Info:`);
  console.log(`   Task: ${state.currentTask?.name || 'none'}`);
  console.log(`   callIndex: ${callIndex}/${maxCalls}`);
  console.log(`   response.done: ${response.done}`);
  console.log(`   response.toolCalls: ${response.toolCalls?.length || 0}`);
  console.log(`   filesProduced: ${state.files?.length || 0}, noOutputStreak: ${noOutputCount}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  // Safety Net A: Call budget
  const warningThreshold = Math.floor(maxCalls * 0.8);
  if (callIndex >= maxCalls) {
    console.warn(`⚠️  [DocGenRouter] Call limit reached (${callIndex}/${maxCalls}) — forcing interruption`);
    state._callLimitReached = true;
    return 'checkTaskStatus';
  }
  if (callIndex === warningThreshold) {
    console.warn(`⚠️  [DocGenRouter] Approaching call limit (${callIndex}/${maxCalls}) — ${maxCalls - callIndex} calls remaining`);
  }

  // Safety Net B: Recursion limit approaching
  if (state.recursionLimit && state.recursionCount) {
    const remaining = state.recursionLimit - state.recursionCount;
    if (remaining < 30) {
      console.warn(`⚠️  [DocGenRouter] Recursion limit approaching (${state.recursionCount}/${state.recursionLimit}) — forcing completion`);
      return 'checkTaskStatus';
    }
  }

  // Safety Net C: Non-productive loop detection
  // If N consecutive calls produce only tool reads with no file output, the LLM
  // is stuck in a read-only loop and will never produce the document.
  if (hasToolCallsOnly && !response.done) {
    state._noOutputCallCount = noOutputCount + 1;
  } else if (hasFileOutput) {
    state._noOutputCallCount = 0;
  }

  if ((state._noOutputCallCount || 0) >= MAX_NO_OUTPUT_CALLS) {
    console.warn(
      `⚠️  [DocGenRouter] Non-productive loop detected: ${state._noOutputCallCount} consecutive tool-only calls ` +
      `with no file output — forcing failure`
    );
    state._callLimitReached = true;
    return 'checkTaskStatus';
  }

  // 1. Tool calls → tool node
  if (response.toolCalls && response.toolCalls.length > 0) {
    console.log(`🔧 [DocGenRouter] ${response.toolCalls.length} tool call(s) → tool node`);
    return 'tool';
  }

  // 2. Done → checkTaskStatus
  if (response.done) {
    console.log(`🎯 [DocGenRouter] ✅ TASK DONE → checkTaskStatus`);
    return 'checkTaskStatus';
  }

  // 3. Otherwise → retry docGen
  console.log(`🔄 [DocGenRouter] Continue reasoning → docGen node`);
  return 'docGen';
}
