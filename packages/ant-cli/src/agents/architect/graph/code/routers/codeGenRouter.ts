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
 *    - Final task (priority=1000) → installDeps 노드
 *    - Other tasks → checkTaskStatus 노드
 * 3. 그 외 → codeGen 노드 (재추론)
 */

import { ArchitectGraphState, TASK_PRIORITIES } from '../state';

export function routeAfterCodeGen(state: ArchitectGraphState): string {
  const response = state.llmResponse;
  
  if (!response) {
    console.log('⚠️  [Router] No LLM response, ending');
    return '__end__';
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
  
  // ✅ 2. Done이면 → priority 기반 분기
  if (response.done) {
    const currentTask = state.currentTask;
    const isFinalTask = currentTask?.priority === TASK_PRIORITIES.FINAL_VERIFICATION;
    
    if (isFinalTask) {
      console.log(`✅ [Router] Final task done → installDeps (build verification)`);
      return 'installDeps';
    } else {
      console.log(`✅ [Router] Task done → checkTaskStatus (skip validation for ${currentTask?.type} task)`);
      return 'checkTaskStatus';
    }
  }
  
  // ✅ 3. 그 외 → codeGen 노드 (재추론 - 드물지만 가능)
  console.log(`🔄 [Router] Continue reasoning → codeGen node`);
  return 'codeGen';
}

