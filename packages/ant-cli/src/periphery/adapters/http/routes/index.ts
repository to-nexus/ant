import { Router } from 'express';
import { ProjectService, ChatService, KanbanService } from '../services';
import { GitHubAuthService } from '../../auth/GitHubAuthService';
import { ChoiceService } from '../../../../infrastructure/choice';
import { createHealthRoutes } from './health.routes';
import { createProjectsRoutes } from './projects.routes';
import { createFeaturesRoutes } from './features.routes';
import { createFilesRoutes } from './files.routes';
import { createChatRoutes } from './chat.routes';
import { createGitHubRoutes } from './github.routes';
import { createFigmaOAuthRoutes } from './figma-oauth.routes';
import { createFigmaFilesRoutes } from './figma-files.routes';
import { createModelsRoutes } from './models.routes';
import { createTransferRoutes } from './transfer.routes';
import { createOrgRoutes } from './org.routes';

// ✅ Re-export existing routes
// Note: Preview routes moved to ant-preview service (see 10-cloud-architecture.md)
export { createJobRoutes } from './job.routes';
export { createKanbanRoutes } from './kanban.routes';
export { createWorkflowRoutes } from './workflow.routes';
export { createSSERoutes } from './sse.routes';
export { createAuthRoutes } from './auth.routes';
export { createIDERoutes } from './ide.routes';  // Local IDE
export { createCloudIDERoutes } from './cloud-ide.routes';  // Cloud IDE (containers)

/**
 * Dependencies for route creation
 */
export interface RoutesDeps {
  projectService: ProjectService;
  chatService?: ChatService;
  kanbanService?: KanbanService;  // ✅ For session cache invalidation
  choiceService?: ChoiceService;  // ✅ For Triage choice handling
  githubAuthService?: GitHubAuthService;
  workspaceRoot?: string;  // For Figma OAuth
  workspaceResolver?: any;  // For Figma Files (WorkspaceResolver)
  fileTreeNotifier?: { notifyFileTreeUpdate(projectId: string, featureName: string, userContext?: any): void };  // ✅ For file tree updates after file writes
  transferService?: any;  // ArtifactTransferService for transfer operations
  stateStore?: any;  // RedisStateStore for transfer state management
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
    chatService: deps.chatService,
    kanbanService: deps.kanbanService,
    stateStore: deps.stateStore,
  }));
  
  // File operations
  router.use(createFilesRoutes({
    projectService: deps.projectService,
    stateStore: deps.stateStore,
    fileTreeNotifier: deps.fileTreeNotifier
  }));
  
  // Chat operations
  router.use(createChatRoutes({
    chatService: deps.chatService,
    choiceService: deps.choiceService,
    workspaceResolver: deps.workspaceResolver,
    fileTreeNotifier: deps.fileTreeNotifier,
    stateStore: deps.stateStore
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
  
  // Transfer API
  if (deps.transferService && deps.stateStore) {
    router.use(createTransferRoutes({
      transferService: deps.transferService,
      stateStore: deps.stateStore,
      workspaceResolver: deps.workspaceResolver,
    }));
  }
  
  // Organization member exploration API
  if (deps.workspaceResolver) {
    router.use(createOrgRoutes({
      workspaceResolver: deps.workspaceResolver,
    }));
  }
  
  return router;
}
