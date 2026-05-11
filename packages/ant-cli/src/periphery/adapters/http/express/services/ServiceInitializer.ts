import { 
  KanbanService,
  SessionService, 
  ProjectService,
  GraphMetadataService,
  WorkflowStateService,
  ChatService,
  GitWatcherService
} from '../../services';
import { GitStateBroadcaster } from '../../../../../core/realtime/GitStateBroadcaster';
import { GitHubAuthService } from '../../../auth/GitHubAuthService';
import { FileJobPrerequisitesAdapter } from '../../../prerequisites/FileJobPrerequisitesAdapter';
import { WorkspaceServiceAdapter } from '../../../../../infrastructure/workspace/WorkspaceServiceAdapter';
import { WorkspaceServicePort } from '../../../../../core/ports/workspace';
import { AuthService } from '../../../../../infrastructure/auth/AuthService';
import { GoogleOIDCService } from '../../../../../infrastructure/auth/GoogleOIDCService';
import { createJwtServiceFromEnv } from '../../../../../infrastructure/auth/JwtService';
import { PortManager } from '../../../../../infrastructure/networking/PortManager';
import { IDEOrchestratorPort } from '../../../../../core/ports/ideOrchestrator';
import { logger } from '../../../../../utils/logger';
import { ServerConfig, ServerDependencies } from '../types';
import { getInfrastructureFactory } from '../../../../../infrastructure/adapters/InfrastructureFactory';
import { PortRegistryPort } from '../../../../../core/ports/portRegistry';
import { ArtifactTransferService } from '../../../../../infrastructure/workspace/ArtifactTransferService';
import { RedisStateStore } from '../../../../../infrastructure/state/RedisStateStore';
import { startDebugRetentionTimer } from '../../../../../core/maintenance/debugRetentionTimer';

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
  
  // Use IDEOrchestratorPort: K8s mode → KubernetesIDEOrchestrator, local → LocalIDEOrchestrator (Docker)
  // This avoids Docker socket access in K8s pods where /var/run/docker.sock doesn't exist
  factory.setDependencies(portManager, portRegistry);
  const ideOrchestrator: IDEOrchestratorPort = factory.getIDEOrchestrator();
  ideOrchestrator.startIdleCheck();
  logger.info(`IDE Orchestrator: ${ideOrchestrator.constructor.name}`, { component: 'ServiceInitializer' });
  
  // Initialize AuthService + JWT for Cloud mode
  let authService: AuthService | undefined;
  let oidcService: GoogleOIDCService | undefined;
  const jwtService = config.mode === 'cloud' ? createJwtServiceFromEnv() : undefined;
  
  if (config.mode === 'cloud') {
    authService = new AuthService();
    
    if (jwtService) {
      logger.info('JWT authentication enabled', { component: 'ServiceInitializer' });
    } else {
      logger.warn('ANT_JWT_SECRET not set - JWT authentication disabled in cloud mode', { 
        component: 'ServiceInitializer' 
      });
    }
    
    // Initialize Google OIDC service if credentials are provided.
    //
    // OAuth redirect_uri must land on the BE host. In same-origin cloud
    // deployments (Persona B managed / Persona C single-host) FE and BE
    // share an origin, so `FRONTEND_URL` is the right BE fallback too.
    // Split-host operators set `GOOGLE_REDIRECT_URI` explicitly to the BE
    // host. The legacy `CLOUD_URL` env (pointed at `https://ant.nexus.ai`
    // by default) was removed — it was an unsupported third source of
    // truth that silently misrouted callbacks when unset.
    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
    // Strip trailing slash so `FRONTEND_URL=https://x.io/` doesn't compose
    // a `https://x.io//api/auth/google/callback` that Google's exact-match
    // redirect_uri check would reject.
    const frontendUrl = process.env.FRONTEND_URL?.replace(/\/+$/, '');
    const googleRedirectUri =
      process.env.GOOGLE_REDIRECT_URI ||
      (frontendUrl ? `${frontendUrl}/api/auth/google/callback` : undefined);
    
    if (googleClientId && googleClientSecret && googleRedirectUri) {
      oidcService = new GoogleOIDCService({
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        redirectUri: googleRedirectUri
      });
      logger.info(`Google OIDC authentication enabled (redirect_uri=${googleRedirectUri})`, {
        component: 'ServiceInitializer'
      });
    } else if (googleClientId && googleClientSecret && !googleRedirectUri) {
      logger.warn(
        'Google OIDC: GOOGLE_CLIENT_ID/SECRET set but redirect_uri unresolved. ' +
        'Set GOOGLE_REDIRECT_URI explicitly, or set FRONTEND_URL (used as BE ' +
        'host in same-origin cloud deployments).',
        { component: 'ServiceInitializer' }
      );
    } else {
      logger.warn('Google OIDC not configured - set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET', {
        component: 'ServiceInitializer'
      });
    }
  }
  
  // Get stateStore for Redis-based services
  const stateStore = factory.getStateStore();

  // GitWatcherService publishes `gitChange` events only through
  // GitStateBroadcaster — piggybacking on the shared stateStore.publish so
  // no extra Redis connection is opened here.
  const gitStateBroadcaster = new GitStateBroadcaster({
    publisher: (channel, payload) => stateStore.publish(channel, payload),
  });
  const gitWatcherService = new GitWatcherService(workspaceResolver, gitStateBroadcaster);
  
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
    ideOrchestrator,
    stateStore,
    factory.getJobQueue(),
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
  
  // Initialize ArtifactTransferService
  const transferService = new ArtifactTransferService(
    workspaceResolver, 
    stateStore as unknown as RedisStateStore
  );

  // Periodic debug-artifact retention sweep (sessions/{agent}/debug/*).
  // Independent of IDE pod existence — debug files accumulate even after
  // a feature's IDE has terminated.
  startDebugRetentionTimer({
    workspacesPath: config.workspacesPath,
    stateStore,
  });
  
  return {
    workspaceService,
    workspaceResolver,
    authService,
    oidcService,
    jwtService,
    portManager,
    portRegistry,
    ideService: ideOrchestrator,
    kanbanService,
    sessionService,
    gitWatcherService,
    gitStateBroadcaster,
    projectService,
    chatService,
    graphMetadataService,
    workflowStateService,
    githubAuthService,
    jobPrerequisitesAdapter,
    transferService
  };
}
