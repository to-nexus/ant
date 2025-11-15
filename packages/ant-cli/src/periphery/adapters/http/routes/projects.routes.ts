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
  
  return router;
}

