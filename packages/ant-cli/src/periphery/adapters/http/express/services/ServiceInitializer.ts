import { 
  KanbanService,
  SessionService, 
  DevServerService, 
  ProjectService,
  GraphMetadataService,
  WorkflowStateService,
  ChatService,
  SSEService
} from '../../services';
import { GitHubAuthService } from '../../../auth/GitHubAuthService';
import { FileJobPrerequisitesAdapter } from '../../../prerequisites/FileJobPrerequisitesAdapter';
import { WorkspaceServiceAdapter } from '../../../../../infrastructure/workspace/WorkspaceServiceAdapter';
import { WorkspaceServicePort } from '../../../../../core/ports/workspace';
import { AuthService } from '../../../../../infrastructure/auth/AuthService';
import { GoogleOIDCService } from '../../../../../infrastructure/auth/GoogleOIDCService';
import { PortManager } from '../../../../../infrastructure/networking/PortManager';
import { InMemoryPortRegistry } from '../../../../../infrastructure/networking/InMemoryPortRegistry';
import { IDEService } from '../../../ide/IDEService';
import { logger } from '../../../../../utils/logger';
import { ServerConfig, ServerDependencies } from '../types';

/**
 * Initialize all services and dependencies for the Express server
 */
export function initializeServices(
  config: ServerConfig,
  workspaceService: WorkspaceServicePort
): ServerDependencies {
  // Create WorkspaceResolver adapter for legacy services
  const workspaceResolver = new WorkspaceServiceAdapter(
    workspaceService, 
    config.workspacesPath
  );
  
  // Initialize PortManager, PortRegistry, and IDEService
  const portManager = new PortManager();
  const portRegistry = new InMemoryPortRegistry();
  const ideService = new IDEService(portManager, portRegistry);
  ideService.startIdleChecker();
  
  // Initialize AuthService for Cloud mode
  let authService: AuthService | undefined;
  let oidcService: GoogleOIDCService | undefined;
  
  if (config.mode === 'cloud') {
    authService = new AuthService();
    
    // Initialize Google OIDC service if credentials are provided
    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const googleRedirectUri = process.env.GOOGLE_REDIRECT_URI || `${config.cloudUrl}/api/auth/google/callback`;
    
    if (googleClientId && googleClientSecret) {
      oidcService = new GoogleOIDCService({
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        redirectUri: googleRedirectUri
      });
      logger.info('Google OIDC authentication enabled', { component: 'ServiceInitializer' });
    } else {
      logger.warn('Google OIDC not configured - set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET', { 
        component: 'ServiceInitializer' 
      });
    }
  }
  
  // Initialize core services
  const sseService = new SSEService();
  const gitWatcherService = new (require('../../services/GitWatcherService').GitWatcherService)(
    sseService, 
    workspaceResolver
  );
  const chatService = new ChatService(
    config.workspacesPath, 
    sseService, 
    workspaceResolver
  );
  const githubAuthService = new GitHubAuthService(config.workspacesPath);
  const projectService = new ProjectService(
    workspaceResolver, 
    githubAuthService, 
    chatService, 
    sseService, 
    ideService
  );
  const kanbanService = new KanbanService(config.workspacesPath, workspaceResolver);
  
  const devServerService = new DevServerService(
    portManager,
    portRegistry,
    {
      onStatusChange: (projectId: string) => {
        // DevServer status broadcasting removed
      }
    },
    sseService
  );
  
  const graphMetadataService = new GraphMetadataService();
  const workflowStateService = new WorkflowStateService(sseService);
  
  // SessionService with onSessionChange callback
  const sessionService = new SessionService(
    config.workspacesPath, 
    {
      onSessionChange: async (projectId: string, featureName: string, jobType: string) => {
        // Session change handler will be set up by the adapter
        // This is a placeholder that will be overridden
      }
    }, 
    workspaceResolver
  );
  
  const jobPrerequisitesAdapter = new FileJobPrerequisitesAdapter(workspaceResolver);
  
  return {
    workspaceService,
    workspaceResolver,
    authService,
    oidcService,
    portManager,
    portRegistry,
    ideService,
    kanbanService,
    sessionService,
    gitWatcherService,
    devServerService,
    projectService,
    chatService,
    graphMetadataService,
    workflowStateService,
    sseService,
    githubAuthService,
    jobPrerequisitesAdapter
  };
}
