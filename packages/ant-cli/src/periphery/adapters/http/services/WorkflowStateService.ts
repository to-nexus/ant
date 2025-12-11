/**
 * WorkflowStateService
 * 
 * LangGraph 실행 중 실시간 워크플로우 상태 관리
 * 
 * 책임:
 * - 현재 활성 노드 추적
 * - 노드 전환 기록
 * - SSE로 상태 브로드캐스트
 */

import { Response } from 'express';
import type { SSEService } from './SSEService';

export interface NodeHistoryEntry {
  nodeId: string;
  enteredAt: string;
  exitedAt?: string;
  duration?: number;  // ms
}

export interface TaskInfo {
  id?: string;
  name: string;
  type?: string;
  description?: string;
  priority?: number;
}

export interface LLMInfo {
  provider: string;   // 'anthropic' | 'openai'
  model: string;      // 실제 모델명 (e.g., 'claude-haiku-4-5', 'gpt-4o')
}

/**
 * 노드별 이모지 매핑
 */
function getNodeEmoji(nodeId: string): string {
  const emojiMap: Record<string, string> = {
    'resolve': '🔍',
    'decompose': '🧩',
    'plan': '📋',
    'execute': '⚡',
    'codeGen': '💻',      // ✅ NEW: Code generation with LLM
    'tool': '🔧',         // ✅ NEW: Tool execution
    'writeFiles': '📝',
    'validate': '✓',
    'installDeps': '📦',
    'runtimeValidate': '🔨',
    'enforce': '🔄',
    'checkTaskStatus': '✅',
    'learn': '🎓'
  };
  return emojiMap[nodeId] || '🔵';
}

export interface WorkflowRealtimeState {
  jobId: string;
  currentNode: string | null;
  previousNode: string | null;
  currentTask: TaskInfo | null;  // ✅ 현재 실행 중인 태스크
  llmInfo: LLMInfo | null;       // ✅ 실제 사용 중인 LLM 정보
  startedAt: string;
  endedAt?: string;  // Job 종료 시간
  isCompleted: boolean;  // Job 완료 여부
  nodeHistory: NodeHistoryEntry[];
  activeActors: Set<string>;  // 현재 통신 중인 Actor IDs
  
  // ✅ Recursion tracking (for UI progress display)
  recursionCount?: number;
  recursionLimit?: number;
  
  // ✅ Kanban info (piggybacked on workflow SSE for atomic updates)
  kanbanCurrentTask?: TaskInfo | null;  // In-progress task for Kanban
  kanbanUpdate?: boolean;  // Flag to indicate Kanban should update
}

export class WorkflowStateService {
  // jobId → WorkflowRealtimeState
  private states: Map<string, WorkflowRealtimeState> = new Map();
  
  // SSEService for broadcasting
  private sseService?: SSEService;
  
  constructor(sseService?: SSEService) {
    this.sseService = sseService;
  }
  
  /**
   * Job 시작 (초기 상태 생성)
   */
  startJob(jobId: string, llmInfo?: LLMInfo): void {
    console.log(`\n🚀 [WorkflowStateService] startJob called for ${jobId}`);
    if (llmInfo) {
      console.log(`   🤖 LLM: ${llmInfo.provider} / ${llmInfo.model}`);
    }
    
    this.states.set(jobId, {
      jobId,
      currentNode: null,
      previousNode: null,
      currentTask: null,  // ✅ Initialize task info
      llmInfo: llmInfo || null,  // ✅ Store actual LLM info
      startedAt: new Date().toISOString(),
      isCompleted: false,
      nodeHistory: [],
      activeActors: new Set()
    });
    
    console.log(`   ✅ Initial state created`);
  }
  
  /**
   * LLM 정보 업데이트 (첫 번째 노드 진입시)
   */
  updateLLMInfo(jobId: string, llmInfo: LLMInfo): void {
    const state = this.states.get(jobId);
    if (state && !state.llmInfo) {
      console.log(`\n🤖 [WorkflowStateService] Updating LLM info for ${jobId}:`, llmInfo);
      state.llmInfo = llmInfo;
      this.broadcast(jobId);
    }
  }
  
  /**
   * 노드 진입 기록
   * ✅ Returns Promise to ensure broadcast completes before caller continues
   */
  async enterNode(jobId: string, nodeId: string, taskInfo?: TaskInfo, llmInfo?: LLMInfo, recursionCount?: number, recursionLimit?: number): Promise<void> {
    const state = this.states.get(jobId);
    if (!state) {
      this.startJob(jobId);
      return this.enterNode(jobId, nodeId, taskInfo, llmInfo, recursionCount, recursionLimit);
    }
    
    // ✅ Update current task if provided
    if (taskInfo) {
      state.currentTask = taskInfo;
    }
    
    // ✅ Update LLM info if provided (첫 번째 노드에서만)
    if (llmInfo && !state.llmInfo) {
      state.llmInfo = llmInfo;
    }
    
    // ✅ Update recursion tracking if provided
    if (recursionCount !== undefined) {
      state.recursionCount = recursionCount;
    }
    if (recursionLimit !== undefined) {
      state.recursionLimit = recursionLimit;
    }
    
    // 이전 노드 종료 처리
    if (state.currentNode) {
      const lastEntry = state.nodeHistory[state.nodeHistory.length - 1];
      if (lastEntry && !lastEntry.exitedAt) {
        const exitTime = new Date().toISOString();
        lastEntry.exitedAt = exitTime;
        lastEntry.duration = new Date(exitTime).getTime() - new Date(lastEntry.enteredAt).getTime();
      }
    }
    
    // 새 노드 진입
    state.previousNode = state.currentNode;
    state.currentNode = nodeId;
    const enteredAt = new Date().toISOString();
    state.nodeHistory.push({
      nodeId,
      enteredAt
    });
    
    // ✅ 간결한 노드 전환 로그 (stdout으로 전송)
    const time = new Date(enteredAt).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const nodeEmoji = getNodeEmoji(nodeId);
    let logMsg = `${nodeEmoji} ${nodeId}`;
    if (taskInfo) {
      logMsg += ` → ${taskInfo.name}`;
    }
    console.log(logMsg);
    
    // ✅ CRITICAL: Broadcast synchronously (writes to buffer)
    // TCP guarantees order, so this SSE will arrive before any subsequent SSE
    this.broadcast(jobId);
    
    // ✅ Add small delay to ensure buffer is flushed
    // This guarantees workflow SSE is sent before caller continues
    await new Promise(resolve => setImmediate(resolve));
  }
  
  /**
   * 노드 이탈 기록
   */
  exitNode(jobId: string, nodeId: string): void {
    const state = this.states.get(jobId);
    if (!state) return;
    
    
    // 현재 노드의 히스토리 엔트리 찾아서 종료 시간 기록
    const lastEntry = state.nodeHistory[state.nodeHistory.length - 1];
    if (lastEntry && lastEntry.nodeId === nodeId && !lastEntry.exitedAt) {
      const exitTime = new Date().toISOString();
      lastEntry.exitedAt = exitTime;
      lastEntry.duration = new Date(exitTime).getTime() - new Date(lastEntry.enteredAt).getTime();
    }
    
    // 브로드캐스트
    this.broadcast(jobId);
  }
  
  /**
   * Actor 상호작용 시작
   */
  startActorInteraction(jobId: string, actorId: string): void {
    const state = this.states.get(jobId);
    if (!state) return;
    
    state.activeActors.add(actorId);
    this.broadcast(jobId);
  }
  
  /**
   * Actor 상호작용 종료
   */
  endActorInteraction(jobId: string, actorId: string): void {
    const state = this.states.get(jobId);
    if (!state) return;
    
    state.activeActors.delete(actorId);
    this.broadcast(jobId);
  }
  
  /**
   * Job 종료 (상태 보존)
   */
  endJob(jobId: string): void {
    // 마지막 노드 종료 처리
    const state = this.states.get(jobId);
    if (state) {
      if (state.currentNode) {
        this.exitNode(jobId, state.currentNode);
      }
      
      // 종료 상태로 마킹 (상태는 삭제하지 않고 보존)
      state.isCompleted = true;
      state.endedAt = new Date().toISOString();
      state.currentNode = null;  // 더 이상 활성 노드 없음
      state.activeActors.clear();  // 모든 Actor 통신 종료
    }
    
    // 최종 브로드캐스트 (종료 알림)
    this.broadcast(jobId);
    
    // Send 'end' event to SSE clients via SSEService
    if (this.sseService) {
      this.sseService.sendWorkflowEndEvent(jobId);
    }
    
    // 상태는 삭제하지 않고 보존 (UI에서 마지막 상태 조회 가능)
    // 메모리 관리를 위해 주기적으로 오래된 상태는 정리될 수 있음
  }
  
  /**
   * Get initial workflow state (called when SSE client connects)
   */
  getInitialState(jobId: string): WorkflowRealtimeState | null {
    const state = this.states.get(jobId);
    if (!state) {
      console.log(`   ⚠️ No state found for job ${jobId}`);
      return null;
    }
    
    // Return serialized state (convert Set to Array)
    return {
      ...state,
      activeActors: new Set(state.activeActors) // Clone Set
    };
  }
  
  /**
   * 현재 상태 조회
   */
  getState(jobId: string): WorkflowRealtimeState | null {
    return this.states.get(jobId) || null;
  }
  
  /**
   * 상태를 모든 클라이언트에 브로드캐스트 (SSEService 사용)
   */
  private broadcast(jobId: string): void {
    const state = this.states.get(jobId);
    if (!state) {
      return;
    }
    
    if (!this.sseService) {
      console.warn(`   ⚠️ [WorkflowStateService] SSEService not available, skipping broadcast`);
      return;
    }
    
    // Set을 Array로 변환하여 JSON 직렬화 가능하게
    const serializedState = {
      ...state,
      activeActors: Array.from(state.activeActors)
    };
    
    this.sseService.broadcastWorkflow(jobId, serializedState);
  }
}

