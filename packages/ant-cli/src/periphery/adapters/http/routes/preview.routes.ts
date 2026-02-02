import { Router, Request, Response } from 'express';
import { LogEntry } from '../../../../core/ports/http';
import { PreviewService } from '../services/PreviewService';
import { ProjectService } from '../services/ProjectService';
import { extractUserContext } from './helpers/userContext';
import { WorkspaceResolver } from '../../../../infrastructure/workspace/WorkspaceResolver';
import * as path from 'path';
import * as os from 'os';
import * as net from 'net';
import { logger } from '../../../../utils/logger';

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
 * Preview routes
 * Handles preview server management (start, stop, status, logs)
 */
export function createPreviewRoutes(deps: {
  projectService: ProjectService;
  previewService: PreviewService;
  workspaceResolver: WorkspaceResolver;
}): Router {
  const router = Router();
  
  // Start preview for a project
  // Body params:
  //   - port?: number - Specific port to use
  //   - feature?: string - Feature name (default: 'main')
  //   - forceRestart?: boolean - Force restart if already running (default: true)
  router.post('/projects/:id/preview/start', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const userContext = extractUserContext(req);
      
      logger.warn(`[Preview] POST /preview/start - projectId=${projectId}, user=${userContext?.userId}`, { component: 'PreviewRoutes' });
      
      const config = await deps.projectService.getProjectConfig(projectId, userContext);
      
      const port = req.body?.port;
      const feature = req.body?.feature || 'main';
      // Default to true for better UX - auto-restart if already running
      const forceRestart = req.body?.forceRestart !== false;
      
      let codebasePath: string;
      
      if (config?.repoType === 'cloud') {
        const projectPath = deps.workspaceResolver.getProjectPath(userContext, projectId);
        codebasePath = path.join(projectPath, 'codebase');
        
        logger.debug(`Cloud mode - codebase path calculated`, { component: 'PreviewRoutes', organizationId: userContext.organizationId, userId: userContext.userId, projectId, featureName: feature }, { codebasePath });
      } else {
        if (!config?.localPath) {
          res.status(400).json({ error: 'Project localPath not configured' });
          return;
        }
        
        codebasePath = config.localPath.startsWith('~') 
          ? path.join(os.homedir(), config.localPath.slice(1))
          : path.resolve(config.localPath);
        
        logger.debug(`Local mode - codebase path resolved`, { component: 'PreviewRoutes', organizationId: userContext.organizationId, userId: userContext.userId, projectId, featureName: feature }, { codebasePath });
      }
      
      const result = await deps.previewService.startPreview(
        userContext.organizationId,
        userContext.userId,
        projectId,
        feature,
        codebasePath,
        port,
        forceRestart
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
  
  // Stop preview
  router.post('/projects/:id/preview/stop', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const userContext = extractUserContext(req);
      const feature = req.body?.feature || 'main';
      
      const result = await deps.previewService.stopPreview(
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
  
  // Get preview status
  router.get('/projects/:id/preview/status', (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const userContext = extractUserContext(req);
      const feature = (req.query.feature as string) || 'main';
      
      const status = deps.previewService.getPreviewStatus(
        userContext.organizationId,
        userContext.userId,
        projectId,
        feature
      );
      const logs = deps.previewService.getPreviewLogs(
        userContext.organizationId,
        userContext.userId,
        projectId,
        feature
      );
      
      const fullStatus = {
        running: status.running,
        ready: status.ready,
        port: status.port || null,
        url: status.url || null,
        processCount: status.processCount || 0,
        backendPort: status.backendPort || null,
        packages: status.packages || [],
        issues: status.issues || [],
        logs: logs.slice(-50) // Last 50 logs
      };
      
      res.json(fullStatus);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // Validate preview setup
  router.get('/projects/:id/preview/validate', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const userContext = extractUserContext(req);
      const config = await deps.projectService.getProjectConfig(projectId, userContext);
      
      let codebasePath: string;
      
      if (config?.repoType === 'cloud') {
        const projectPath = deps.workspaceResolver.getProjectPath(userContext, projectId);
        codebasePath = path.join(projectPath, 'codebase');
      } else {
        if (!config?.localPath) {
          res.status(400).json({ error: 'Project localPath not configured' });
          return;
        }
        
        codebasePath = config.localPath.startsWith('~') 
          ? path.join(os.homedir(), config.localPath.slice(1))
          : path.resolve(config.localPath);
      }
      
      const validation = await deps.previewService.validatePreviewSetup(codebasePath);
      
      res.json(validation);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // SSE stream for preview logs (deprecated)
  router.get('/projects/:id/preview/logs', (req: Request, res: Response) => {
    res.status(410).json({
      error: 'Endpoint deprecated',
      message: 'Use /projects/:id/features/:feature/stream (unified SSE) instead'
    });
  });
  
  // Deprecated SSE endpoint
  router.get('/projects/:id/preview/stream', (req: Request, res: Response) => {
    res.status(410).json({ 
      error: 'Endpoint deprecated',
      message: 'Use /projects/:id/features/:feature/stream (unified SSE) instead'
    });
  });
  
  return router;
}

// ==========================================
// Backward compatibility aliases (deprecated)
// ==========================================

/** @deprecated Use createPreviewRoutes instead */
export const createDevServerRoutes = createPreviewRoutes;
