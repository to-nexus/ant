/**
 * WorkflowStateService
 * 
 * LangGraph 실행 중 실시간 워크플로우 상태 관리
 * 
 * Cloud-safe: Redis StateStore 기반으로 Cross-Pod 상태 공유
 * 
 * 책임:
 * - 현재 활성 노드 추적
 * - 노드 전환 기록
 * - SSE로 상태 브로드캐스트
 */

import { Response } from 'express';
import type { StateStorePort, WorkflowRealtimeState, TaskInfo, LLMInfo, NodeHistoryEntry } from '../../../../core/ports/stateStore';
import { getRealtimeWorkflowChannel } from '../../../../infrastructure/state';
import { logger } from '../../../../utils/logger';

// Re-export types for backward compatibility
export type { WorkflowRealtimeState, TaskInfo, LLMInfo, NodeHistoryEntry };

/**
 * 노드별 이모지 매핑
 */
function getNodeEmoji(nodeId: string): string {
  const emojiMap: Record<string, string> = {
    'resolve': '🔍',
    'decompose': '🧩',
    'plan': '📋',
    'execute': '⚡',
    'codeGen': '💻',
    'tool': '🔧',
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

export class WorkflowStateService {
  // StateStore for Redis-based state (Cloud mode)
  private stateStore?: StateStorePort;
  
  constructor(stateStore?: StateStorePort) {
    this.stateStore = stateStore;
  }
  
  /**
   * Setup StateStore for Redis-based state management
   */
  setStateStore(stateStore: StateStorePort): void {
    this.stateStore = stateStore;
  }
  
  /**
   * Job 시작 (초기 상태 생성)
   */
  async startJob(jobId: string, llmInfo?: LLMInfo): Promise<void> {
    logger.debug(`startJob`, { component: 'WorkflowStateService', jobId }, llmInfo);
    
    const state: WorkflowRealtimeState = {
      jobId,
      currentNode: null,
      previousNode: null,
      currentTask: null,
      llmInfo: llmInfo || null,
      startedAt: new Date().toISOString(),
      isCompleted: false,
      nodeHistory: [],
      activeActors: []
    };
    
    if (this.stateStore) {
      await this.stateStore.setWorkflowState(jobId, state);
    }
    
    logger.debug(`Initial state created`, { component: 'WorkflowStateService', jobId });
  }
  
  /**
   * LLM 정보 업데이트 (첫 번째 노드 진입시)
   */
  async updateLLMInfo(jobId: string, llmInfo: LLMInfo): Promise<void> {
    const state = await this.getStateInternal(jobId);
    if (state && !state.llmInfo) {
      logger.debug(`Updating LLM info`, { component: 'WorkflowStateService', jobId }, llmInfo);
      state.llmInfo = llmInfo;
      await this.saveAndBroadcast(jobId, state);
    }
  }
  
  /**
   * 노드 진입 기록
   */
  async enterNode(jobId: string, nodeId: string, taskInfo?: TaskInfo, llmInfo?: LLMInfo, recursionCount?: number, recursionLimit?: number): Promise<void> {
    let state = await this.getStateInternal(jobId);
    if (!state) {
      await this.startJob(jobId);
      return this.enterNode(jobId, nodeId, taskInfo, llmInfo, recursionCount, recursionLimit);
    }
    
    // Update current task if provided
    if (taskInfo) {
      state.currentTask = taskInfo;
    }
    
    // Update LLM info if provided (첫 번째 노드에서만)
    if (llmInfo && !state.llmInfo) {
      state.llmInfo = llmInfo;
    }
    
    // Update recursion tracking if provided
    if (recursionCount !== undefined) {
      state.recursionCount = recursionCount;
    }
    if (recursionLimit !== undefined) {
      state.recursionLimit = recursionLimit;
    }
    
    // 이전 노드 종료 처리
    if (state.currentNode && state.nodeHistory.length > 0) {
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
    
    logger.debug(`Node enter: ${nodeId}${taskInfo ? ` -> ${taskInfo.name}` : ''}`, { component: 'WorkflowStateService', jobId });
    
    await this.saveAndBroadcast(jobId, state);
    
    // Small delay to ensure buffer is flushed
    await new Promise(resolve => setImmediate(resolve));
  }
  
  /**
   * 노드 이탈 기록
   */
  async exitNode(jobId: string, nodeId: string): Promise<void> {
    const state = await this.getStateInternal(jobId);
    if (!state) return;
    
    // 현재 노드의 히스토리 엔트리 찾아서 종료 시간 기록
    if (state.nodeHistory.length > 0) {
      const lastEntry = state.nodeHistory[state.nodeHistory.length - 1];
      if (lastEntry && lastEntry.nodeId === nodeId && !lastEntry.exitedAt) {
        const exitTime = new Date().toISOString();
        lastEntry.exitedAt = exitTime;
        lastEntry.duration = new Date(exitTime).getTime() - new Date(lastEntry.enteredAt).getTime();
      }
    }
    
    await this.saveAndBroadcast(jobId, state);
  }
  
  /**
   * Actor 상호작용 시작
   */
  async startActorInteraction(jobId: string, actorId: string): Promise<void> {
    const state = await this.getStateInternal(jobId);
    if (!state) return;
    
    if (!state.activeActors.includes(actorId)) {
      state.activeActors.push(actorId);
      await this.saveAndBroadcast(jobId, state);
    }
  }
  
  /**
   * Actor 상호작용 종료
   */
  async endActorInteraction(jobId: string, actorId: string): Promise<void> {
    const state = await this.getStateInternal(jobId);
    if (!state) return;
    
    state.activeActors = state.activeActors.filter(a => a !== actorId);
    await this.saveAndBroadcast(jobId, state);
  }
  
  /**
   * Job 종료 (상태 보존)
   */
  async endJob(jobId: string): Promise<void> {
    const state = await this.getStateInternal(jobId);
    if (state) {
      // 마지막 노드 종료 처리
      if (state.currentNode && state.nodeHistory.length > 0) {
        const lastEntry = state.nodeHistory[state.nodeHistory.length - 1];
        if (lastEntry && !lastEntry.exitedAt) {
          const exitTime = new Date().toISOString();
          lastEntry.exitedAt = exitTime;
          lastEntry.duration = new Date(exitTime).getTime() - new Date(lastEntry.enteredAt).getTime();
        }
      }
      
      // 종료 상태로 마킹
      state.isCompleted = true;
      state.endedAt = new Date().toISOString();
      state.currentNode = null;
      state.activeActors = [];
      
      await this.saveAndBroadcast(jobId, state);
    }
    
    // Send 'end' event to user-scoped SSE channel via Redis Pub/Sub
    if (this.stateStore) {
      const mapping = await this.stateStore.getJobMapping(jobId);
      if (mapping?.userContext?.organizationId && mapping?.userContext?.userId) {
        const channel = getRealtimeWorkflowChannel(mapping.userContext.organizationId, mapping.userContext.userId);
        await this.stateStore.publish(channel, { jobId, data: { jobId }, isEndEvent: true, userContext: mapping.userContext });
      } else {
        logger.warn(`Cannot send workflow end event without userContext`, {
          component: 'WorkflowStateService',
          jobId
        });
      }
    }
  }
  
  /**
   * Get initial workflow state (called when SSE client connects)
   */
  async getInitialState(jobId: string): Promise<WorkflowRealtimeState | null> {
    return this.getStateInternal(jobId);
  }
  
  /**
   * 현재 상태 조회
   */
  async getState(jobId: string): Promise<WorkflowRealtimeState | null> {
    return this.getStateInternal(jobId);
  }
  
  /**
   * Internal: Get state from StateStore
   */
  private async getStateInternal(jobId: string): Promise<WorkflowRealtimeState | null> {
    if (this.stateStore) {
      return this.stateStore.getWorkflowState(jobId);
    }
    return null;
  }
  
  /**
   * Save state and broadcast via StateStore (which publishes to Redis)
   */
  private async saveAndBroadcast(jobId: string, state: WorkflowRealtimeState): Promise<void> {
    if (this.stateStore) {
      // setWorkflowState internally publishes to sse:workflow channel
      await this.stateStore.setWorkflowState(jobId, state);
    }
  }
}
