import { Router, Request, Response } from 'express';
import { ProjectService } from '../services';
import { extractUserContext } from './helpers/userContext';

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
        console.log(`[Projects] Listed ${projects.length} projects for ${req.user.id}@${req.organization?.id}`);
      }
      
      res.json(projects);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // Create a new project
  router.post('/projects', async (req: Request, res: Response) => {
    try {
      const { id } = req.body;
      
      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: 'Project ID is required and must be a string' });
      }
      
      const userContext = extractUserContext(req);
      
      if (req.user) {
        console.log(`[Projects] Creating project '${id}' for ${req.user.id}@${req.organization?.id}`);
      }
      
      await deps.projectService.createProject(id, userContext);
      res.json({ success: true, id });
    } catch (error: any) {
      if (error.message === 'Project already exists') {
        res.status(409).json({ error: error.message });
      } else {
        res.status(500).json({ error: error.message });
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
        res.status(500).json({ error: error.message });
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
        res.status(500).json({ error: error.message });
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
        res.status(500).json({ error: error.message });
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
        res.status(500).json({ error: error.message });
      }
    }
  });
  
  // Clone GitHub repository
  router.post('/projects/:id/clone', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    try {
      const userContext = extractUserContext(req);
      
      console.log(`[Projects] ========================================`);
      console.log(`[Projects] Clone request for project: ${projectId}`);
      console.log(`[Projects] UserContext: org="${userContext.organizationId}", user="${userContext.userId}"`);
      
      await deps.projectService.cloneGitHubRepo(projectId, userContext);
      res.json({ success: true, message: 'Repository cloned successfully' });
    } catch (error: any) {
      console.error(`[Projects] ❌ Clone failed for ${projectId}`);
      console.error(`[Projects] Error message: ${error.message}`);
      console.error(`[Projects] Error stack:`, error.stack);
      
      if (error.message.includes('not configured') || error.message.includes('not found')) {
        res.status(400).json({ success: false, error: error.message });
      } else if (error.message.includes('already cloned')) {
        res.status(409).json({ success: false, error: error.message });
      } else {
        res.status(500).json({ success: false, error: error.message });
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
      console.error(`[Projects] Clone status check failed for ${projectId}:`, error);
      res.status(500).json({ cloned: false, error: error.message });
    }
  });
  
  // Initialize GitHub repository (create new repo and push)
  router.post('/projects/:id/initialize', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    try {
      const userContext = extractUserContext(req);
      
      console.log(`[Projects] Initializing GitHub repo for project '${projectId}'`);
      
      await deps.projectService.initializeGitHubRepo(projectId, userContext);
      res.json({ success: true, message: 'Repository initialized and pushed successfully' });
    } catch (error: any) {
      console.error(`[Projects] Initialize failed for ${projectId}:`, error);
      
      if (error.message.includes('not configured') || error.message.includes('not found')) {
        res.status(400).json({ success: false, error: error.message });
      } else if (error.message.includes('already initialized') || error.message.includes('already exists')) {
        res.status(409).json({ success: false, error: error.message });
      } else {
        res.status(500).json({ success: false, error: error.message });
      }
    }
  });

  // Push to GitHub
  router.post('/projects/:id/push', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    try {
      const userContext = extractUserContext(req);
      
      console.log(`[Projects] Pushing to GitHub for project '${projectId}'`);
      
      await deps.projectService.pushToGitHub(projectId, userContext);
      res.json({ success: true, message: 'Changes pushed successfully' });
    } catch (error: any) {
      console.error(`[Projects] Push failed for ${projectId}:`, error);
      
      // Return user-friendly error message
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Pull from GitHub
  router.post('/projects/:id/pull', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    try {
      const userContext = extractUserContext(req);
      
      console.log(`[Projects] Pulling from GitHub for project '${projectId}'`);
      
      await deps.projectService.pullFromGitHub(projectId, userContext);
      res.json({ success: true, message: 'Changes pulled successfully' });
    } catch (error: any) {
      console.error(`[Projects] Pull failed for ${projectId}:`, error);
      
      // Return user-friendly error message (including conflict info)
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Fetch from GitHub
  router.post('/projects/:id/fetch', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    try {
      const userContext = extractUserContext(req);
      
      console.log(`[Projects] Fetching from GitHub for project '${projectId}'`);
      
      await deps.projectService.fetchFromGitHub(projectId, userContext);
      res.json({ success: true, message: 'Remote refs updated successfully' });
    } catch (error: any) {
      console.error(`[Projects] Fetch failed for ${projectId}:`, error);
      
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Get Git status
  router.get('/projects/:id/git/status', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    try {
      const userContext = extractUserContext(req);
      
      const status = await deps.projectService.getGitStatus(projectId, userContext);
      res.json(status);
    } catch (error: any) {
      console.error(`[Projects] Get Git status failed for ${projectId}:`, error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get Git changes
  router.get('/projects/:id/git/changes', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    try {
      const userContext = extractUserContext(req);
      
      const changes = await deps.projectService.getGitChanges(projectId, userContext);
      res.json(changes);
    } catch (error: any) {
      console.error(`[Projects] Get Git changes failed for ${projectId}:`, error);
      res.status(500).json({ error: error.message });
    }
  });

  // Commit changes
  router.post('/projects/:id/git/commit', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    try {
      const userContext = extractUserContext(req);
      const { message } = req.body;
      
      console.log(`[Projects] Committing changes for project '${projectId}'`);
      
      const result = await deps.projectService.commitChanges(projectId, userContext, message);
      res.json(result);
    } catch (error: any) {
      console.error(`[Projects] Commit failed for ${projectId}:`, error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Sync with remote (pull then push)
  router.post('/projects/:id/git/sync', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    try {
      const userContext = extractUserContext(req);
      
      console.log(`[Projects] Syncing with remote for project '${projectId}'`);
      
      const result = await deps.projectService.syncWithRemote(projectId, userContext);
      res.json(result);
    } catch (error: any) {
      console.error(`[Projects] Sync failed for ${projectId}:`, error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Switch to feature branch
  router.post('/projects/:id/features/:featureName/checkout', async (req: Request, res: Response) => {
    const { id: projectId, featureName } = req.params;
    try {
      const userContext = extractUserContext(req);
      
      console.log(`[Projects] Switching to feature branch for ${projectId}/${featureName}`);
      
      const actualBranchName = await deps.projectService.switchToFeatureBranch(projectId, featureName, userContext);
      res.json({ success: true, message: 'Branch switched successfully', branchName: actualBranchName });
    } catch (error: any) {
      console.error(`[Projects] Branch switch failed for ${projectId}/${featureName}:`, error);
      
      res.status(400).json({ success: false, error: error.message });
    }
  });
  
  return router;
}

