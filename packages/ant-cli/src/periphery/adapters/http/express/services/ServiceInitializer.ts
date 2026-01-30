import { 
  KanbanService,
  SessionService, 
  PreviewService, 
  ProjectService,
  GraphMetadataService,
  WorkflowStateService,
  ChatService,
  SSEService,
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
import { StateStorePort } from '../../../../../core/ports/stateStore';
import type { UserContext } from '../../../../../core/types/user';

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
  
  // Initialize core services
  const sseService = new SSEService();
  const gitWatcherService = new GitWatcherService(
    sseService, 
    workspaceResolver
  );
  
  // Get stateStore for Redis Pub/Sub broadcasting
  const stateStore = factory.getStateStore();
  
  const chatService = new ChatService(
    config.workspacesPath, 
    stateStore,  // ✅ Use Redis for cross-instance broadcasting
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
  
  const previewService = new PreviewService(
    portManager,
    portRegistry,
    {
      onStatusChange: (projectId: string) => {
        // Preview status broadcasting removed
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
  
  // ✅ Subscribe to job status updates via Redis Pub/Sub
  // This enables SSE broadcast of job completion/failure events to UI clients
  // (Always enabled since we always use Redis)
  setupJobStatusSubscription(sseService);
  
  // ✅ Setup all SSE broadcast subscriptions via Redis Pub/Sub
  // This enables cross-instance SSE broadcasting for chat, kanban, fileTree, workflow, etc.
  sseService.setupBroadcastSubscriptions(stateStore);
  
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
    previewService,
    projectService,
    chatService,
    graphMetadataService,
    workflowStateService,
    sseService,
    githubAuthService,
    jobPrerequisitesAdapter
  };
}

/**
 * Setup Redis Pub/Sub subscription for job status updates (Cloud mode only)
 * 
 * BullMQJobQueue publishes job completion/failure events to 'job:status:updates' channel.
 * This function subscribes to that channel and broadcasts to UI via SSE.
 */
async function setupJobStatusSubscription(sseService: SSEService): Promise<void> {
  try {
    const factory = getInfrastructureFactory();
    const stateStore = factory.getStateStore() as StateStorePort;
    
    // Subscribe to global job status channel
    await stateStore.subscribe('job:status:updates', (message: unknown) => {
      const data = message as {
        type: 'completed' | 'failed';
        jobId: string;
        status: string;
        projectId?: string;
        featureName?: string;
        userEmail?: string;
        result?: any;
        error?: string;
        timestamp: string;
      };
      
      logger.debug(`Received job status update: ${data.jobId} (${data.type})`, { 
        component: 'ServiceInitializer',
        projectId: data.projectId,
        featureName: data.featureName
      });
      
      // Broadcast to SSE clients if we have project/feature info
      if (data.projectId && data.featureName) {
        // Construct UserContext from userEmail (format: userId@orgId)
        let userContext: UserContext | undefined;
        if (data.userEmail) {
          const [userId, organizationId] = data.userEmail.split('@');
          if (userId && organizationId) {
            userContext = { userId, organizationId, workspacePath: '' };
          }
        }
        
        // Broadcast job status as 'chat' type message (UI handles this for stop button)
        // ✅ Use 'type: job_status' to match UI's switch statement
        sseService.broadcast(
          data.projectId,
          data.featureName,
          'chat',
          {
            type: 'job_status',  // For switch statement
            action: 'job_status',  // For additional check
            projectId: data.projectId,
            featureName: data.featureName,
            jobId: data.jobId,
            status: data.status,
            result: data.result,
            error: data.error,
            timestamp: data.timestamp
          },
          userContext
        );
        
        logger.info(`Broadcasted job ${data.type} to SSE: ${data.jobId}`, { 
          component: 'ServiceInitializer',
          projectId: data.projectId,
          featureName: data.featureName
        });
      } else {
        logger.warn(`Job status update missing project/feature info: ${data.jobId}`, { 
          component: 'ServiceInitializer' 
        });
      }
    });
    
    logger.info('Subscribed to job:status:updates channel for SSE broadcast', { 
      component: 'ServiceInitializer' 
    });
  } catch (error) {
    logger.error('Failed to setup job status subscription', { component: 'ServiceInitializer' }, error);
  }
}
