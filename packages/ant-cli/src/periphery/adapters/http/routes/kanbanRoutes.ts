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
  watchSessionFile: (jobId: string, projectId: string, featureName: string) => void;
}): Router {
  const router = Router();
  
  // Get Kanban board data for a specific feature
  router.get('/projects/:id/features/:feature/kanban', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const featureName = req.params.feature;
      
      const kanbanData = await deps.kanbanService.getKanbanData(
        projectId,
        featureName,
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
  
  // SSE stream for Kanban board updates
  router.get('/projects/:id/features/:feature/kanban/stream', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    const featureName = req.params.feature;
    const key = `${projectId}/${featureName}`;
    
    // Check if there's an active task for this project/feature
    const activeTaskId = Array.from(deps.jobToProject.entries())
      .find(([_, mapping]) => 
        mapping.projectId === projectId && mapping.featureName === featureName
      )?.[0];
    
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    
    // Add client to SSE map
    if (!deps.kanbanSSE.has(key)) {
      deps.kanbanSSE.set(key, new Set());
    }
    deps.kanbanSSE.get(key)!.add(res);
    
    if (activeTaskId) {
    } else {
      // Start watching session file even when no task is running
      deps.watchSessionFile('', projectId, featureName);
    }
    
    // Send initial data
    try {
      const initialData = await deps.kanbanService.getKanbanData(
        projectId,
        featureName,
        deps.jobToProject,
        deps.jobs,
        deps.taskQueueSnapshots
      );
      res.write(`data: ${JSON.stringify(initialData)}\n\n`);
    } catch (error) {
      console.error(`[Kanban SSE] Error sending initial data:`, error);
    }
    
    // Handle client disconnect
    req.on('close', () => {
      const clients = deps.kanbanSSE.get(key);
      if (clients) {
        clients.delete(res);
        if (clients.size === 0) {
          deps.kanbanSSE.delete(key);
          // Session watcher will auto-stop when no SSE clients
        }
      }
    });
  });
  
  return router;
}
