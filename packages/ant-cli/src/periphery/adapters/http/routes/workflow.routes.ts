/**
 * Workflow Routes
 * 
 * LangGraph 시각화를 위한 API 엔드포인트
 * 
 * Endpoints:
 * - GET /api/agents/:agent/jobs/:job/graph-metadata - 그래프 메타데이터 조회
 * - GET /api/jobs/:jobId/workflow/state - 워크플로우 상태 조회
 * 
 * Note: Workflow state is written by WorkflowBroadcaster (Job Worker child process)
 * via direct Redis Pub/Sub. These routes only READ the state.
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
   */
  router.get('/jobs/:jobId/workflow/state', async (req: Request, res: Response) => {
    const { jobId } = req.params;
    
    const state = await deps.workflowStateService.getState(jobId);
    
    if (!state) {
      res.status(404).json({
        error: 'Workflow state not found',
        message: `No workflow state available for job '${jobId}'`
      });
      return;
    }
    
    res.json(state);
  });
  
  return router;
}
