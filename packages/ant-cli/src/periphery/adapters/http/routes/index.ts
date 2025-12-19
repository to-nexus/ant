import { Router } from 'express';
import { ProjectService, ChatService } from '../services';
import { GitHubAuthService } from '../../auth/GitHubAuthService';
import { createHealthRoutes } from './health.routes';
import { createProjectsRoutes } from './projects.routes';
import { createFeaturesRoutes } from './features.routes';
import { createFilesRoutes } from './files.routes';
import { createChatRoutes } from './chat.routes';
import { createGitHubRoutes } from './github.routes';
import { createFigmaOAuthRoutes } from './figma-oauth.routes';
import { createFigmaFilesRoutes } from './figma-files.routes';
import { createModelsRoutes } from './models.routes';

// ✅ Re-export existing routes (for backward compatibility)
export { createJobRoutes } from './jobRoutes';
export { createKanbanRoutes } from './kanbanRoutes';
export { createDevServerRoutes } from './devServerRoutes';
export { createWorkflowRoutes } from './workflowRoutes';
export { createSSERoutes } from './sseRoutes';
export { createAuthRoutes } from './authRoutes';
export { createIDERoutes } from './ideRoutes';

/**
 * Dependencies for route creation
 */
export interface RoutesDeps {
  projectService: ProjectService;
  chatService?: ChatService;
  githubAuthService?: GitHubAuthService;
  workspaceRoot?: string;  // For Figma OAuth
  workspaceResolver?: any;  // For Figma Files (WorkspaceResolver)
}

/**
 * Create unified API router
 * Aggregates all route modules into a single router
 */
export function createApiRoutes(deps: RoutesDeps): Router {
  const router = Router();
  
  // Health & system endpoints
  router.use(createHealthRoutes());
  
  // Project CRUD
  router.use(createProjectsRoutes({
    projectService: deps.projectService
  }));
  
  // Feature CRUD
  router.use(createFeaturesRoutes({
    projectService: deps.projectService,
    chatService: deps.chatService
  }));
  
  // File operations
  router.use(createFilesRoutes({
    projectService: deps.projectService
  }));
  
  // Chat operations
  router.use(createChatRoutes({
    chatService: deps.chatService
  }));
  
  // GitHub integration
  if (deps.githubAuthService) {
    router.use('/github', createGitHubRoutes({
      githubAuthService: deps.githubAuthService
    }));
  }
  
  // Figma OAuth integration
  router.use('/figma', createFigmaOAuthRoutes(deps.workspaceRoot || process.cwd()));
  
  // Figma Files integration
  if (deps.workspaceRoot && deps.workspaceResolver) {
    router.use('/figma', createFigmaFilesRoutes({
      workspaceRoot: deps.workspaceRoot,
      workspaceResolver: deps.workspaceResolver
    }));
  }
  
  // Models API
  router.use(createModelsRoutes());
  
  return router;
}
