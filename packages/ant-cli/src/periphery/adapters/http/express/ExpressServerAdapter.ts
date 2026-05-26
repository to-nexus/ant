import express, { Express } from 'express';
import { 
  HttpServerPort, 
  JobExecutionPort, 
  ExecuteJobParams, 
  JobResult, 
  JobStatus, 
  LogEntry,
  TaskQueueUpdatePort,
  FileTreeUpdatePort
} from '../../../../core/ports';
import type { InterruptionDetails } from '../../../../core/types';
import { UserContext } from '../../../../core/types/user';
import { WorkspaceServicePort } from '../../../../core/ports/workspace';
import { logger } from '../../../../utils/logger';
import { createIDEWebSocketHandler } from '../middleware/ideProxy';
import { JwtService } from '../../../../infrastructure/auth/JwtService';
import { initializeRateLimiters } from '../middleware/rateLimiter';

// Configuration and Types
import { ServerConfig, ServerDependencies } from './types';

// Configuration Modules
import { ServerConfigurator } from './config/ServerConfigurator';
import { RouteConfigurator } from './config/RouteConfigurator';

// Manager Modules
import { JobStateTracker } from './managers/JobStateTracker';
import { JobExecutionManager } from './managers/JobExecutionManager';
import { JobCleanupManager } from './managers/JobCleanupManager';
import { SessionFileWatcher } from './managers/SessionFileWatcher';

// Bridge Modules
import { WorkflowBridge } from './bridges/WorkflowBridge';

// Lifecycle Modules
import { ServerLifecycleManager } from './lifecycle/ServerLifecycleManager';
import { recoverStaleJobs } from './lifecycle/StaleJobRecovery';

// Service Initialization
import { initializeServices } from './services/ServiceInitializer';

/**
 * ExpressServerAdapter
 * 
 * Hexagonal Architecture - Adapter Layer (Refactored)
 * 
 * Main orchestrator that coordinates specialized sub-modules:
 * - ServerConfigurator: HTTP server configuration (CORS, middleware, auth)
 * - RouteConfigurator: Route registration and endpoint setup
 * - JobStateTracker: In-memory job state management
 * - JobExecutionManager: Job execution lifecycle
 * - JobCleanupManager: Job cleanup and session persistence
 * - SessionFileWatcher: Session file monitoring
 * - WorkflowBridge: Workflow state updates and broadcasting
 * - ServerLifecycleManager: Graceful shutdown and cleanup
 * 
 * This class is now thin and delegates all responsibilities to specialized modules.
 */
export class ExpressServerAdapter implements 
  HttpServerPort, 
  JobExecutionPort, 
  TaskQueueUpdatePort, 
  FileTreeUpdatePort
{
  private app: Express;
  private server: any;
  private running: boolean = false;
  
  // Singleton instance for global access
  private static instance: ExpressServerAdapter | null = null;
  
  // Configuration
  private readonly config: ServerConfig;
  
  // Dependencies (services)
  private readonly deps: ServerDependencies;
  
  // Sub-modules (specialized components)
  private readonly stateTracker: JobStateTracker;
  private readonly jobManager: JobExecutionManager;
  private readonly cleanupManager: JobCleanupManager;
  private readonly sessionWatcher: SessionFileWatcher;
  private readonly workflowBridge: WorkflowBridge;
  private readonly lifecycleManager: ServerLifecycleManager;
  private readonly serverConfigurator: ServerConfigurator;
  private readonly routeConfigurator: RouteConfigurator;

  constructor(
    mode: 'local' | 'cloud' = 'local',
    workspacesPath: string,
    workspaceService: WorkspaceServicePort
  ) {
    this.app = express();

    // Initialize configuration
    this.config = { mode, workspacesPath };
    
    // Initialize dependencies (services)
    this.deps = initializeServices(this.config, workspaceService);
    
    logger.info(`Initialized in ${mode.toUpperCase()} mode`, { 
      component: 'ExpressServerAdapter' 
    }, {
      workspacesPath: this.config.workspacesPath,
      workspaceService: this.deps.workspaceService.constructor.name,
      portManager: this.deps.portManager.constructor.name,
      portRegistry: this.deps.portRegistry.constructor.name,
      ideService: this.deps.ideService.constructor.name,
      oidcEnabled: !!this.deps.oidcService
    });
    
    // Initialize sub-modules
    this.stateTracker = new JobStateTracker();
    
    this.cleanupManager = new JobCleanupManager(this.stateTracker, this.deps);
    
    this.jobManager = new JobExecutionManager(
      this.stateTracker,
      this.deps,
      this.cleanupManager.cleanupJobState.bind(this.cleanupManager)
    );
    
    this.sessionWatcher = new SessionFileWatcher(this.stateTracker, this.deps);
    
    this.workflowBridge = new WorkflowBridge(this.stateTracker, this.deps);
    
    this.lifecycleManager = new ServerLifecycleManager(
      this.stateTracker,
      this.deps,
      this.cleanupManager.cleanupJobState.bind(this.cleanupManager)
    );
    
    this.serverConfigurator = new ServerConfigurator(this.config, this.deps);
    
    this.routeConfigurator = new RouteConfigurator(
      this.config,
      this.deps,
      this.stateTracker,
      this.jobManager,
      this.workflowBridge,
      this.cleanupManager.cleanupJobState.bind(this.cleanupManager),
      this.sessionWatcher.watchSessionFile.bind(this.sessionWatcher)
    );
    
    // Configure Express app
    this.serverConfigurator.configure(this.app);
    this.routeConfigurator.configure(this.app);
    
    ExpressServerAdapter.instance = this;
  }
  
  // =====================================
  // Static Methods
  // =====================================
  
  /**
   * Get singleton instance
   */
  static getInstance(): ExpressServerAdapter | null {
    return ExpressServerAdapter.instance;
  }
  
  /**
   * Get current job ID (for CLI subprocess)
   */
  static getCurrentJobId(): string | null {
    // Priority 1: Environment variable (for child processes)
    if (process.env.ANT_JOB_ID) {
      return process.env.ANT_JOB_ID;
    }
    // Priority 2: Instance (for parent process)
    return ExpressServerAdapter.instance?.stateTracker.getCurrentJobId() || null;
  }
  
  // =====================================
  // JobExecutionPort Implementation
  // =====================================
  
  async executeJob(params: ExecuteJobParams): Promise<JobResult> {
    return this.jobManager.executeJob(params);
  }
  
  getJobStatus(jobId: string): JobStatus | undefined {
    return this.jobManager.getJobStatus(jobId);
  }
  
  getLogs(jobId: string): LogEntry[] {
    return this.jobManager.getLogs(jobId);
  }
  
  async *streamLogs(jobId: string): AsyncIterableIterator<LogEntry> {
    yield* this.jobManager.streamLogs(jobId);
  }
  
  // =====================================
  // TaskQueueUpdatePort Implementation
  // =====================================
  
  updateTaskQueue(
    jobId: string, 
    currentTask: any, 
    queue: any[], 
    completedTasks?: any[],
    recursionCount?: number,
    recursionLimit?: number,
    tokenUsage?: { 
      inputTokens: number; 
      outputTokens: number; 
      totalTokens: number; 
      cacheReadTokens?: number; 
      cacheCreationTokens?: number;
    }
  ): void {
    this.workflowBridge.updateTaskQueue(
      jobId, 
      currentTask, 
      queue, 
      completedTasks, 
      recursionCount, 
      recursionLimit, 
      tokenUsage
    );
  }
  
  // =====================================
  // FileTreeUpdatePort Implementation
  // =====================================
  
  async notifyFileTreeUpdate(projectId: string, featureName: string, userContext?: any): Promise<void> {
    await this.workflowBridge.notifyFileTreeUpdate(projectId, featureName, userContext);
  }
  
  // =====================================
  // HttpServerPort Implementation
  // =====================================
  
  async start(port: number): Promise<void> {
    // Bootstrap-time init of every rate limiter — MUST run before the
    // server starts accepting connections so that limiter middleware
    // mounted on routes (auth, job, chat, organizations) delegates to
    // the real `rateLimit({...})` handler instead of the no-op
    // passthrough proxy. InfrastructureFactory is initialized by the
    // process entry point before `ExpressServerAdapter.start()` runs.
    initializeRateLimiters();

    // Run stale job recovery BEFORE accepting connections so that Redis
    // state is clean by the time the Realtime server (or any client) reads it.
    try {
      await recoverStaleJobs({
        cleanupJobState: this.cleanupManager.cleanupJobState.bind(this.cleanupManager),
        stateTracker: this.stateTracker,
        kanbanService: this.deps.kanbanService,
      });
    } catch (err) {
      logger.warn('Stale job recovery error (non-fatal)', { component: 'ExpressServerAdapter' }, err);
    }

    await new Promise<void>((resolve, reject) => {
      try {
        this.server = this.app.listen(port, () => {
          this.running = true;
          resolve();
        });
        
        // Setup WebSocket upgrade handler for IDE proxy
        const ideWsHandler = createIDEWebSocketHandler(this.deps.portRegistry, '/ide');
        const wsJwtService = this.deps.jwtService;
        const wsAuthService = this.deps.authService;
        this.server.on('upgrade', (req: any, socket: any, head: Buffer) => {
          const url = req.url || '';
          if (!url.startsWith('/ide/')) {
            socket.destroy();
            return;
          }

          // Cloud mode: verify JWT cookie before allowing WebSocket upgrade
          if (wsAuthService && wsJwtService) {
            const cookieHeader = req.headers?.cookie || '';
            const cookieName = JwtService.cookieName;
            const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${cookieName}=([^;]*)`));
            const token = match?.[1];
            if (!token) {
              logger.warn('IDE WebSocket upgrade rejected: no JWT cookie', { component: 'IDEProxy' });
              socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
              socket.destroy();
              return;
            }
            try {
              wsJwtService.verify(token);
            } catch {
              logger.warn('IDE WebSocket upgrade rejected: invalid JWT', { component: 'IDEProxy' });
              socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
              socket.destroy();
              return;
            }
          }

          ideWsHandler(req, socket, head);
        });
      } catch (error) {
        reject(error);
      }
    });
  }
  
  async stop(): Promise<void> {
    // Prevent duplicate stop calls
    if (!this.running) {
      logger.debug('Server already stopped, skipping...', { component: 'ExpressServerAdapter' });
      return;
    }
    
    await this.lifecycleManager.shutdown();
    
    // Close HTTP server
    return new Promise((resolve) => {
      if (!this.server || !this.server.listening) {
        this.running = false;
        resolve();
        return;
      }
      
      logger.info('Closing HTTP server...', { component: 'ExpressServerAdapter' });
      
      this.server.close((err?: Error) => {
        if (err && (err as any).code !== 'ERR_SERVER_NOT_RUNNING') {
          logger.warn('Error closing HTTP server', { component: 'ExpressServerAdapter' }, err);
        } else if (!err) {
          logger.info('HTTP server closed', { component: 'ExpressServerAdapter' });
        }
        this.running = false;
        resolve();
      });
    });
  }
  
  isRunning(): boolean {
    return this.running;
  }
}
