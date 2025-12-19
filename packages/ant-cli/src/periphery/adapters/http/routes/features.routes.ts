import { Router, Request, Response } from 'express';
import { ProjectService, ChatService } from '../services';
import { extractUserContext } from './helpers/userContext';

/**
 * Feature CRUD operations
 */
export function createFeaturesRoutes(deps: {
  projectService: ProjectService;
  chatService?: ChatService;
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
      res.status(500).json({ error: error.message });
    }
  });
  
  // Create a new feature
  router.post('/projects/:id/features', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const { featureName } = req.body;
      
      if (!featureName) {
        res.status(400).json({ error: 'featureName is required' });
        return;
      }
      
      const userContext = extractUserContext(req);
      
      await deps.projectService.createFeature(projectId, featureName, userContext);
      
      if (req.user) {
        console.log(`[Features] Created feature '${featureName}' for ${req.user.id}@${req.organization?.id}`);
      }
      
      res.json({ success: true, featureName });
    } catch (error: any) {
      if (error.message === 'Feature already exists') {
        res.status(409).json({ error: error.message });
      } else {
        res.status(500).json({ error: error.message });
      }
    }
  });
  
  // Delete a feature
  router.delete('/projects/:id/features/:feature', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const featureName = req.params.feature;
      const userContext = extractUserContext(req);
      
      await deps.projectService.deleteFeature(projectId, featureName, userContext);
      
      if (req.user) {
        console.log(`[Features] Deleted feature '${featureName}' for ${req.user.id}@${req.organization?.id}`);
      }
      
      res.json({ success: true, message: `Feature ${featureName} deleted` });
    } catch (error: any) {
      if (error.message === 'Feature not found') {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({ error: error.message });
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
        res.status(500).json({ error: error.message });
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
      
      console.log(`\n🔄 [API] Reset job state request:`);
      console.log(`   Project: ${projectId}`);
      console.log(`   Feature: ${featureName}`);
      console.log(`   Job: ${job}`);
      
      await deps.projectService.resetJobState(projectId, featureName, job, userContext);
      
      console.log(`   ✅ Job state reset successfully\n`);
      
      res.json({ 
        success: true, 
        message: 'Job state reset successfully' 
      });
    } catch (error: any) {
      console.error(`[API] Error resetting job state:`, error);
      res.status(500).json({ error: error.message });
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
          console.log(`[Session] No session file to clear`);
          return res.json({ success: true, message: 'No session data to clear' });
        }
        throw error;
      }
      
      // Clear job-related data but keep structure
      const MIN_RECURSION_LIMIT = 5;
      const envRecursionLimit = parseInt(process.env.RECURSION_LIMIT || '', 10);
      const defaultRecursionLimit = (isNaN(envRecursionLimit) || envRecursionLimit < MIN_RECURSION_LIMIT) 
        ? 50 
        : envRecursionLimit;
      
      const clearedSession = {
        ...sessionData,
        state: {
          taskQueue: [],
          completedTasks: [],
          completedTasksDetails: [],
          currentTask: null,
          jobId: undefined,
          jobTiming: undefined,
          recursionCount: 0,
          recursionLimit: sessionData.state?.recursionLimit || defaultRecursionLimit,
          interruption: undefined
        }
      };
      
      // Write cleared session (using internal method)
      const workspaceResolver = (deps.projectService as any).workspaceResolver;
      const featurePath = workspaceResolver.getFeaturePath(userContext, projectId, featureName);
      const path = require('path');
      const fs = require('fs');
      const sessionPath = path.join(featurePath, `sessions/${jobType}.json`);
      
      await fs.promises.writeFile(sessionPath, JSON.stringify(clearedSession, null, 2), 'utf-8');
      
      console.log(`[Session] ✅ Cleared session data: ${projectId}/${featureName}/${jobType}.json`);
      
      // ✅ CRITICAL: Also clear chat.json (chat session should reset when job is cleared)
      if (deps.chatService) {
        try {
          deps.chatService.clearMessages(projectId, featureName, userContext);
          console.log(`[Session] ✅ Cleared chat session: ${projectId}/${featureName}/chat.json`);
        } catch (error) {
          console.warn(`[Session] ⚠️  Failed to clear chat session (non-critical):`, error);
        }
      }
      
      res.json({ success: true, message: 'Session data cleared' });
    } catch (error: any) {
      console.error('[Session] ❌ Error clearing session:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  return router;
}

