import { LogEntry } from '@/types/api';

/**
 * 로그 카테고리 분류
 */
export enum LogCategory {
  // LLM 관련
  LLM_THINKING = 'llm_thinking',
  LLM_RESPONSE = 'llm_response',
  LLM_CODE_GENERATION = 'llm_code',
  
  // 시스템
  TASK_STATUS = 'task_status',
  VALIDATION = 'validation',
  WORKFLOW_STATE = 'workflow_state',
  PROGRESS = 'progress',
  SYSTEM_INFO = 'system_info',
  
  // 실행
  COMMAND_EXECUTION = 'command_exec',
  BUILD_OUTPUT = 'build_output',
  ERROR = 'error',
  
  // 기타
  OTHER = 'other'
}

/**
 * 로그 메시지를 분석하여 카테고리 결정
 */
export function categorizeLog(log: LogEntry): LogCategory {
  const msg = log.message;
  
  // LLM THINKING 섹션
  if (msg.includes('=== THINKING ===') || msg.includes('=== END THINKING ===')) {
    return LogCategory.LLM_THINKING;
  }
  
  // LLM RESPONSE 섹션
  if (msg.includes('=== RESPONSE ===') || msg.includes('## RESPONSE') || msg.includes('## END RESPONSE')) {
    return LogCategory.LLM_RESPONSE;
  }
  
  // LLM CODE 생성 (파일 섹션)
  if (msg.includes('=== FILE:') || msg.includes('=== END FILE ===')) {
    return LogCategory.LLM_CODE_GENERATION;
  }
  
  // PROGRESS (프롬프트 빌드 시간, 타이머 등)
  if (msg.includes('⏱️') || msg.includes('Prompt build time') || msg.includes('Starting timer')) {
    return LogCategory.PROGRESS;
  }
  
  // WORKFLOW_STATE (노드 진입 등)
  if (msg.includes('[WorkflowStateService]') || msg.includes('enterNode') || msg.includes('Checking workflow')) {
    return LogCategory.WORKFLOW_STATE;
  }
  
  // TASK_STATUS
  if (msg.includes('🚀 Starting') || msg.includes('📊 Progress') || msg.includes('📋 Current Task')) {
    return LogCategory.TASK_STATUS;
  }
  
  // VALIDATION
  if (msg.includes('✅') && (msg.includes('validation') || msg.includes('succeeded') || msg.includes('passed'))) {
    return LogCategory.VALIDATION;
  }
  
  // COMMAND_EXECUTION
  if (msg.includes('💻 Executing') || msg.includes('Running command')) {
    return LogCategory.COMMAND_EXECUTION;
  }
  
  // BUILD_OUTPUT
  if (msg.includes('npm run build') || msg.includes('> vite build') || msg.includes('tsc --noEmit')) {
    return LogCategory.BUILD_OUTPUT;
  }
  
  // ERROR
  if (log.type === 'error' || log.type === 'stderr' || msg.includes('❌') || msg.includes('Error:')) {
    return LogCategory.ERROR;
  }
  
  return LogCategory.OTHER;
}

/**
 * 터미널 UI에 표시할 로그를 필터링 및 변환
 * 
 * 목적: 워크플로 추적 + 디버깅
 * 
 * 필터링 규칙:
 * - LLM_THINKING: "🧠 Analyzing..." 한 줄로 대체
 * - LLM_RESPONSE: "💬 Responding..." 한 줄로 대체 (내용 생략)
 * - LLM_CODE_GENERATION: 파일명만 표시 (코드 생략)
 * - PROGRESS: 생략
 * - WORKFLOW_STATE: 생략
 * - TASK_STATUS: 표시 (노드 상태 추적용)
 * - VALIDATION: 표시 (빌드/검증 결과)
 * - COMMAND_EXECUTION: 표시 (명령어 실행)
 * - ERROR: 표시 (에러 디버깅)
 * - 파일 작업: 표시
 */
export function filterLogsForTerminal(logs: LogEntry[]): LogEntry[] {
  const filtered: LogEntry[] = [];
  let inThinkingBlock = false;
  let inCodeBlock = false;
  let inResponseBlock = false;
  
  for (let i = 0; i < logs.length; i++) {
    const log = logs[i];
    const category = categorizeLog(log);
    const msg = log.message;
    
    // === THINKING === 블록
    if (msg.includes('=== THINKING ===')) {
      inThinkingBlock = true;
      filtered.push({
        ...log,
        message: '🧠 Analyzing...'
      });
      continue;
    }
    
    if (msg.includes('=== END THINKING ===')) {
      inThinkingBlock = false;
      continue;
    }
    
    if (inThinkingBlock) {
      continue;
    }
    
    // === RESPONSE === 블록: 내용 생략, "Responding..." 한 줄만
    if (msg.includes('=== RESPONSE ===') || msg.includes('## RESPONSE')) {
      inResponseBlock = true;
      filtered.push({
        ...log,
        message: '💬 Responding...'
      });
      continue;
    }
    
    if (msg.includes('=== END RESPONSE ===') || msg.includes('## END RESPONSE')) {
      inResponseBlock = false;
      continue;
    }
    
    if (inResponseBlock) {
      continue; // RESPONSE 내용 모두 생략
    }
    
    // === FILE: xxx === 블록: 파일명만 표시
    if (msg.includes('=== FILE:')) {
      inCodeBlock = true;
      const match = msg.match(/=== FILE:\s*(.+?)\s*===/);
      const fileName = match ? match[1] : 'unknown';
      filtered.push({
        ...log,
        message: `📝 Writing: ${fileName}`
      });
      continue;
    }
    
    if (msg.includes('=== END FILE ===')) {
      inCodeBlock = false;
      continue;
    }
    
    if (inCodeBlock) {
      continue; // 코드 내용 모두 생략
    }
    
    // PROGRESS 로그 생략
    if (category === LogCategory.PROGRESS) {
      continue;
    }
    
    // WORKFLOW_STATE 로그 생략
    if (category === LogCategory.WORKFLOW_STATE) {
      continue;
    }
    
    // 나머지는 전부 표시 (Task 상태, 파일 작업, 명령, 에러 등)
    filtered.push(log);
  }
  
  return filtered;
}

