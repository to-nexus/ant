/**
 * RealtimeServer
 * 
 * Dedicated SSE server for real-time updates.
 * Separated from API Server for independent scaling with Sticky Session.
 * 
 * Features:
 * - Feature SSE: /api/projects/:id/features/:feature/stream
 * - Workflow SSE: /api/jobs/:jobId/workflow/stream
 * - Redis Pub/Sub subscription for cross-pod message delivery
 * - JWT cookie authentication (shared with ant-api and ant-preview)
 * 
 * @see docs/architecture/10-cloud-architecture.md
 */

import express, { Express, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { createCorsMiddleware } from '../../periphery/adapters/http/middleware/corsConfig';
import { createJwtAuthMiddleware } from '../../periphery/adapters/http/middleware/jwtAuth';
import { createJwtServiceFromEnv, JwtService } from '../auth/JwtService';
import { createSSERoutes } from '../../periphery/adapters/http/routes';
import { 
  SSEService, 
  KanbanService, 
  ChatService, 
  ProjectService, 
  WorkflowStateService,
  GitWatcherService
} from '../../periphery/adapters/http/services';
import { getInfrastructureFactory } from '../adapters/InfrastructureFactory';
import { UnifiedWorkspaceResolver } from '../workspace/WorkspaceResolver';
import { BridgeWebSocketHandler } from './BridgeWebSocketHandler';
import { logger } from '../../utils/logger';
import http from 'http';

export interface RealtimeServerConfig {
  port: number;
  workspacesPath: string;
  corsOrigins?: string[];
}

export class RealtimeServer {
  private app: Express;
  private server: http.Server | null = null;
  private sseService: SSEService;
  private bridgeHandler: BridgeWebSocketHandler | null = null;
  private config: RealtimeServerConfig;
  
  constructor(config: RealtimeServerConfig) {
    this.config = config;
    this.app = express();
    this.sseService = new SSEService();
  }
  
  /**
   * Initialize and start the Realtime Server
   */
  async start(): Promise<http.Server> {
    // 1. Setup middleware
    this.setupMiddleware();
    
    // 2. Setup services
    const services = await this.setupServices();
    
    // 3. Setup Redis Pub/Sub subscriptions (CRITICAL!)
    const stateStore = getInfrastructureFactory().getStateStore();
    await this.sseService.setupBroadcastSubscriptions(stateStore);
    logger.info('✅ Redis Pub/Sub subscriptions established', { component: 'RealtimeServer' });
    
    // 4. Setup SSE routes
    this.setupRoutes(services, stateStore);
    
    // 5. Setup health check
    this.setupHealthCheck();
    
    // 6. Setup Bridge WebSocket handler for Ant Desktop
    this.bridgeHandler = new BridgeWebSocketHandler({ stateStore });
    logger.info('Bridge WebSocket handler initialized', { component: 'RealtimeServer' });
    
    // 7. Start server
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.config.port, () => {
          logger.info(`🚀 Realtime Server running on port ${this.config.port}`, { 
            component: 'RealtimeServer'
          }, { port: this.config.port });
          resolve(this.server!);
        });
        
        // Register WebSocket upgrade handler for /bridge/ws
        this.server.on('upgrade', (req, socket, head) => {
          const upgradeUrl = req.url || '(empty)';
          const hasUpgradeHeader = !!req.headers['upgrade'];
          const hasAuthHeader = !!req.headers['authorization'];
          const shouldHandle = this.bridgeHandler?.shouldHandle(req) ?? false;

          logger.warn(`🔌 [BridgeDiag] upgrade event: path=${upgradeUrl} upgrade=${hasUpgradeHeader} auth=${hasAuthHeader} shouldHandle=${shouldHandle}`, { component: 'RealtimeServer' });

          if (shouldHandle) {
            this.bridgeHandler!.handleUpgrade(req, socket, head);
          } else {
            logger.warn(`🔌 [BridgeDiag] upgrade rejected — destroying socket: path=${upgradeUrl}`, { component: 'RealtimeServer' });
            socket.destroy();
          }
        });
        
        this.server.on('error', (error) => {
          logger.error('Failed to start Realtime Server', { component: 'RealtimeServer' }, error);
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }
  
  /**
   * Setup Express middleware
   */
  private setupMiddleware(): void {
    if (process.env.NODE_ENV === 'production') {
      this.app.set('trust proxy', 1);
    }

    // Shared CORS configuration (same as ant-api and ant-preview)
    this.app.use(createCorsMiddleware());
    
    // Security headers
    this.app.use(helmet({
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: false,
    }));
    
    // Cookie parser (required for JWT cookie auth)
    this.app.use(cookieParser());
    
    // Parse JSON for non-SSE routes
    this.app.use(express.json({ limit: '10mb' }));
    
    // JWT cookie authentication (cloud mode only)
    const isCloudMode = process.env.ANT_SERVER_MODE === 'cloud';
    if (isCloudMode) {
      const jwtService = createJwtServiceFromEnv();
      if (!jwtService) {
        throw new Error('ANT_JWT_SECRET is required in cloud mode. Set the environment variable to enable authentication.');
      }
      this.app.use(createJwtAuthMiddleware({
        jwtService,
        publicPaths: [
          '/health',
          '/api/health',
          '/bridge/health',
        ],
        publicPrefixes: [],
      }));
      logger.info('JWT authentication enabled for Realtime Server', { component: 'RealtimeServer' });
    }
    
    logger.debug('Middleware configured', { component: 'RealtimeServer' });
  }
  
  /**
   * Setup services required for SSE routes
   */
  private async setupServices(): Promise<{
    kanbanService: KanbanService;
    chatService: ChatService;
    projectService: ProjectService;
    workflowStateService: WorkflowStateService;
    gitWatcherService: GitWatcherService;
  }> {
    const stateStore = getInfrastructureFactory().getStateStore();
    const workspaceResolver = new UnifiedWorkspaceResolver(this.config.workspacesPath);
    
    // Initialize services - SSE communication via Redis Pub/Sub
    const kanbanService = new KanbanService(this.config.workspacesPath, workspaceResolver, stateStore);
    const chatService = new ChatService(this.config.workspacesPath, stateStore, workspaceResolver);
    const projectService = new ProjectService(workspaceResolver, undefined, chatService);
    const workflowStateService = new WorkflowStateService(stateStore);
    const gitWatcherService = new GitWatcherService(workspaceResolver, stateStore);
    
    logger.debug('Services initialized', { component: 'RealtimeServer' });
    
    return {
      kanbanService,
      chatService,
      projectService,
      workflowStateService,
      gitWatcherService
    };
  }
  
  /**
   * Setup SSE routes
   */
  private setupRoutes(services: {
    kanbanService: KanbanService;
    chatService: ChatService;
    projectService: ProjectService;
    workflowStateService: WorkflowStateService;
    gitWatcherService: GitWatcherService;
  }, stateStore?: any): void {
    const sseRoutes = createSSERoutes({
      sseService: this.sseService,
      kanbanService: services.kanbanService,
      chatService: services.chatService,
      projectService: services.projectService,
      workflowStateService: services.workflowStateService,
      stateStore,
      gitWatcherService: services.gitWatcherService,
      // Note: These are empty Maps - in cloud mode, job state is in Redis
      // The SSE routes will still work because initial state comes from services
      jobToProject: new Map(),
      jobs: new Map(),
      taskQueueSnapshots: new Map()
    });
    
    // Mount SSE routes under /realtime (consistent path for dev & prod)
    this.app.use('/realtime', sseRoutes);
    
    logger.info('SSE routes mounted at /realtime', { component: 'RealtimeServer' });
  }
  
  /**
   * Setup health check endpoint
   */
  private setupHealthCheck(): void {
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({ 
        status: 'ok',
        service: 'realtime-server',
        timestamp: new Date().toISOString()
      });
    });
    
    this.app.get('/api/health', (req: Request, res: Response) => {
      res.json({ 
        status: 'ok',
        service: 'realtime-server',
        timestamp: new Date().toISOString()
      });
    });

    this.app.get('/bridge/health', (req: Request, res: Response) => {
      res.json({
        status: 'ok',
        service: 'realtime-server',
        bridge: 'reachable',
        timestamp: new Date().toISOString(),
      });
    });
  }
  
  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    // Close bridge WebSocket connections
    if (this.bridgeHandler) {
      await this.bridgeHandler.close();
    }

    // End all SSE connections and flush Redis counter adjustments before server.close()
    await this.sseService.closeAll();

    if (this.server) {
      await new Promise<void>((resolve) => {
        const SHUTDOWN_TIMEOUT_MS = 5000;
        const timeout = setTimeout(() => {
          logger.warn(`Shutdown timed out after ${SHUTDOWN_TIMEOUT_MS}ms, forcing exit`, { component: 'RealtimeServer' });
          resolve();
        }, SHUTDOWN_TIMEOUT_MS);

        this.server!.close(() => {
          clearTimeout(timeout);
          logger.info('Realtime Server stopped', { component: 'RealtimeServer' });
          resolve();
        });
      });
    }
  }
  
  /**
   * Get the Express app (for testing)
   */
  getApp(): Express {
    return this.app;
  }
  
  /**
   * Get SSE service (for testing/debugging)
   */
  getSSEService(): SSEService {
    return this.sseService;
  }
}

/**
 * Create and start a Realtime Server
 */
export async function createRealtimeServer(config: RealtimeServerConfig): Promise<RealtimeServer> {
  const server = new RealtimeServer(config);
  await server.start();
  return server;
}
