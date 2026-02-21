/**
 * Plan Router - Plan 노드 이후 분기
 *
 * - Plan이 툴 호출을 남긴 경우 (_planExploring + llmResponse.toolCalls) → tool
 * - 그 외 (planText 생성 완료) → codeGen
 */

import { ArchitectGraphState } from '../state';

export function routeAfterPlan(state: ArchitectGraphState): string {
  const exploring = state._planExploring === true;
  const hasToolCalls = (state.llmResponse?.toolCalls?.length ?? 0) > 0;

  if (exploring && hasToolCalls) {
    console.log(`🔧 [routeAfterPlan] Plan exploring → tool (${state.llmResponse!.toolCalls!.length} tool call(s))`);
    return 'tool';
  }
  console.log(`📋 [routeAfterPlan] Plan done → codeGen`);
  return 'codeGen';
}
