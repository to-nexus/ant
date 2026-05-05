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
import type { StateStorePort } from '../../../../core/ports/stateStore';
import { tryAcquireThrottle } from '../../../../core/redis/distributedLock';
import { REDIS_KEYS } from '../../../../core/constants/redis';
import { WorktreeService } from '../services/GitService/worktree';
import { GitBootstrapSSOT } from '../services/GitService/remote/operations/BaseGitSetupOperation';
import { ensureGitRepository } from '../services/GitService/remote/operations/helpers/ensureGitRepository';
import { FeatureCodebaseBackup } from '../services/GitService/worktree/FeatureCodebaseBackup';
import type { GitHubAuthService } from '../../auth/GitHubAuthService';

const WORKTREE_PRUNE_THROTTLE_SEC = 60 * 60; // 1h — enough that hot-path entries skip cheaply

export function createCloudIDERoutes(
  ideOrchestrator: IDEOrchestratorPort,
  workspaceResolver: any,
  stateStore?: StateStorePort,
  githubAuthService?: GitHubAuthService,
): Router {
  const router = Router();

  // Construct the per-route deps needed by `ensureGitRepository`. These are
  // cheap stateless objects — no need to share singletons with other routers.
  // Sharing GitService here would create a circular import (cloud-ide ↔ Git facade).
  const worktreeService = new WorktreeService(workspaceResolver, githubAuthService);
  const gitBootstrap = new GitBootstrapSSOT(workspaceResolver, 'CloudIDEStart');
  const featureBackup = new FeatureCodebaseBackup(workspaceResolver);

  /**
   * Race fix — IDE start guarantees worktree validity before pod creation.
   * Without this, POST /cloud-ide/start can race the createFeature flow:
   * - If `.git` marker is missing or partial when `resolveK8sWorktreeMounts`
   *   runs, the helper returns `[]` silently → pod gets only the alias mount
   *   → IDE shows "Initialize Repository" forever (pod spec is immutable).
   * `ensureGitRepository` is the same SSOT used by remote ops; it covers
   * Stage-4 partial-write self-heal too.
   */
  async function ensureWorktreeForIDE(userContext: UserContext, projectId: string, featureName: string): Promise<void> {
    await ensureGitRepository({
      workspaceResolver,
      gitBootstrap,
      projectId,
      userContext,
      featureName,
      operationName: 'CloudIDEStart',
      worktreeService,
      featureBackup,
    });
  }

  /**
   * Throttled worktree-meta sweep — first cloud-ide.start per (org,user,
   * project) within 1h triggers `pruneCorruptWorktreeMeta` on the main
   * codebase; subsequent entries skip via SETNX-EX. Failure to acquire
   * the throttle key (e.g. Redis transient error) downgrades to skip,
   * since `removeWorktree` already does an unconditional sweep.
   */
  async function maybePruneWorktreeMeta(userContext: UserContext, projectId: string): Promise<void> {
    if (!stateStore) return;
    let acquired = false;
    try {
      const throttleKey = REDIS_KEYS.THROTTLE.WORKTREE_PRUNE(
        userContext.organizationId,
        userContext.userId,
        projectId,
      );
      acquired = await tryAcquireThrottle(stateStore, throttleKey, WORKTREE_PRUNE_THROTTLE_SEC);
    } catch (err: any) {
      logger.warn(`[CloudIDE] worktree-prune throttle check failed (skipping)`, { component: 'CloudIDERoutes' }, err);
      return;
    }
    if (!acquired) return;
    try {
      const mainCodebasePath = workspaceResolver.getCodebasePath(userContext, projectId);
      await WorktreeService.pruneCorruptWorktreeMeta(mainCodebasePath);
    } catch (err: any) {
      logger.warn(`[CloudIDE] pruneCorruptWorktreeMeta failed (continuing with start)`, { component: 'CloudIDERoutes' }, err);
    }
  }

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

      // Throttled corrupt-meta sweep on the main codebase before mounting.
      // No-op when the throttle key still has TTL (1h window).
      await maybePruneWorktreeMeta(userContext, projectId);

      // Race + Stage-4 self-heal — must run BEFORE workspacePath / pod spec
      // resolution so `resolveK8sWorktreeMounts` sees a fully-formed worktree.
      if (featureName && featureName !== RESERVED_FEATURE_NAME) {
        try {
          await ensureWorktreeForIDE(userContext, projectId, featureName);
        } catch (err: any) {
          logger.warn(`[CloudIDE] ensureWorktreeForIDE failed (proceeding — fail-fast in createPodSpec)`, {
            component: 'CloudIDERoutes', projectId, featureName,
          }, err);
          // Don't swallow silently — surface to user via fail-fast in createPodSpec
          // when worktree mounts cannot be resolved.
        }
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
