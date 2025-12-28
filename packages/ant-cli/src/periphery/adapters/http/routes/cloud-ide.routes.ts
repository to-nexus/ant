/**
 * Cloud IDE Routes
 * 
 * Endpoints for managing cloud-based IDE containers (code-server)
 */

import { Router, Request, Response } from 'express';
import { IDEService } from '../../ide/IDEService';
import { UserContext } from '../../../../core/types/user';
import { extractUserContext } from './helpers/userContext';
import * as path from 'path';
import { logger } from '../../../../utils/logger';

export function createCloudIDERoutes(ideService: IDEService, workspaceResolver: any): Router {
  const router = Router();

  function getDirectUrl(req: Request, port: number): string {
    const forwardedProto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
    const forwardedHost = (req.headers['x-forwarded-host'] as string) || (req.headers.host as string) || 'localhost';
    const hostWithoutPort = forwardedHost.includes(':') ? forwardedHost.split(':')[0] : forwardedHost;
    // For local dev, the IDE container is bound to a host port. Direct access is simplest.
    return `${forwardedProto}://${hostWithoutPort}:${port}`;
  }
  
  /**
   * POST /cloud-ide/start
   * Start cloud IDE for user/project
   */
  router.post('/start', async (req: Request, res: Response) => {
    try {
      const { projectId, featureName } = req.body;
      const userContext: UserContext = req.body.userContext || extractUserContext(req);
      
      if (!projectId) {
        return res.status(400).json({ error: 'projectId is required' });
      }
      
      // Get workspace path
      const projectPath = workspaceResolver.getProjectPath(userContext, projectId);
      // ✅ IDE should only see codebase (project-level isolation of codebase in IDE)
      const workspacePath = path.join(projectPath, 'codebase');
      
      // Start IDE
      const instance = await ideService.startIDE(userContext, projectId, workspacePath, featureName || 'main');
      
      res.json({
        success: true,
        instance: {
          url: instance.url,
          directUrl: getDirectUrl(req, instance.port),
          port: instance.port,
          status: instance.status,
          workspacePath: instance.workspacePath  // ✅ Docker 내부 경로 반환
        },
        debug: {
          ideImage: process.env.ANT_IDE_IMAGE || 'gitpod/openvscode-server:latest',
          workspaceMode: 'project', // ✅ fixed (always /{projectId})
          hostnameMode: process.env.ANT_IDE_HOSTNAME_MODE || 'user'
        }
      });
      
    } catch (error: any) {
      logger.warn(`Start failed: ${error.message}`, { component: 'CloudIDERoutes', projectId: req.body?.projectId, featureName: req.body?.featureName }, error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /cloud-ide/open/:projectId?feature=main
   * Convenience endpoint: ensure IDE is running then redirect to directUrl.
   * (Useful in local dev where /ide proxy may not be configured.)
   */
  router.get('/open/:projectId', async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const featureName = (req.query.feature as string) || 'main';
      const userContext: UserContext = extractUserContext(req);

      const projectPath = workspaceResolver.getProjectPath(userContext, projectId);
      const workspacePath = path.join(projectPath, 'codebase');

      const instance = await ideService.startIDE(userContext, projectId, workspacePath, featureName);
      res.redirect(302, getDirectUrl(req, instance.port));
    } catch (error: any) {
      logger.warn(`Open failed: ${error.message}`, { component: 'CloudIDERoutes', projectId: req.params?.projectId, featureName: req.query?.feature as any }, error);
      res.status(500).json({ error: error.message });
    }
  });
  
  /**
   * POST /cloud-ide/stop
   * Stop cloud IDE for user/project
   */
  router.post('/stop', async (req: Request, res: Response) => {
    try {
      const { projectId, featureName } = req.body;
      const userContext: UserContext = req.body.userContext || extractUserContext(req);
      
      if (!projectId) {
        return res.status(400).json({ error: 'projectId is required' });
      }
      
      const tenantId = `${userContext.organizationId}:${userContext.userId}`;
      
      await ideService.stopIDE(tenantId, projectId, featureName || 'main');
      
      res.json({ success: true });
      
    } catch (error: any) {
      logger.warn(`Stop failed: ${error.message}`, { component: 'CloudIDERoutes', projectId: req.body?.projectId, featureName: req.body?.featureName }, error);
      res.status(500).json({ error: error.message });
    }
  });
  
  /**
   * GET /cloud-ide/status/:projectId
   * Get cloud IDE status
   */
  router.get('/status/:projectId', async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const featureName = (req.query.feature as string) || 'main';
      const userContext: UserContext = extractUserContext(req);
      
      const tenantId = `${userContext.organizationId}:${userContext.userId}`;
      
      const instance = await ideService.getIDEStatus(tenantId, projectId, featureName);
      
      if (!instance) {
        return res.json({ running: false });
      }
      
      res.json({
        running: true,
        instance: {
          url: instance.url,
          port: instance.port,
          status: instance.status,
          createdAt: instance.createdAt,
          lastAccessedAt: instance.lastAccessedAt
        }
      });
      
    } catch (error: any) {
      logger.warn(`Status check failed: ${error.message}`, { component: 'CloudIDERoutes', projectId: req.params?.projectId, featureName: req.query?.feature as any }, error);
      res.status(500).json({ error: error.message });
    }
  });
  
  /**
   * GET /cloud-ide/list
   * List all running cloud IDEs
   */
  router.get('/list', (req: Request, res: Response) => {
    try {
      const instances = ideService.listIDEs();
      
      res.json({
        instances: instances.map(i => ({
          tenantId: i.tenantId,
          projectId: i.projectId,
          url: i.url,
          port: i.port,
          status: i.status,
          createdAt: i.createdAt,
          lastAccessedAt: i.lastAccessedAt
        }))
      });
      
    } catch (error: any) {
      logger.warn(`List failed: ${error.message}`, { component: 'CloudIDERoutes' }, error);
      res.status(500).json({ error: error.message });
    }
  });
  
  return router;
}

