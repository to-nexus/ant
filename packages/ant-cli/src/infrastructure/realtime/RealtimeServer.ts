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
 * 
 * @see docs/architecture/10-cloud-architecture.md
 */

import express, { Express, Request, Response } from 'express';
import cors from 'cors';
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
    this.setupRoutes(services);
    
    // 5. Setup health check
    this.setupHealthCheck();
    
    // 6. Start server
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.config.port, () => {
          logger.info(`🚀 Realtime Server running on port ${this.config.port}`, { 
            component: 'RealtimeServer'
          }, { port: this.config.port });
          resolve(this.server!);
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
    // CORS configuration
    const corsOrigins = this.config.corsOrigins || [
      'https://ant.crosstoken.io',
      'https://ant-server.crosstoken.io',
      'https://ant-preview.crosstoken.io',
      'https://*.crosstoken.io',
    ];
    
    this.app.use(cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (same-origin, Postman, etc.)
        if (!origin) {
          return callback(null, true);
        }
        
        // Check if origin is in allowed list or matches pattern
        if (corsOrigins.some(allowed => {
          if (allowed.includes('*')) {
            const pattern = new RegExp('^' + allowed.replace(/\*/g, '.*') + '$');
            return pattern.test(origin);
          }
          return allowed === origin;
        })) {
          return callback(null, true);
        }
        
        // Allow any localhost origin in development
        if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
          return callback(null, true);
        }
        
        callback(new Error(`CORS not allowed for origin: ${origin}`));
      },
      credentials: true,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'x-user-email', 'Authorization']
    }));
    
    // Parse JSON for non-SSE routes
    this.app.use(express.json({ limit: '10mb' }));
    
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
  }): void {
    const sseRoutes = createSSERoutes({
      sseService: this.sseService,
      kanbanService: services.kanbanService,
      chatService: services.chatService,
      projectService: services.projectService,
      workflowStateService: services.workflowStateService,
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
  }
  
  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
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
