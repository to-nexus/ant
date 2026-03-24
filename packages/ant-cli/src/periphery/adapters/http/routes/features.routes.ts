import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { ProjectService, ChatService, KanbanService } from '../services';
import { extractUserContext } from './helpers/userContext';
import { sendErrorResponse } from './helpers/errorResponse';
import { getSessionFilePathByJob, getAgentForJob, getSessionDebugDir } from '../../../../core/utils/sessionPaths';
import { logger } from '../../../../utils/logger';
import type { StateStorePort } from '../../../../core/ports/stateStore';

/**
 * Feature CRUD operations
 */
export function createFeaturesRoutes(deps: {
  projectService: ProjectService;
  chatService?: ChatService;
  kanbanService?: KanbanService;
  stateStore?: StateStorePort;
}): Router {
  const router = Router();
  
  // Get features for a project
  router.get('/projects/:id/features', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const userContext = extractUserContext(req);
      
      const features = await deps.projectService.listFeatures(projectId, userContext);
      
      // Format for API response (path not needed, frontend uses name)
      const formattedFeatures = features.map(name => ({ name }));
      
      res.json(formattedFeatures);
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'Features');
    }
  });
  
  // Create a new feature
  router.post('/projects/:id/features', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const { featureName, language, skipPrdTemplate } = req.body;
      
      if (!featureName) {
        res.status(400).json({ error: 'featureName is required' });
        return;
      }
      
      const userContext = extractUserContext(req);

      // ✅ Git guard removed: features can be created without Git.
      // Users can publish to Git later via POST /projects/:id/publish.
      // Branch creation is silently skipped when Git is not initialized.
      
      await deps.projectService.createFeature(projectId, featureName, userContext, language, { skipPrdTemplate: !!skipPrdTemplate });
      
      if (req.user) {
        logger.debug(`[Features] Created feature '${featureName}' for ${req.user.id}@${req.organization?.id}`);
      }
      
      res.json({ success: true, featureName });
    } catch (error: any) {
      if (error.message === 'Feature already exists') {
        res.status(409).json({ error: error.message });
      } else {
        sendErrorResponse(res, 500, error, 'Features');
      }
    }
  });
  
  // Delete a feature
  router.delete('/projects/:id/features/:feature', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const featureName = req.params.feature;
      const userContext = extractUserContext(req);
      
      // Block deletion if a job is actively running on this feature
      if (deps.stateStore) {
        const jobs = await deps.stateStore.listJobsByFeature(projectId, featureName);
        const activeJob = jobs.find(j => ['running', 'queued', 'pending'].includes(j.status));
        if (activeJob) {
          res.status(409).json({
            error: 'Feature has active job',
            message: `Cannot delete feature while job is running (jobId: ${activeJob.jobId})`,
            jobId: activeJob.jobId,
            jobStatus: activeJob.status,
          });
          return;
        }
      }
      
      await deps.projectService.deleteFeature(projectId, featureName, userContext);
      
      if (req.user) {
        logger.debug(`[Features] Deleted feature '${featureName}' for ${req.user.id}@${req.organization?.id}`);
      }
      
      res.json({ success: true, message: `Feature ${featureName} deleted` });
    } catch (error: any) {
      if (error.message === 'Feature not found') {
        res.status(404).json({ error: error.message });
      } else {
        sendErrorResponse(res, 500, error, 'Features');
      }
    }
  });
  
  // Get session for a specific feature
  router.get('/projects/:id/features/:feature/session', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const featureName = req.params.feature;
      const job = (req.query.job as 'design' | 'code' | 'learn') || 'code';
      const userContext = extractUserContext(req);
      
      const sessionData = await deps.projectService.getSession(projectId, featureName, job, userContext);
      res.json(sessionData);
    } catch (error: any) {
      if (error.message === 'Session file not found' || error.message.includes('not found')) {
        res.json(null);
      } else {
        sendErrorResponse(res, 500, error, 'Features');
      }
    }
  });
  
  // Reset job state (remove jobId and jobTiming)
  router.post('/projects/:id/features/:feature/reset-job', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const featureName = req.params.feature;
      const job = (req.body.job || req.query.job as 'design' | 'code' | 'learn') || 'code';
      const userContext = extractUserContext(req);
      
      logger.debug(`\n🔄 [API] Reset job state request:`);
      logger.debug(`   Project: ${projectId}`);
      logger.debug(`   Feature: ${featureName}`);
      logger.debug(`   Job: ${job}`);
      
      await deps.projectService.resetJobState(projectId, featureName, job, userContext);
      
      logger.debug(`   ✅ Job state reset successfully\n`);
      
      res.json({ 
        success: true, 
        message: 'Job state reset successfully' 
      });
    } catch (error: any) {
      logger.error('Error resetting job state', { component: 'Features' }, error);
      sendErrorResponse(res, 500, error, 'Features');
    }
  });
  
  // Clear session data for a specific job type
  router.delete('/projects/:id/features/:feature/session', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const featureName = req.params.feature;
      const jobType = (req.query.job as 'design' | 'code' | 'learn') || 'code';
      const userContext = extractUserContext(req);
      
      // Read existing session
      let sessionData: any;
      try {
        sessionData = await deps.projectService.getSession(projectId, featureName, jobType, userContext);
      } catch (error: any) {
        if (error.message === 'Session file not found') {
          logger.debug(`[Session] No session file to clear`);
          return res.json({ success: true, message: 'No session data to clear' });
        }
        throw error;
      }
      
      // Clear job-related data but keep structure
      const MIN_RECURSION_LIMIT = 5;
      const envRecursionLimit = parseInt(process.env.RECURSION_LIMIT || '', 10);
      const defaultRecursionLimit = (isNaN(envRecursionLimit) || envRecursionLimit < MIN_RECURSION_LIMIT) 
        ? 200 
        : envRecursionLimit;
      
      // ✅ Use null instead of undefined - JSON.stringify omits undefined values!
      const clearedSession = {
        ...sessionData,
        state: {
          taskQueue: [],
          completedTasks: [],
          completedTasksDetails: [],
          currentTask: null,
          jobId: null,  // ✅ null is preserved in JSON, undefined is omitted
          jobTiming: null,
          recursionCount: 0,
          recursionLimit: sessionData.state?.recursionLimit || defaultRecursionLimit,
          interruption: null
        }
      };
      
      // Write cleared session (using internal method)
      const workspaceResolver = (deps.projectService as any).workspaceResolver;
      const featurePath = workspaceResolver.getFeaturePath(userContext, projectId, featureName);
      const sessionPath = getSessionFilePathByJob(featurePath, jobType);
      
      await fs.promises.writeFile(sessionPath, JSON.stringify(clearedSession, null, 2), 'utf-8');
      
      logger.debug(`[Session] ✅ Cleared session data: ${projectId}/${featureName}/${jobType}.json`);
      
      // ✅ CRITICAL: Invalidate KanbanService cache to prevent stale data on SSE reconnect
      if (deps.kanbanService) {
        deps.kanbanService.invalidateSessionCache(sessionPath);

        // ✅ Also clear job memory state if jobId existed
        const previousJobId = sessionData?.state?.jobId;
        if (previousJobId) {
          deps.kanbanService.clearJobMemory(previousJobId);
          logger.debug(`[Session] 🗑️ Cleared memory state for previous job: ${previousJobId}`);
        }
      }

      // ✅ CRITICAL: Clear Redis job status for paused/stale jobs so new jobs can start.
      // Without this, checkDuplicateJob() still finds the paused job and blocks new job creation
      // with "이전 작업이 중단되어 있습니다" even after session reset.
      const previousJobId = sessionData?.state?.jobId;
      if (previousJobId && deps.stateStore) {
        try {
          const jobStatus = await deps.stateStore.getJobStatus(previousJobId);
          if (jobStatus && (jobStatus.status === 'paused' || jobStatus.status === 'running')) {
            await deps.stateStore.updateJobStatus(previousJobId, {
              status: 'failed',
              completedAt: new Date().toISOString(),
              error: 'Session cleared by user',
            });
            logger.debug(`[Session] 🗑️ Marked job ${previousJobId} as failed (was: ${jobStatus.status})`);
          }
        } catch (error) {
          logger.warn('Failed to update Redis job status during session clear (non-critical)', { component: 'Features' }, error);
        }
      }
      if (previousJobId) {
        try {
          const agent = getAgentForJob(jobType);
          const debugSubdirs = ['prompts', 'plans', 'logs', 'tokens'];
          for (const subdir of debugSubdirs) {
            const debugDir = getSessionDebugDir(featurePath, agent, subdir);
            let entries: fs.Dirent[];
            try {
              entries = await fs.promises.readdir(debugDir, { withFileTypes: true });
            } catch {
              continue; // directory doesn't exist — skip
            }
            for (const entry of entries) {
              if (entry.isFile() && entry.name.includes(previousJobId)) {
                await fs.promises.unlink(path.join(debugDir, entry.name));
                logger.debug(`[Session] 🗑️ Deleted debug file: ${subdir}/${entry.name}`);
              }
            }
          }
          logger.debug(`[Session] ✅ Cleared debug logs for job: ${previousJobId}`);
        } catch (error) {
          logger.warn('Failed to clear debug log files (non-critical)', { component: 'Features' }, error);
        }
      }
      
      // ✅ CRITICAL: Broadcast kanban update so frontend clears stale interruption state
      if (deps.kanbanService && deps.stateStore && userContext?.organizationId && userContext?.userId) {
        try {
          const kanbanData = await deps.kanbanService.getKanbanData(
            projectId, featureName, jobType,
            undefined, undefined, undefined,
            userContext
          );
          const { getRealtimeBroadcastChannel } = await import('../../../../infrastructure/state/redisConstants');
          const channel = getRealtimeBroadcastChannel(userContext.organizationId, userContext.userId);
          await deps.stateStore.publish(channel, {
            projectId, featureName,
            type: 'kanban',
            data: kanbanData,
            userContext
          });
          logger.debug(`[Session] ✅ Broadcast kanban update after session clear`);
        } catch (broadcastError) {
          logger.warn('Failed to broadcast kanban update after session clear', { component: 'Features' }, broadcastError);
        }
      }
      
      res.json({ success: true, message: 'Session data cleared' });
    } catch (error: any) {
      logger.error('Error clearing session', { component: 'Features' }, error);
      sendErrorResponse(res, 500, error, 'Features');
    }
  });
  
  return router;
}

