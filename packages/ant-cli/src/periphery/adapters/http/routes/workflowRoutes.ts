/**
 * Workflow Routes
 * 
 * LangGraph 시각화를 위한 API 엔드포인트
 * 
 * Endpoints:
 * - GET /api/agents/:agent/jobs/:job/graph-metadata - 그래프 메타데이터 조회
 * - GET /api/jobs/:jobId/workflow/stream - 실시간 상태 스트림 (Phase 2)
 */

import { Router, Request, Response } from 'express';
import { GraphMetadataService } from '../services/GraphMetadataService';
import { WorkflowStateService } from '../services/WorkflowStateService';

export function createWorkflowRoutes(deps: {
  graphMetadataService: GraphMetadataService;
  workflowStateService: WorkflowStateService;
}): Router {
  const router = Router();
  
  /**
   * GET /api/agents/:agent/jobs/:job/graph-metadata
   * 
   * Agent-Job 조합에 대한 LangGraph 메타데이터 반환
   * 
   * Parameters:
   * - agent: string (예: 'architect')
   * - job: string (예: 'code', 'design', 'learn')
   * 
   * Response:
   * - 200: WorkflowGraphMetadata
   * - 404: Agent or job not found
   * - 500: Internal error
   */
  router.get('/agents/:agent/jobs/:job/graph-metadata', async (req: Request, res: Response) => {
    try {
      const { agent, job } = req.params;
      
      
      const metadata = await deps.graphMetadataService.extractGraphMetadata(agent, job);
      
      if (!metadata.nodes || metadata.nodes.length === 0) {
        res.status(404).json({
          error: 'Graph metadata not found',
          message: `No graph metadata available for agent '${agent}' and job '${job}'`
        });
        return;
      }
      
      res.json(metadata);
    } catch (error: any) {
      console.error('[WorkflowRoutes] Error fetching graph metadata:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  });
  
  /**
   * GET /api/jobs/:jobId/workflow/state
   * 
   * Job의 워크플로우 상태 조회 (REST API)
   * 
   * Parameters:
   * - jobId: string (Job ID)
   * 
   * Response:
   * - 200: WorkflowRealtimeState
   * - 404: Job state not found
   */
  router.get('/jobs/:jobId/workflow/state', (req: Request, res: Response) => {
    const { jobId } = req.params;
    
    
    const state = deps.workflowStateService.getState(jobId);
    
    if (!state) {
      res.status(404).json({
        error: 'Workflow state not found',
        message: `No workflow state available for job '${jobId}'`
      });
      return;
    }
    
    // Set을 Array로 변환하여 JSON 직렬화
    const serializedState = {
      ...state,
      activeActors: Array.from(state.activeActors)
    };
    
    res.json(serializedState);
  });
  
  /**
   * GET /api/jobs/:jobId/workflow/stream
   * 
   * 실시간 워크플로우 상태 스트림 (SSE)
   * 
   * Parameters:
   * - jobId: string (실행 중인 Job ID)
   * 
   * Response:
   * - text/event-stream
   */
  router.get('/jobs/:jobId/workflow/stream', (req: Request, res: Response) => {
    const { jobId } = req.params;
    
    console.log(`\n🔌 [WorkflowRoutes] GET /jobs/${jobId}/workflow/stream - Client connecting...`);
    
    // SSE 헤더 설정
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Nginx 버퍼링 방지
    
    console.log(`   ✅ SSE headers set`);
    
    // 클라이언트 등록 (현재 상태 즉시 전송 포함)
    console.log(`   📡 Calling workflowStateService.addClient...`);
    deps.workflowStateService.addClient(jobId, res);
    console.log(`   ✅ Client registered`);
    
    // Keep-alive ping (30초마다)
    const pingInterval = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch (err) {
        clearInterval(pingInterval);
      }
    }, 30000);
    
    // 연결 종료시 정리
    req.on('close', () => {
      clearInterval(pingInterval);
    });
  });
  
  /**
   * POST /api/jobs/:jobId/workflow/update
   * 
   * 워크플로우 상태 업데이트 (자식 프로세스에서 호출)
   * 
   * Parameters:
   * - jobId: string (Job ID)
   * 
   * Body:
   * - action: 'enterNode' | 'exitNode' | 'startActor' | 'endActor' | 'endJob'
   * - nodeId?: string (for enterNode/exitNode)
   * - actorId?: string (for startActor/endActor)
   * 
   * Response:
   * - 200: { success: true }
   * - 400: { error: 'Invalid action' }
   */
  router.post('/jobs/:jobId/workflow/update', (req: Request, res: Response) => {
    const { jobId } = req.params;
    const { action, nodeId, actorId, taskInfo, llmInfo } = req.body;
    
    try {
      switch (action) {
        case 'enterNode':
          if (!nodeId) {
            res.status(400).json({ error: 'nodeId required for enterNode' });
            return;
          }
          deps.workflowStateService.enterNode(jobId, nodeId, taskInfo, llmInfo);
          break;
        
        case 'exitNode':
          if (!nodeId) {
            res.status(400).json({ error: 'nodeId required for exitNode' });
            return;
          }
          deps.workflowStateService.exitNode(jobId, nodeId);
          break;
        
        case 'startActor':
          if (!actorId) {
            res.status(400).json({ error: 'actorId required for startActor' });
            return;
          }
          deps.workflowStateService.startActorInteraction(jobId, actorId);
          break;
        
        case 'endActor':
          if (!actorId) {
            res.status(400).json({ error: 'actorId required for endActor' });
            return;
          }
          deps.workflowStateService.endActorInteraction(jobId, actorId);
          break;
        
        case 'endJob':
          deps.workflowStateService.endJob(jobId);
          break;
        
        default:
          res.status(400).json({ error: 'Invalid action' });
          return;
      }
      
      res.json({ success: true });
    } catch (error: any) {
      console.error('[WorkflowRoutes] Error updating workflow state:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  });
  
  return router;
}

