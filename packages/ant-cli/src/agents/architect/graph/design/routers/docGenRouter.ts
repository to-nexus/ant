/**
 * DocGen Router - docGen 응답 분석해서 다음 노드 결정
 * 
 * 책임:
 * - llmResponse 분석
 * - 다음 노드 결정 (tool / checkTaskStatus / docGen)
 * 
 * 라우팅 로직:
 * 1. Safety net triggered → checkTaskStatus
 * 2. Tool calls 있으면 → tool 노드
 * 3. Done이면 → checkTaskStatus
 * 4. 그 외 → docGen 노드 (재추론)
 * 
 * IMPORTANT: This router is READ-ONLY. All safety net state (_noOutputCallCount,
 * _callLimitReached) is calculated by the docGen node and returned through the
 * LangGraph channel system. Routers are conditional edge functions — their state
 * mutations do NOT persist through LangGraph channels.
 */

import { DesignGraphState } from '../state';

export function routeAfterDocGen(state: DesignGraphState): string {
  const response = state.llmResponse;

  if (!response) {
    console.log('⚠️  [DocGenRouter] No LLM response → checkTaskStatus');
    return 'checkTaskStatus';
  }

  const callIndex = state._docGenCallIndex || 0;
  const noOutputCount = state._noOutputCallCount || 0;

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📍 [DocGenRouter] Routing Info:`);
  console.log(`   Task: ${state.currentTask?.name || 'none'}`);
  console.log(`   callIndex: ${callIndex}`);
  console.log(`   response.done: ${response.done}`);
  console.log(`   response.toolCalls: ${response.toolCalls?.length || 0}`);
  console.log(`   noOutputStreak: ${noOutputCount}`);
  console.log(`   callLimitReached: ${state._callLimitReached || false}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  // Safety Net: call budget or non-productive loop (computed by docGen node)
  if (state._callLimitReached) {
    console.warn(`⚠️  [DocGenRouter] Safety net triggered → checkTaskStatus`);
    return 'checkTaskStatus';
  }

  // Recursion limit approaching (read-only check)
  if (state.recursionLimit && state.recursionCount) {
    const remaining = state.recursionLimit - state.recursionCount;
    if (remaining < 30) {
      console.warn(`⚠️  [DocGenRouter] Recursion limit approaching (${state.recursionCount}/${state.recursionLimit}) → checkTaskStatus`);
      return 'checkTaskStatus';
    }
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
