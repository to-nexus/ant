/**
 * Workflow State Update Port
 * 
 * LangGraph 노드 실행 상태를 실시간으로 업데이트하기 위한 포트
 */

// TaskInfo is shared between BE and FE (canonical source: @ant/shared)
export type { TaskInfo } from '@ant/shared';
import type { TaskInfo } from '@ant/shared';

/** LLM provider/model info (BE-only) */
export interface LLMInfo {
  provider: string;  // 'anthropic' | 'openai'
  model: string;     // 실제 모델명
}

export interface WorkflowStateUpdatePort {
  /**
   * Job 시작 알림
   */
  startJob(jobId: string, llmInfo?: LLMInfo): void;
  
  /**
   * 노드 진입 알림
   * @param workerId - Worker identifier (0 for sequential mode, N for parallel workers)
   * ✅ Returns Promise to ensure SSE is sent before continuing
   */
  enterNode(jobId: string, nodeId: string, workerId: number, taskInfo?: TaskInfo, llmInfo?: LLMInfo, recursionCount?: number, recursionLimit?: number): Promise<void>;
  
  /**
   * 노드 이탈 알림
   * @param workerId - Worker identifier (0 for sequential mode, N for parallel workers)
   * Returns void or Promise<void> — callers may await for ordering guarantees
   */
  exitNode(jobId: string, nodeId: string, workerId: number): void | Promise<void>;
  
  /**
   * Actor 상호작용 시작
   */
  startActorInteraction(jobId: string, actorId: string): void;
  
  /**
   * Actor 상호작용 종료
   */
  endActorInteraction(jobId: string, actorId: string): void;
  
  /**
   * Clear stale worker entries after parallel orchestrator completes.
   * Workers' last node stays in activeWorkers until explicitly cleared.
   * Called between parallel orchestrator completion and the main graph's learn node.
   */
  clearWorkers?(jobId: string, workerIds?: number[]): void | Promise<void>;

  /**
   * Job 종료 알림
   */
  endJob(jobId: string): void;
}
