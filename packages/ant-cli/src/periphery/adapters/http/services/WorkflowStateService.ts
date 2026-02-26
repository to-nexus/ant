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

// Re-export types
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
    
    // Child process (WorkflowBroadcaster) already completed and sent end event
    if (!state || state.isCompleted) {
      logger.debug(`Workflow already completed, skipping duplicate endJob`, {
        component: 'WorkflowStateService', jobId
      });
      return;
    }
    
    // Close all unclosed history entries
    if (state.activeNodes && state.activeNodes.length > 0 && state.nodeHistory.length > 0) {
      const exitTime = new Date().toISOString();
      for (const entry of state.nodeHistory) {
        if (typeof entry === 'object' && !entry.exitedAt) {
          entry.exitedAt = exitTime;
          entry.duration = new Date(exitTime).getTime() - new Date(entry.enteredAt).getTime();
        }
      }
    }
    
    state.isCompleted = true;
    state.endedAt = new Date().toISOString();
    state.activeNodes = [];
    state.activeActors = [];
    
    // Save to Redis without Pub/Sub — the explicit end event below is the only broadcast
    if (this.stateStore) {
      await this.stateStore.setWorkflowStateSilent(jobId, state);
    }
    
    // Fallback end event (only reaches here if child process didn't send one)
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
  
}
