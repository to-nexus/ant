import { Router, Request, Response } from 'express';
import { KanbanService } from '../services/KanbanService';

/**
 * Kanban board routes
 * Handles Kanban data and SSE streaming for real-time updates
 */
export function createKanbanRoutes(deps: {
  kanbanService: KanbanService;
  kanbanSSE: Map<string, Set<Response>>;
  jobToProject: Map<string, { projectId: string; featureName: string }>;
  jobs: Map<string, any>;
  taskQueueSnapshots: Map<string, any>;
  watchSessionFile: (jobId: string, projectId: string, featureName: string, task: string) => void;
}): Router {
  const router = Router();
  
  // Get Kanban board data for a specific feature
  router.get('/projects/:id/features/:feature/kanban', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const featureName = req.params.feature;
      const job = (req.query.job as 'design' | 'code' | 'learn') || 'code';  // ✅ Get job from query param
      
      const kanbanData = await deps.kanbanService.getKanbanData(
        projectId,
        featureName,
        job,  // ✅ Pass job type
        deps.jobToProject,
        deps.jobs,
        deps.taskQueueSnapshots
      );
      res.json(kanbanData);
    } catch (error: any) {
      console.error(`[Kanban API] Error:`, error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // ⚠️ DEPRECATED: Redirect to unified SSE endpoint
  router.get('/projects/:id/features/:feature/kanban/stream', (req: Request, res: Response) => {
    res.status(410).json({ 
      error: 'Endpoint deprecated',
      message: 'Use /projects/:id/features/:feature/stream instead',
      newEndpoint: `/projects/${req.params.id}/features/${req.params.feature}/stream`
    });
  });
  
  return router;
}
