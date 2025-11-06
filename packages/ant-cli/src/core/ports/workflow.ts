/**
 * Workflow State Update Port
 * 
 * LangGraph 노드 실행 상태를 실시간으로 업데이트하기 위한 포트
 */

export interface WorkflowStateUpdatePort {
  /**
   * Job 시작 알림
   */
  startJob(jobId: string): void;
  
  /**
   * 노드 진입 알림
   */
  enterNode(jobId: string, nodeId: string): void;
  
  /**
   * 노드 이탈 알림
   */
  exitNode(jobId: string, nodeId: string): void;
  
  /**
   * Actor 상호작용 시작
   */
  startActorInteraction(jobId: string, actorId: string): void;
  
  /**
   * Actor 상호작용 종료
   */
  endActorInteraction(jobId: string, actorId: string): void;
  
  /**
   * Job 종료 알림
   */
  endJob(jobId: string): void;
}

