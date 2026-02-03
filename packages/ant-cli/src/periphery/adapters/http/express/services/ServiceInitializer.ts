import { 
  KanbanService,
  SessionService, 
  ProjectService,
  GraphMetadataService,
  WorkflowStateService,
  ChatService,
  GitWatcherService
} from '../../services';
import { GitHubAuthService } from '../../../auth/GitHubAuthService';
import { FileJobPrerequisitesAdapter } from '../../../prerequisites/FileJobPrerequisitesAdapter';
import { WorkspaceServiceAdapter } from '../../../../../infrastructure/workspace/WorkspaceServiceAdapter';
import { WorkspaceServicePort } from '../../../../../core/ports/workspace';
import { AuthService } from '../../../../../infrastructure/auth/AuthService';
import { GoogleOIDCService } from '../../../../../infrastructure/auth/GoogleOIDCService';
import { PortManager } from '../../../../../infrastructure/networking/PortManager';
import { IDEService } from '../../../ide/IDEService';
import { logger } from '../../../../../utils/logger';
import { ServerConfig, ServerDependencies } from '../types';
import { getInfrastructureFactory } from '../../../../../infrastructure/adapters/InfrastructureFactory';
import { PortRegistryPort } from '../../../../../core/ports/portRegistry';

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
  
  // Initialize PortManager and PortRegistry
  // Always use RedisStateStore as PortRegistry (it implements both StateStorePort and PortRegistryPort)
  const portManager = new PortManager();
  const factory = getInfrastructureFactory();
  const portRegistry: PortRegistryPort = factory.getStateStore() as unknown as PortRegistryPort;
  logger.info('Using RedisStateStore as PortRegistry', { component: 'ServiceInitializer' });
  
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
  
  // Get stateStore for Redis-based services
  const stateStore = factory.getStateStore();
  
  // Initialize core services (SSE handled by dedicated Realtime Server)
  const gitWatcherService = new GitWatcherService(workspaceResolver, stateStore);
  
  const chatService = new ChatService(
    config.workspacesPath, 
    stateStore,
    workspaceResolver
  );
  const githubAuthService = new GitHubAuthService(config.workspacesPath);
  const projectService = new ProjectService(
    workspaceResolver, 
    githubAuthService, 
    chatService, 
    ideService
  );
  const kanbanService = new KanbanService(config.workspacesPath, workspaceResolver, stateStore);
  
  // Note: PreviewService moved to ant-preview (see 10-cloud-architecture.md)
  
  const graphMetadataService = new GraphMetadataService();
  const workflowStateService = new WorkflowStateService(stateStore);
  
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
    projectService,
    chatService,
    graphMetadataService,
    workflowStateService,
    githubAuthService,
    jobPrerequisitesAdapter
  };
}
