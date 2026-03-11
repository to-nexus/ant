import { Router, Request, Response } from 'express';
import { ProjectService } from '../services';
import { extractUserContext } from './helpers/userContext';
import { sendErrorResponse } from './helpers/errorResponse';
import { validateBody, createProjectSchema } from '../middleware/validateBody';
import { logger } from '../../../../utils/logger';

/**
 * Project CRUD operations
 */
export function createProjectsRoutes(deps: {
  projectService: ProjectService;
}): Router {
  const router = Router();
  
  // List projects
  router.get('/projects', async (req: Request, res: Response) => {
    try {
      const userContext = extractUserContext(req);
      const projects = await deps.projectService.listProjects(userContext);
      
      if (req.user) {
        logger.debug(`Listed ${projects.length} projects`, { component: 'Projects', organizationId: req.organization?.id, userId: req.user.id });
      }
      
      res.json(projects);
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'Projects');
    }
  });
  
  // Create a new project
  router.post('/projects', validateBody(createProjectSchema), async (req: Request, res: Response) => {
    try {
      const { id } = req.body;
      
      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: 'Project ID is required and must be a string' });
      }
      
      const userContext = extractUserContext(req);
      
      if (req.user) {
        logger.info(`Creating project '${id}'`, { component: 'Projects', organizationId: req.organization?.id, userId: req.user.id, projectId: id });
      }
      
      await deps.projectService.createProject(id, userContext);
      res.json({ success: true, id });
    } catch (error: any) {
      if (error.message === 'Project already exists') {
        res.status(409).json({ error: error.message });
      } else {
        sendErrorResponse(res, 500, error, 'Projects');
      }
    }
  });
  
  // Delete a project
  router.delete('/projects/:id', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const userContext = extractUserContext(req);
      
      await deps.projectService.deleteProject(projectId, userContext);
      res.json({ success: true, message: `Project ${projectId} deleted` });
    } catch (error: any) {
      if (error.message === 'Project not found') {
        res.status(404).json({ error: error.message });
      } else {
        sendErrorResponse(res, 500, error, 'Projects');
      }
    }
  });
  
  // Rename a project
  router.put('/projects/:id/rename', async (req: Request, res: Response) => {
    try {
      const oldId = req.params.id;
      const { newId } = req.body;
      
      if (!newId || typeof newId !== 'string') {
        return res.status(400).json({ error: 'newId is required and must be a string' });
      }
      
      const userContext = extractUserContext(req);
      
      if (req.user) {
        logger.info(`Renaming project '${oldId}' to '${newId}'`, { component: 'Projects', organizationId: req.organization?.id, userId: req.user.id, projectId: oldId });
      }
      
      await deps.projectService.renameProject(oldId, newId, userContext);
      res.json({ success: true, oldId, newId });
    } catch (error: any) {
      if (error.message === 'Project not found') {
        res.status(404).json({ error: error.message });
      } else if (error.message === 'A project with the new name already exists') {
        res.status(409).json({ error: error.message });
      } else {
        res.status(400).json({ error: error.message });
      }
    }
  });
  
  // Get project config
  router.get('/projects/:id/config', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const userContext = extractUserContext(req);
      
      const config = await deps.projectService.getProjectConfig(projectId, userContext);
      res.json(config);
    } catch (error: any) {
      if (error.message === 'Config file not found') {
        res.status(404).json({ error: error.message });
      } else {
        sendErrorResponse(res, 500, error, 'Projects');
      }
    }
  });
  
  // Update project config
  router.put('/projects/:id/config', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const config = req.body;
      const userContext = extractUserContext(req);
      
      await deps.projectService.updateProjectConfig(projectId, config, userContext);
      
      // Return the saved config for immediate UI update
      const savedConfig = await deps.projectService.getProjectConfig(projectId, userContext);
      res.json(savedConfig);
    } catch (error: any) {
      if (error.message.includes('Missing required fields')) {
        res.status(400).json({ error: error.message });
      } else if (error.message === 'Config file not found') {
        res.status(404).json({ error: error.message });
      } else {
        sendErrorResponse(res, 500, error, 'Projects');
      }
    }
  });
  
  // Get session for a project (skeleton)
  router.get('/projects/:id/session', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const userContext = extractUserContext(req);
      
      const sessionData = await deps.projectService.getSession(projectId, 'skeleton', undefined, userContext);
      res.json(sessionData);
    } catch (error: any) {
      if (error.message === 'Session file not found') {
        res.json(null);
      } else {
        sendErrorResponse(res, 500, error, 'Projects');
      }
    }
  });
  
  // Clone GitHub repository
  router.post('/projects/:id/clone', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    try {
      const userContext = extractUserContext(req);
      logger.info(`Clone request`, { component: 'Projects', organizationId: userContext.organizationId, userId: userContext.userId, projectId });
      
      await deps.projectService.cloneGitHubRepo(projectId, userContext);
      res.json({ success: true, message: 'Repository cloned successfully' });
    } catch (error: any) {
      logger.warn(`Clone failed: ${error.message}`, { component: 'Projects', projectId }, error);
      
      if (error.message.includes('not configured') || error.message.includes('not found')) {
        res.status(400).json({ success: false, error: error.message });
      } else if (error.message.includes('Cannot clone') || error.message.includes('clean workspace') || error.message.includes('Features already exist')) {
        res.status(400).json({ success: false, error: error.message });
      } else if (error.message.includes('Repository already') || error.message.includes('already cloned')) {
        res.status(409).json({ success: false, error: error.message });
      } else if (error.message.includes('authentication failed') || error.message.includes('Authentication failed')) {
        res.status(401).json({ success: false, error: error.message });
      } else {
        sendErrorResponse(res, 500, error, 'Projects');
      }
    }
  });
  
  // Check clone status
  router.get('/projects/:id/clone/status', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    try {
      const userContext = extractUserContext(req);
      
      const cloned = await deps.projectService.checkCloneStatus(projectId, userContext);
      res.json({ cloned });
    } catch (error: any) {
      logger.warn(`Clone status check failed: ${error.message}`, { component: 'Projects', projectId }, error);
      sendErrorResponse(res, 500, error, 'Projects');
    }
  });
  
  // Initialize GitHub repository (create new repo and push)
  router.post('/projects/:id/initialize', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    try {
      const userContext = extractUserContext(req);
      
      logger.info(`Initializing GitHub repo`, { component: 'Projects', organizationId: userContext.organizationId, userId: userContext.userId, projectId });
      
      await deps.projectService.initializeGitHubRepo(projectId, userContext);
      res.json({ success: true, message: 'Repository initialized and pushed successfully' });
    } catch (error: any) {
      logger.warn(`Initialize failed: ${error.message}`, { component: 'Projects', projectId }, error);
      
      if (error.message.includes('not configured') || error.message.includes('not found')) {
        res.status(400).json({ success: false, error: error.message });
      } else if (error.message.includes('Cannot initialize') || (error.message.includes('feature') && error.message.includes('already exist'))) {
        res.status(400).json({ success: false, error: error.message });
      } else if (error.message.includes('already initialized') || error.message.includes('already exist')) {
        res.status(409).json({ success: false, error: error.message });
      } else {
        sendErrorResponse(res, 500, error, 'Projects');
      }
    }
  });

  // Publish existing codebase to a new GitHub repository
  // Unlike initialize, this allows features to already exist and creates branches for them.
  router.post('/projects/:id/publish', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    try {
      const userContext = extractUserContext(req);
      const { activeFeature } = req.body || {};
      
      logger.info(`Publishing codebase to GitHub`, { component: 'Projects', organizationId: userContext.organizationId, userId: userContext.userId, projectId });
      
      await deps.projectService.publishToGitHub(projectId, userContext, activeFeature);
      res.json({ success: true, message: 'Codebase published to GitHub successfully' });
    } catch (error: any) {
      logger.warn(`Publish failed: ${error.message}`, { component: 'Projects', projectId }, error);
      
      if (error.message.includes('not configured') || error.message.includes('not found')) {
        res.status(400).json({ success: false, error: error.message });
      } else if (error.message.includes('already initialized') || error.message.includes('already exists')) {
        res.status(409).json({ success: false, error: error.message });
      } else if (error.message.includes('authentication failed') || error.message.includes('Authentication failed')) {
        res.status(401).json({ success: false, error: error.message });
      } else {
        sendErrorResponse(res, 500, error, 'Projects');
      }
    }
  });

  // Push to GitHub
  router.post('/projects/:id/push', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    try {
      const userContext = extractUserContext(req);
      const featureName = typeof req.body?.feature === 'string' ? req.body.feature : undefined;
      
      logger.info(`Pushing to GitHub`, { component: 'Projects', organizationId: userContext.organizationId, userId: userContext.userId, projectId });
      
      await deps.projectService.pushToGitHub(projectId, userContext, featureName);
      res.json({ success: true, message: 'Changes pushed successfully' });
    } catch (error: any) {
      logger.warn(`Push failed: ${error.message}`, { component: 'Projects', projectId }, error);
      
      // Return user-friendly error message
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Pull from GitHub
  router.post('/projects/:id/pull', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    try {
      const userContext = extractUserContext(req);
      const featureName = typeof req.body?.feature === 'string' ? req.body.feature : undefined;
      
      logger.info(`Pulling from GitHub`, { component: 'Projects', organizationId: userContext.organizationId, userId: userContext.userId, projectId });
      
      await deps.projectService.pullFromGitHub(projectId, userContext, featureName);
      res.json({ success: true, message: 'Changes pulled successfully' });
    } catch (error: any) {
      logger.warn(`Pull failed: ${error.message}`, { component: 'Projects', projectId }, error);
      
      // Return user-friendly error message (including conflict info)
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Fetch from GitHub
  router.post('/projects/:id/fetch', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    try {
      const userContext = extractUserContext(req);
      const featureName = typeof req.body?.feature === 'string' ? req.body.feature : undefined;
      
      logger.info(`Fetching from GitHub (feature: ${featureName || 'all'})`, { component: 'Projects', organizationId: userContext.organizationId, userId: userContext.userId, projectId });
      
      await deps.projectService.fetchFromGitHub(projectId, userContext, featureName);
      res.json({ success: true, message: 'Remote refs updated successfully' });
    } catch (error: any) {
      logger.warn(`Fetch failed: ${error.message}`, { component: 'Projects', projectId }, error);
      
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Get Git status
  router.get('/projects/:id/git/status', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    try {
      const userContext = extractUserContext(req);
      const featureName = req.query.feature as string | undefined;
      
      const status = await deps.projectService.getGitStatus(projectId, userContext, featureName);
      res.json(status);
    } catch (error: any) {
      logger.warn(`Get Git status failed: ${error.message}`, { component: 'Projects', projectId }, error);
      sendErrorResponse(res, 500, error, 'Projects');
    }
  });

  // Get Git changes
  router.get('/projects/:id/git/changes', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    try {
      const userContext = extractUserContext(req);
      const featureName = req.query.feature as string | undefined;
      
      const changes = await deps.projectService.getGitChanges(projectId, userContext, featureName);
      res.json(changes);
    } catch (error: any) {
      logger.warn(`Get Git changes failed: ${error.message}`, { component: 'Projects', projectId }, error);
      sendErrorResponse(res, 500, error, 'Projects');
    }
  });

  // Commit changes
  router.post('/projects/:id/git/commit', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    try {
      const userContext = extractUserContext(req);
      const { message, feature: featureName } = req.body;
      
      logger.info(`Committing changes`, { component: 'Projects', organizationId: userContext.organizationId, userId: userContext.userId, projectId });
      
      const result = await deps.projectService.commitChanges(projectId, userContext, message, featureName);
      res.json(result);
    } catch (error: any) {
      logger.warn(`Commit failed: ${error.message}`, { component: 'Projects', projectId }, error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Sync with remote (pull then push)
  router.post('/projects/:id/git/sync', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    try {
      const userContext = extractUserContext(req);
      const featureName = typeof req.body?.feature === 'string' ? req.body.feature : undefined;
      
      logger.info(`Syncing with remote`, { component: 'Projects', organizationId: userContext.organizationId, userId: userContext.userId, projectId });
      
      const result = await deps.projectService.syncWithRemote(projectId, userContext, featureName);
      res.json(result);
    } catch (error: any) {
      logger.warn(`Sync failed: ${error.message}`, { component: 'Projects', projectId }, error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Note: POST /projects/:id/features/:featureName/checkout has been removed.
  // With Git worktrees, each feature has its own working directory with the correct
  // branch already checked out. Branch switching is handled at worktree creation time
  // by WorktreeService.createWorktree().
  
  return router;
}

