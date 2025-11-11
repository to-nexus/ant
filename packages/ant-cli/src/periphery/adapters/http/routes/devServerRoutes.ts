import { Router, Request, Response } from 'express';
import { LogEntry } from '../../../../core/ports/http';
import { DevServerService } from '../services/DevServerService';
import { ProjectService } from '../services/ProjectService';

/**
 * Dev server routes
 * Handles development server management (start, stop, status, logs)
 */
export function createDevServerRoutes(deps: {
  projectService: ProjectService;
  devServerService: DevServerService;
}): Router {
  const router = Router();
  
  // Start dev server for a project
  router.post('/projects/:id/dev/start', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const config = await deps.projectService.getProjectConfig(projectId);
      
      if (!config?.localPath) {
        res.status(400).json({ error: 'Project localPath not configured' });
        return;
      }
      
      // Resolve local path
      const localPath = deps.projectService.resolveLocalPath(config.localPath);
      
      // Start dev server
      const result = await deps.devServerService.startDevServer(projectId, localPath);
      
      if (result.success) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // Stop dev server
  router.post('/projects/:id/dev/stop', (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const result = deps.devServerService.stopDevServer(projectId);
      
      if (result.success) {
        res.json(result);
      } else {
        res.status(404).json(result);
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // Get dev server status
  router.get('/projects/:id/dev/status', (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const status = deps.devServerService.getDevServerStatus(projectId);
      const logs = deps.devServerService.getDevServerLogs(projectId);
      
      const fullStatus = {
        running: status.running,
        port: status.port || null,
        url: status.port ? `http://localhost:${status.port}` : null,
        logs: logs.slice(-50) // Last 50 logs
      };
      
      
      res.json(fullStatus);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // SSE stream for dev server status (deprecated)
  router.get('/projects/:id/dev/stream', (req: Request, res: Response) => {
    res.status(410).json({ 
      error: 'Endpoint deprecated',
      message: 'Dev server SSE is no longer supported'
    });
  });
  
  return router;
}

