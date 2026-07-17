/**
 * Execute Router - execute 응답 분석해서 다음 노드 결정
 *
 * 책임:
 * - llmResponse 분석
 * - 다음 노드 결정 (tool / checkTaskStatus / execute)
 *
 * 라우팅 로직:
 * 1. Figma MCP 연결 끊김 / recursionLimit 임박 → checkTaskStatus
 * 2. Tool calls 있으면 → tool 노드
 * 3. Done이면 → checkTaskStatus
 * 4. 그 외 → execute 노드 (재추론)
 *
 * IMPORTANT: This router is READ-ONLY. `_noOutputCallCount` is calculated by
 * the execute node and returned through the LangGraph channel system. Routers
 * are conditional edge functions — their state mutations do NOT persist
 * through LangGraph channels. The historical `_callLimitReached` gate was
 * retired alongside the code job's Safety Net D/E; runaway is bounded by
 * LangGraph `recursionLimit` only.
 */

import { DesignGraphState } from '../state';

/** Router drain: divert to checkTaskStatus when this few super-steps remain. */
export const RECURSION_DRAIN_THRESHOLD = 30;
/**
 * No-output circuit breaker: divert to checkTaskStatus after this many
 * CONSECUTIVE execute turns produced no `<file>`. Bounds degenerate read-only
 * loops (heavy-bridging-onion: 375 turns / ~2.9M tokens) far below the
 * recursion cap. Set well above the execute node's advisory `hardWarnAt`
 * (7 / 10 / 14) so legitimate read-heavy exploration is untouched. When the
 * breaker diverts with zero output, the completion output-gate raises a
 * resumable `design_no_output` pause.
 */
export const NO_OUTPUT_HARD_CAP = 25;
/**
 * The execute node runs its forced-finalization turn (tools stripped, "emit
 * final output now") this many steps BEFORE the router drain, so the salvage
 * turn happens while the router still lets the response route normally.
 */
export const DRAIN_FINALIZE_MARGIN = 5;

export function routeAfterExecute(state: DesignGraphState): string {
  const response = state.llmResponse;

  if (!response) {
    console.log('⚠️  [ExecuteRouter] No LLM response → checkTaskStatus');
    return 'checkTaskStatus';
  }

  const callIndex = state._executeCallIndex || 0;
  const noOutputCount = state._noOutputCallCount || 0;

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📍 [ExecuteRouter] Routing Info:`);
  console.log(`   Task: ${state.currentTask?.name || 'none'}`);
  console.log(`   callIndex: ${callIndex}`);
  console.log(`   response.done: ${response.done}`);
  console.log(`   response.toolCalls: ${response.toolCalls?.length || 0}`);
  console.log(`   noOutputStreak: ${noOutputCount}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  if (state._figmaConnectionLost) {
    console.warn(`⚠️  [ExecuteRouter] Figma connection lost → checkTaskStatus`);
    return 'checkTaskStatus';
  }

  // Recursion limit approaching (read-only check)
  if (state.recursionLimit && state.recursionCount) {
    const remaining = state.recursionLimit - state.recursionCount;
    if (remaining < RECURSION_DRAIN_THRESHOLD) {
      console.warn(`⚠️  [ExecuteRouter] Recursion limit approaching (${state.recursionCount}/${state.recursionLimit}) → checkTaskStatus`);
      return 'checkTaskStatus';
    }
  }

  // No-output circuit breaker (read-only check). Abort a degenerate read-only
  // loop early — the drain-finalize salvage turn already had its one shot at
  // NO_OUTPUT_HARD_CAP - DRAIN_FINALIZE_MARGIN. Diverting with zero output
  // lands on the completion output-gate → resumable design_no_output pause.
  if (noOutputCount >= NO_OUTPUT_HARD_CAP) {
    console.warn(`⚠️  [ExecuteRouter] No-output circuit breaker (streak=${noOutputCount} ≥ ${NO_OUTPUT_HARD_CAP}) → checkTaskStatus`);
    return 'checkTaskStatus';
  }

  // 1. Tool calls → tool node
  if (response.toolCalls && response.toolCalls.length > 0) {
    console.log(`🔧 [ExecuteRouter] ${response.toolCalls.length} tool call(s) → tool node`);
    return 'tool';
  }

  // 2. Done → checkTaskStatus
  if (response.done) {
    console.log(`🎯 [ExecuteRouter] ✅ TASK DONE → checkTaskStatus`);
    return 'checkTaskStatus';
  }

  // 3. Otherwise → retry execute
  console.log(`🔄 [ExecuteRouter] Continue reasoning → execute node`);
  return 'execute';
}
