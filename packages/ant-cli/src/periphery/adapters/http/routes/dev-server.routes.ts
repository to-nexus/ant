import { Router, Request, Response } from 'express';
import { LogEntry } from '../../../../core/ports/http';
import { DevServerService } from '../services/DevServerService';
import { ProjectService } from '../services/ProjectService';
import { extractUserContext } from './helpers/userContext';
import { WorkspaceResolver } from '../../../../infrastructure/workspace/WorkspaceResolver';
import * as path from 'path';
import * as os from 'os';
import * as net from 'net';

/**
 * Find an available port starting from the given port
 */
async function findAvailablePort(startPort: number = 5173): Promise<number> {
  const isPortAvailable = (port: number): Promise<boolean> => {
    return new Promise((resolve) => {
      const server = net.createServer();
      
      server.once('error', () => {
        resolve(false);
      });
      
      server.once('listening', () => {
        server.close();
        resolve(true);
      });
      
      server.listen(port);
    });
  };
  
  // Try up to 10 ports
  for (let port = startPort; port < startPort + 10; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  
  // If all ports in range are taken, return a random high port
  return startPort + Math.floor(Math.random() * 1000) + 10;
}

/**
 * Dev server routes
 * Handles development server management (start, stop, status, logs)
 */
export function createDevServerRoutes(deps: {
  projectService: ProjectService;
  devServerService: DevServerService;
  workspaceResolver: WorkspaceResolver;  // ✅ Add WorkspaceResolver for Cloud mode
}): Router {
  const router = Router();
  
  // Start dev server for a project
  router.post('/projects/:id/dev/start', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const userContext = extractUserContext(req);
      const config = await deps.projectService.getProjectConfig(projectId, userContext);
      
      // ✅ Get port from request body (optional)
      const port = req.body?.port;
      // ✅ Get feature from request body (default: 'main')
      const feature = req.body?.feature || 'main';
      
      if (port !== undefined) {
        console.log(`[DevServer] Requested port: ${port}`);
      }
      console.log(`[DevServer] Feature: ${feature}`);
      
      // ✅ Determine codebase path based on repoType
      let codebasePath: string;
      
      if (config?.repoType === 'cloud') {
        // ✅ Cloud Mode: Use WorkspaceResolver to calculate path
        // Path structure: workspaces/{org}/{user}/{project}/codebase
        const projectPath = deps.workspaceResolver.getProjectPath(userContext, projectId);
        codebasePath = path.join(projectPath, 'codebase');
        
        console.log(`[DevServer] Cloud mode - calculated codebase path: ${codebasePath}`);
      } else {
        // ✅ Local Mode: Use localPath from config
        if (!config?.localPath) {
          res.status(400).json({ error: 'Project localPath not configured' });
          return;
        }
        
        // Resolve local path (handle ~ expansion)
        codebasePath = config.localPath.startsWith('~') 
          ? path.join(os.homedir(), config.localPath.slice(1))
          : path.resolve(config.localPath);
        
        console.log(`[DevServer] Local mode - using config localPath: ${codebasePath}`);
      }
      
      // ✅ Start dev server with multi-tenancy support
      const result = await deps.devServerService.startDevServer(
        userContext.organizationId,
        userContext.userId,
        projectId,
        feature,
        codebasePath,
        port
      );
      
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
  router.post('/projects/:id/dev/stop', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const userContext = extractUserContext(req);
      const feature = req.body?.feature || 'main';
      
      const result = await deps.devServerService.stopDevServer(
        userContext.organizationId,
        userContext.userId,
        projectId,
        feature
      );
      
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
      const userContext = extractUserContext(req);
      const feature = (req.query.feature as string) || 'main';
      
      const status = deps.devServerService.getDevServerStatus(
        userContext.organizationId,
        userContext.userId,
        projectId,
        feature
      );
      const logs = deps.devServerService.getDevServerLogs(
        userContext.organizationId,
        userContext.userId,
        projectId,
        feature
      );
      
      const fullStatus = {
        running: status.running,  // ✅ Changed from status.isRunning
        port: status.port || null,
        url: status.url || null,
        processCount: status.processCount || 0,
        logs: logs.slice(-50) // Last 50 logs
      };
      
      res.json(fullStatus);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // SSE stream for dev server logs
  router.get('/projects/:id/dev/logs', (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const userContext = extractUserContext(req);
      const feature = (req.query.feature as string) || 'main';
      
      deps.devServerService.streamDevServerLogs(
        userContext.organizationId,
        userContext.userId,
        projectId,
        feature,
        res
      );
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // Deprecated SSE endpoint
  router.get('/projects/:id/dev/stream', (req: Request, res: Response) => {
    res.status(410).json({ 
      error: 'Endpoint deprecated',
      message: 'Use /projects/:id/dev/logs instead'
    });
  });
  
  return router;
}

