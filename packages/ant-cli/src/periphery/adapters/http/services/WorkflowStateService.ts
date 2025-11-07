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

export interface NodeHistoryEntry {
  nodeId: string;
  enteredAt: string;
  exitedAt?: string;
  duration?: number;  // ms
}

export interface WorkflowRealtimeState {
  jobId: string;
  currentNode: string | null;
  previousNode: string | null;
  startedAt: string;
  endedAt?: string;  // Job 종료 시간
  isCompleted: boolean;  // Job 완료 여부
  nodeHistory: NodeHistoryEntry[];
  activeActors: Set<string>;  // 현재 통신 중인 Actor IDs
}

export class WorkflowStateService {
  // jobId → WorkflowRealtimeState
  private states: Map<string, WorkflowRealtimeState> = new Map();
  
  // jobId → SSE Response clients
  private clients: Map<string, Set<Response>> = new Map();
  
  /**
   * Job 시작 (초기 상태 생성)
   */
  startJob(jobId: string): void {
    console.log(`\n🚀 [WorkflowStateService] startJob called for ${jobId}`);
    
    this.states.set(jobId, {
      jobId,
      currentNode: null,
      previousNode: null,
      startedAt: new Date().toISOString(),
      isCompleted: false,
      nodeHistory: [],
      activeActors: new Set()
    });
    
    console.log(`   ✅ Initial state created`);
  }
  
  /**
   * 노드 진입 기록
   */
  enterNode(jobId: string, nodeId: string): void {
    console.log(`\n🔵 [WorkflowStateService] enterNode: ${nodeId} (job: ${jobId})`);
    
    const state = this.states.get(jobId);
    if (!state) {
      console.warn(`   ⚠️ Job ${jobId} not found, creating...`);
      this.startJob(jobId);
      return this.enterNode(jobId, nodeId);
    }
    
    // 이전 노드 종료 처리
    if (state.currentNode) {
      const lastEntry = state.nodeHistory[state.nodeHistory.length - 1];
      if (lastEntry && !lastEntry.exitedAt) {
        const exitTime = new Date().toISOString();
        lastEntry.exitedAt = exitTime;
        lastEntry.duration = new Date(exitTime).getTime() - new Date(lastEntry.enteredAt).getTime();
        console.log(`   ⏹️  Closed previous node: ${state.currentNode} (${lastEntry.duration}ms)`);
      }
    }
    
    // 새 노드 진입
    state.previousNode = state.currentNode;
    state.currentNode = nodeId;
    state.nodeHistory.push({
      nodeId,
      enteredAt: new Date().toISOString()
    });
    
    console.log(`   ✅ Current node updated: ${nodeId}`);
    console.log(`   📊 Total clients: ${this.clients.get(jobId)?.size || 0}`);
    
    // 브로드캐스트
    this.broadcast(jobId);
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
    
    // 클라이언트 연결 종료
    const clients = this.clients.get(jobId);
    if (clients) {
      clients.forEach(res => {
        try {
          res.write('event: end\ndata: {}\n\n');
          res.end();
        } catch (err) {
          console.error(`[WorkflowStateService] Error closing SSE connection:`, err);
        }
      });
      this.clients.delete(jobId);
    }
    
    // 상태는 삭제하지 않고 보존 (UI에서 마지막 상태 조회 가능)
    // 메모리 관리를 위해 주기적으로 오래된 상태는 정리될 수 있음
  }
  
  /**
   * SSE 클라이언트 등록
   */
  addClient(jobId: string, res: Response): void {
    console.log(`\n📡 [WorkflowStateService] New SSE client for job ${jobId}`);
    
    if (!this.clients.has(jobId)) {
      this.clients.set(jobId, new Set());
    }
    this.clients.get(jobId)!.add(res);
    
    console.log(`   ✅ Client registered (total: ${this.clients.get(jobId)!.size})`);
    
    // 현재 상태 즉시 전송
    const state = this.states.get(jobId);
    if (state) {
      console.log(`   📤 Sending current state: ${state.currentNode || 'null'}`);
      this.sendToClient(res, state);
    } else {
      console.log(`   ⚠️ No state found for job ${jobId}`);
    }
    
    // 클라이언트 연결 종료 처리
    res.on('close', () => {
      console.log(`   🔌 Client disconnected from job ${jobId}`);
      const clients = this.clients.get(jobId);
      if (clients) {
        clients.delete(res);
        if (clients.size === 0) {
          this.clients.delete(jobId);
        }
      }
    });
  }
  
  /**
   * 현재 상태 조회
   */
  getState(jobId: string): WorkflowRealtimeState | null {
    return this.states.get(jobId) || null;
  }
  
  /**
   * 상태를 모든 클라이언트에 브로드캐스트
   */
  private broadcast(jobId: string): void {
    const state = this.states.get(jobId);
    if (!state) {
      console.log(`   ⚠️ [WorkflowStateService] No state to broadcast for job ${jobId}`);
      return;
    }
    
    const clients = this.clients.get(jobId);
    if (!clients || clients.size === 0) {
      console.log(`   ⚠️ [WorkflowStateService] No clients to broadcast to for job ${jobId}`);
      return;
    }
    
    console.log(`   📡 [WorkflowStateService] Broadcasting to ${clients.size} client(s)`);
    console.log(`      Current node: ${state.currentNode || 'null'}`);
    console.log(`      Active actors: ${state.activeActors.size}`);
    
    clients.forEach(res => {
      this.sendToClient(res, state);
    });
  }
  
  /**
   * 단일 클라이언트에 상태 전송
   */
  private sendToClient(res: Response, state: WorkflowRealtimeState): void {
    try {
      // Set을 Array로 변환하여 JSON 직렬화 가능하게
      const serializedState = {
        ...state,
        activeActors: Array.from(state.activeActors)
      };
      
      res.write(`data: ${JSON.stringify(serializedState)}\n\n`);
    } catch (err) {
      console.error(`[WorkflowStateService] Error sending state:`, err);
    }
  }
}

