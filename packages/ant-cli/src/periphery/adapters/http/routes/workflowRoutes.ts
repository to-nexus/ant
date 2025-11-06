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

export function createWorkflowRoutes(deps: {
  graphMetadataService: GraphMetadataService;
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
      
      console.log(`[WorkflowRoutes] Fetching graph metadata for ${agent}/${job}`);
      
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
   * GET /api/jobs/:jobId/workflow/stream
   * 
   * 실시간 워크플로우 상태 스트림 (SSE)
   * 
   * Phase 2에서 구현 예정
   * 
   * Parameters:
   * - jobId: string (실행 중인 Job ID)
   * 
   * Response:
   * - text/event-stream
   * - 404: Job not found
   */
  router.get('/jobs/:jobId/workflow/stream', (req: Request, res: Response) => {
    const { jobId } = req.params;
    
    // Phase 2: SSE 구현
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    console.log(`[WorkflowRoutes] SSE stream requested for job ${jobId} (Phase 2 - not implemented yet)`);
    
    // 현재는 빈 스트림 반환
    res.write(': Phase 2 - Real-time state stream not implemented yet\n\n');
    
    req.on('close', () => {
      console.log(`[WorkflowRoutes] SSE connection closed for job ${jobId}`);
      res.end();
    });
  });
  
  return router;
}

