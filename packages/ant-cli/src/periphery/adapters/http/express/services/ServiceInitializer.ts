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
import { createJwtServiceFromEnv } from '../../../../../infrastructure/auth/JwtService';
import type { AuthPort } from '../../../../../core/ports/auth';
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
  
  // Cloud auth wiring. JwtService is a neutral OSS HS256 primitive (no
  // commercial secret) — `createJwtServiceFromEnv()` returns undefined when
  // ANT_JWT_SECRET is unset (local mode), so JWT auth is naturally absent
  // there. It is threaded through `deps.jwtService` for WS auth, jwtAuth
  // middleware, and the cloud auth routes.
  //
  // AuthService now lives in `@ant/cloud`; it is obtained via the cloud seam
  // (real in cloud mode, null in OSS/local). WS auth (ExpressServerAdapter)
  // consumes `deps.authService` as an `AuthPort`. The Google OIDC service is
  // no longer constructed here — the cloud overlay's `registerRoutes` is its
  // single owner (`buildOidcServiceFromEnv`).
  const jwtService = config.mode === 'cloud' ? createJwtServiceFromEnv() : undefined;
  const authService: AuthPort | undefined =
    config.mode === 'cloud' ? factory.getCloudModule()?.createAuthService() : undefined;

  if (config.mode === 'cloud') {
    if (jwtService) {
      logger.info('JWT authentication enabled', { component: 'ServiceInitializer' });
    } else {
      logger.warn('ANT_JWT_SECRET not set - JWT authentication disabled in cloud mode', {
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
