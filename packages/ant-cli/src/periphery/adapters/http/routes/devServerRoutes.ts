import { Router, Request, Response } from 'express';
import { LogEntry } from '../../../../core/ports/http';

/**
 * Dev server routes
 * Handles development server management (start, stop, status, logs)
 */
export function createDevServerRoutes(deps: {
  getProjectConfig: (projectId: string) => Promise<any>;
  resolveLocalPath: (localPath: string) => string;
  startDevServer: (projectId: string, localPath: string) => Promise<any>;
  stopDevServer: (projectId: string) => any;
  getDevServerStatus: (projectId: string) => any;
  devServerSSE: Map<string, Set<Response>>;
  broadcastDevServerStatus: (projectId: string) => void;
}): Router {
  const router = Router();
  
  // Start dev server for a project
  router.post('/projects/:id/dev/start', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const config = await deps.getProjectConfig(projectId);
      
      if (!config?.localPath) {
        res.status(400).json({ error: 'Project localPath not configured' });
        return;
      }
      
      // Resolve local path
      const localPath = deps.resolveLocalPath(config.localPath);
      
      // Start dev server
      const result = await deps.startDevServer(projectId, localPath);
      
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
      const result = deps.stopDevServer(projectId);
      
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
      const status = deps.getDevServerStatus(projectId);
      
      console.log(`[DevServer] Status check for ${projectId}: running=${status.running}, port=${status.port}`);
      
      res.json(status);
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
    
    console.log(`[DevServer] SSE client connected for ${projectId}`);
    
    // Send initial status
    const status = deps.getDevServerStatus(projectId);
    res.write(`data: ${JSON.stringify(status)}\n\n`);
    
    // Handle client disconnect
    req.on('close', () => {
      console.log(`[DevServer] SSE client disconnected for ${projectId}`);
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

