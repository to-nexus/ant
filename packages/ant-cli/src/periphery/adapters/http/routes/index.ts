import { Router } from 'express';
import { ProjectService, ChatService } from '../services';
import { createHealthRoutes } from './health.routes';
import { createProjectsRoutes } from './projects.routes';
import { createFeaturesRoutes } from './features.routes';
import { createFilesRoutes } from './files.routes';
import { createChatRoutes } from './chat.routes';

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
    projectService: deps.projectService
  }));
  
  // File operations
  router.use(createFilesRoutes({
    projectService: deps.projectService
  }));
  
  // Chat operations
  router.use(createChatRoutes({
    chatService: deps.chatService
  }));
  
  return router;
}
