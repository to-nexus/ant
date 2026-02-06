/**
 * WorkflowStateService
 * 
 * Server-side workflow state management (READ + cleanup).
 * 
 * Responsibilities:
 * - Read workflow state from Redis (for SSE initial state, REST API)
 * - Finalize workflow state on job cleanup (endJob)
 * - Broadcast end event via Redis Pub/Sub
 * 
 * Note: Workflow state is primarily WRITTEN by WorkflowBroadcaster (Job Worker child process).
 * This service reads what WorkflowBroadcaster has written and handles cleanup/finalization.
 * Both use the same canonical WorkflowRealtimeState type from core/ports/stateStore.ts.
 */

import type { StateStorePort, WorkflowRealtimeState, TaskInfo, LLMInfo, NodeHistoryEntry } from '../../../../core/ports/stateStore';
import { getRealtimeWorkflowChannel } from '../../../../infrastructure/state';
import { logger } from '../../../../utils/logger';

// Re-export types for backward compatibility
export type { WorkflowRealtimeState, TaskInfo, LLMInfo, NodeHistoryEntry };

export class WorkflowStateService {
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
   * Job 종료 (cleanup에서 호출)
   * 
   * WorkflowBroadcaster가 쓴 상태를 읽고 종료 처리 후 end event를 브로드캐스트합니다.
   */
  async endJob(jobId: string): Promise<void> {
    const state = await this.getStateInternal(jobId);
    if (state) {
      // 마지막 노드 종료 처리
      if (state.currentNode && state.nodeHistory.length > 0) {
        const lastEntry = state.nodeHistory[state.nodeHistory.length - 1];
        // Defensive: 배포 과도기에 string 형식 데이터가 Redis에 남아있을 수 있음
        if (lastEntry && typeof lastEntry === 'object' && !lastEntry.exitedAt) {
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
      
      await this.saveState(jobId, state);
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
   * 현재 상태 조회 (REST API)
   */
  async getState(jobId: string): Promise<WorkflowRealtimeState | null> {
    return this.getStateInternal(jobId);
  }
  
  /**
   * Internal: Get state from Redis
   */
  private async getStateInternal(jobId: string): Promise<WorkflowRealtimeState | null> {
    if (this.stateStore) {
      return this.stateStore.getWorkflowState(jobId);
    }
    return null;
  }
  
  /**
   * Internal: Save state to Redis (and broadcast via StateStore)
   */
  private async saveState(jobId: string, state: WorkflowRealtimeState): Promise<void> {
    if (this.stateStore) {
      await this.stateStore.setWorkflowState(jobId, state);
    }
  }
}
