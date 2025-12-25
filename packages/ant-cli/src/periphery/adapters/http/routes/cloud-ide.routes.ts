/**
 * Cloud IDE Routes
 * 
 * Endpoints for managing cloud-based IDE containers (code-server)
 */

import { Router, Request, Response } from 'express';
import { IDEService } from '../../ide/IDEService';
import { UserContext } from '../../../../core/types/user';

export function createCloudIDERoutes(ideService: IDEService, workspaceResolver: any): Router {
  const router = Router();
  
  /**
   * POST /cloud-ide/start
   * Start cloud IDE for user/project
   */
  router.post('/start', async (req: Request, res: Response) => {
    try {
      const { projectId } = req.body;
      const userContext: UserContext = req.body.userContext || {
        userId: 'local',
        organizationId: 'local',
        workspacePath: ''
      };
      
      if (!projectId) {
        return res.status(400).json({ error: 'projectId is required' });
      }
      
      // Get workspace path
      const workspacePath = workspaceResolver.getProjectPath(userContext, projectId);
      
      // Start IDE
      const instance = await ideService.startIDE(userContext, projectId, workspacePath);
      
      res.json({
        success: true,
        instance: {
          url: instance.url,
          port: instance.port,
          status: instance.status,
          workspacePath: instance.workspacePath  // ✅ Docker 내부 경로 반환
        }
      });
      
    } catch (error: any) {
      console.error('[Cloud IDE Routes] Start failed:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  /**
   * POST /cloud-ide/stop
   * Stop cloud IDE for user/project
   */
  router.post('/stop', async (req: Request, res: Response) => {
    try {
      const { projectId } = req.body;
      const userContext: UserContext = req.body.userContext || {
        userId: 'local',
        organizationId: 'local',
        workspacePath: ''
      };
      
      if (!projectId) {
        return res.status(400).json({ error: 'projectId is required' });
      }
      
      const tenantId = `${userContext.organizationId}:${userContext.userId}`;
      
      await ideService.stopIDE(tenantId, projectId);
      
      res.json({ success: true });
      
    } catch (error: any) {
      console.error('[Cloud IDE Routes] Stop failed:', error);
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
      const userContext: UserContext = (req as any).userContext || {
        userId: 'local',
        organizationId: 'local',
        workspacePath: ''
      };
      
      const tenantId = `${userContext.organizationId}:${userContext.userId}`;
      
      const instance = await ideService.getIDEStatus(tenantId, projectId);
      
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
      console.error('[Cloud IDE Routes] Status check failed:', error);
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
      console.error('[Cloud IDE Routes] List failed:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  return router;
}

