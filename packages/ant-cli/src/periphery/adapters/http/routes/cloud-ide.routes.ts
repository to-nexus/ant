/**
 * Cloud IDE Routes
 * 
 * Endpoints for managing cloud-based IDE containers (code-server)
 * 
 * In cloud mode (ANT_K8S_NAMESPACE set): Uses KubernetesIDEOrchestrator
 * In local mode: Uses LocalIDEOrchestrator (Docker)
 */

import { Router, Request, Response } from 'express';
import { IDEOrchestratorPort, IDEParams } from '../../../../core/ports/ideOrchestrator';
import { UserContext } from '../../../../core/types/user';
import { extractUserContext } from './helpers/userContext';
import { sendErrorResponse } from './helpers/errorResponse';
import * as path from 'path';
import { logger } from '../../../../utils/logger';
import { RESERVED_FEATURE_NAME } from '../../../../core/utils/branchUtils';

export function createCloudIDERoutes(ideOrchestrator: IDEOrchestratorPort, workspaceResolver: any): Router {
  const router = Router();

  function getDirectUrl(req: Request, host: string, port: number): string {
    const forwardedProto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
    const forwardedHost = (req.headers['x-forwarded-host'] as string) || (req.headers.host as string) || 'localhost';
    const hostWithoutPort = forwardedHost.includes(':') ? forwardedHost.split(':')[0] : forwardedHost;
    // For local dev, the IDE container is bound to a host port. Direct access is simplest.
    // For K8s, we use the service/pod name
    if (host === 'localhost' || host.startsWith('127.')) {
      return `${forwardedProto}://${hostWithoutPort}:${port}`;
    }
    // K8s mode - return proxy URL
    return `${forwardedProto}://${forwardedHost}/ide`;
  }
  
  /**
   * POST /cloud-ide/start
   * Start cloud IDE for user/project
   */
  router.post('/start', async (req: Request, res: Response) => {
    try {
      const { projectId, featureName } = req.body;
      const userContext: UserContext = extractUserContext(req);
      
      logger.info(`POST /cloud-ide/start - projectId=${projectId}, user=${userContext?.userId}`, { component: 'CloudIDERoutes' });
      
      if (!projectId) {
        return res.status(400).json({ error: 'projectId is required' });
      }
      
      // Get workspace path (feature-aware: worktree for features)
      const workspacePath = workspaceResolver.getCodebasePath(userContext, projectId, featureName || RESERVED_FEATURE_NAME);
      
      const tenantId = `${userContext.organizationId}:${userContext.userId}`;
      
      // Start IDE using orchestrator
      const params: IDEParams = {
        tenantId,
        userId: userContext.userId,
        projectId,
        feature: featureName || RESERVED_FEATURE_NAME,
        workspacePath,
        userContext
      };
      
      const result = await ideOrchestrator.start(params);
      
      if (!result.success || !result.instance) {
        return res.status(500).json({ 
          success: false, 
          error: result.error || 'Failed to start IDE' 
        });
      }
      
      const instance = result.instance;
      
      res.json({
        success: true,
        instance: {
          url: instance.url,
          directUrl: getDirectUrl(req, instance.host, instance.port),
          port: instance.port,
          host: instance.host,
          status: instance.status,
          workspacePath: instance.workspacePath
        },
        debug: {
          ideRuntime: process.env.ANT_K8S_NAMESPACE ? 'kubernetes' : 'docker',
          namespace: process.env.ANT_K8S_NAMESPACE || 'N/A'
        }
      });
      
    } catch (error: any) {
      logger.warn(`Start failed: ${error.message}`, { component: 'CloudIDERoutes', projectId: req.body?.projectId, featureName: req.body?.featureName }, error);
      sendErrorResponse(res, 500, error, 'CloudIDE');
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
      const featureName = (req.query.feature as string) || RESERVED_FEATURE_NAME;
      const userContext: UserContext = extractUserContext(req);

      const workspacePath = workspaceResolver.getCodebasePath(userContext, projectId, featureName);

      const tenantId = `${userContext.organizationId}:${userContext.userId}`;
      
      const params: IDEParams = {
        tenantId,
        userId: userContext.userId,
        projectId,
        feature: featureName,
        workspacePath,
        userContext
      };
      
      const result = await ideOrchestrator.start(params);
      
      if (!result.success || !result.instance) {
        return res.status(500).json({ error: result.error || 'Failed to start IDE' });
      }
      
      res.redirect(302, getDirectUrl(req, result.instance.host, result.instance.port));
    } catch (error: any) {
      logger.warn(`Open failed: ${error.message}`, { component: 'CloudIDERoutes', projectId: req.params?.projectId, featureName: req.query?.feature as any }, error);
      sendErrorResponse(res, 500, error, 'CloudIDE');
    }
  });
  
  /**
   * POST /cloud-ide/stop
   * Stop cloud IDE for user/project
   */
  router.post('/stop', async (req: Request, res: Response) => {
    try {
      const { projectId, featureName } = req.body;
      const userContext: UserContext = extractUserContext(req);
      
      if (!projectId) {
        return res.status(400).json({ error: 'projectId is required' });
      }
      
      const tenantId = `${userContext.organizationId}:${userContext.userId}`;
      
      const result = await ideOrchestrator.stop(tenantId, projectId, featureName || RESERVED_FEATURE_NAME);
      
      res.json({ success: result.success, message: result.message });
      
    } catch (error: any) {
      logger.warn(`Stop failed: ${error.message}`, { component: 'CloudIDERoutes', projectId: req.body?.projectId, featureName: req.body?.featureName }, error);
      sendErrorResponse(res, 500, error, 'CloudIDE');
    }
  });
  
  /**
   * GET /cloud-ide/status/:projectId
   * Get cloud IDE status
   */
  router.get('/status/:projectId', async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const featureName = (req.query.feature as string) || RESERVED_FEATURE_NAME;
      const userContext: UserContext = extractUserContext(req);
      
      const tenantId = `${userContext.organizationId}:${userContext.userId}`;
      
      const instance = await ideOrchestrator.getStatus(tenantId, projectId, featureName);
      
      if (!instance) {
        return res.json({ running: false });
      }
      
      res.json({
        running: true,
        instance: {
          url: instance.url,
          port: instance.port,
          host: instance.host,
          status: instance.status,
          createdAt: instance.createdAt,
          lastAccessedAt: instance.lastAccessedAt
        }
      });
      
    } catch (error: any) {
      logger.warn(`Status check failed: ${error.message}`, { component: 'CloudIDERoutes', projectId: req.params?.projectId, featureName: req.query?.feature as any }, error);
      sendErrorResponse(res, 500, error, 'CloudIDE');
    }
  });
  
  /**
   * GET /cloud-ide/list
   * List all running cloud IDEs
   */
  router.get('/list', async (req: Request, res: Response) => {
    try {
      const instances = await ideOrchestrator.list();
      
      res.json({
        instances: instances.map(i => ({
          tenantId: i.tenantId,
          projectId: i.projectId,
          url: i.url,
          port: i.port,
          host: i.host,
          status: i.status,
          createdAt: i.createdAt,
          lastAccessedAt: i.lastAccessedAt
        }))
      });
      
    } catch (error: any) {
      logger.warn(`List failed: ${error.message}`, { component: 'CloudIDERoutes' }, error);
      sendErrorResponse(res, 500, error, 'CloudIDE');
    }
  });
  
  return router;
}
