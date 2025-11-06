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
  devServerSSE: Map<string, Set<Response>>;
  broadcastDevServerStatus: (projectId: string) => void;
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
        // Broadcast server stopped
        deps.broadcastDevServerStatus(projectId);
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
  
  // SSE stream for dev server status
  router.get('/projects/:id/dev/stream', (req: Request, res: Response) => {
    const projectId = req.params.id;
    
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    
    // Add client to SSE map
    if (!deps.devServerSSE.has(projectId)) {
      deps.devServerSSE.set(projectId, new Set());
    }
    deps.devServerSSE.get(projectId)!.add(res);
    
    
    // Send initial status
    const status = deps.devServerService.getDevServerStatus(projectId);
    const logs = deps.devServerService.getDevServerLogs(projectId);
    
    const fullStatus = {
      running: status.running,
      port: status.port || null,
      url: status.port ? `http://localhost:${status.port}` : null,
      logs: logs.slice(-50)
    };
    
    res.write(`data: ${JSON.stringify(fullStatus)}\n\n`);
    
    // Handle client disconnect
    req.on('close', () => {
      const clients = deps.devServerSSE.get(projectId);
      if (clients) {
        clients.delete(res);
        if (clients.size === 0) {
          deps.devServerSSE.delete(projectId);
        }
      }
    });
  });
  
  return router;
}

