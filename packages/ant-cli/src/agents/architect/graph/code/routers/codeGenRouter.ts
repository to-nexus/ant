/**
 * CodeGen Router - CodeGen 응답 분석해서 다음 노드 결정
 * 
 * 책임:
 * - llmResponse 분석
 * - 다음 노드 결정 (tool / validate / codeGen)
 * 
 * 라우팅 로직:
 * 1. Tool calls 있으면 → tool 노드
 * 2. Done이면 → validate 노드
 * 3. 그 외 → codeGen 노드 (재추론)
 */

import { ArchitectGraphState } from '../state';

export function routeAfterCodeGen(state: ArchitectGraphState): string {
  const response = state.llmResponse;
  
  if (!response) {
    console.log('⚠️  [Router] No LLM response, ending');
    return '__end__';
  }
  
  // ✅ 1. Tool calls 있으면 → tool 노드
  if (response.toolCalls && response.toolCalls.length > 0) {
    console.log(`🔧 [Router] ${response.toolCalls.length} tool call(s) detected → tool node`);
    return 'tool';
  }
  
  // ✅ 2. Done이면 → validate 노드 (tool이 이미 파일 저장함!)
  if (response.done) {
    console.log(`✅ [Router] LLM done → validate node (files already saved by tool node)`);
    return 'validate';
  }
  
  // ✅ 3. 그 외 → codeGen 노드 (재추론 - 드물지만 가능)
  console.log(`🔄 [Router] Continue reasoning → codeGen node`);
  return 'codeGen';
}

