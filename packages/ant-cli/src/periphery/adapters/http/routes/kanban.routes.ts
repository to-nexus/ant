import { Router, Request, Response } from 'express';
import { KanbanService } from '../services/KanbanService';
import { UserContext } from '../../../../core/types/user';
import { extractUserContext } from './helpers/userContext';

/**
 * Kanban board routes
 * Handles Kanban data and SSE streaming for real-time updates
 */
export function createKanbanRoutes(deps: {
  kanbanService: KanbanService;
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
      // ✅ Resolve userContext consistently (query + header + auth)
      const userContext: UserContext = extractUserContext(req);
      
      const kanbanData = await deps.kanbanService.getKanbanData(
        projectId,
        featureName,
        job,  // ✅ Pass job type
        deps.jobToProject,
        deps.jobs,
        deps.taskQueueSnapshots,
        userContext  // ✅ Pass userContext
      );
      res.json(kanbanData);
    } catch (error: any) {
      console.error(`[Kanban API] Error:`, error);
      res.status(500).json({ error: error.message });
    }
  });
  
  return router;
}
