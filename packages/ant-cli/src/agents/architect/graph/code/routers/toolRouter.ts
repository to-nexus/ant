/**
 * Tool Router - Tool 노드 이후 분기
 *
 * - Plan 탐색 중이었으면 (_planExploring) → plan (툴 결과 반영 후 계속)
 * - 그 외 (codeGen에서 온 경우) → codeGen
 */

import { ArchitectGraphState } from '../state';

export function routeAfterTool(state: ArchitectGraphState): string {
  if (state._planExploring === true) {
    console.log(`📋 [routeAfterTool] Plan exploring → back to plan (with tool results)`);
    return 'plan';
  }
  console.log(`💭 [routeAfterTool] CodeGen tool round → codeGen`);
  return 'codeGen';
}
