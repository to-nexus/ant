import { ChildProcess } from 'child_process';
import { Response } from 'express';
import * as path from 'path';
import * as os from 'os';
import { LogEntry } from '../../../../../core/ports/http';
import { PortManager } from '../../../../../infrastructure/networking/PortManager';
import { PortRegistryPort, PreviewState, PreviewPackage, PreviewPhase } from '../../../../../core/ports/portRegistry';
import type { StateStorePort } from '../../../../../core/ports/stateStore';
import { PreviewIssue, PreviewIssueReasoning, PackageInfo, ValidationResult } from './types';
import { createServerKey, parseServerKey, toUrlKey } from './utils/serverKeyUtils';
import { LogManager } from './managers/LogManager';
import { PackageDetector } from './detectors/PackageDetector';
import { ProjectValidator } from './validators/ProjectValidator';
import { ProjectStructureDetector } from './detectors/ProjectStructureDetector';
import { DependencyInstaller } from './managers/DependencyInstaller';
import { ProcessSpawner } from './managers/ProcessSpawner';
import { InfrastructureManager } from './managers/InfrastructureManager';
import { HealthChecker } from './utils/HealthChecker';
import { IssueDetector } from './detectors/IssueDetector';
import { logger } from '../../../../../utils/logger';
import { getRealtimeBroadcastChannel } from '../../../../../infrastructure/state';

// Idle timeout configuration
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const IDLE_CHECK_INTERVAL_MS = 60 * 1000; // Check every minute

// Distributed lock for preview operations (prevents multi-pod race)
const PREVIEW_LOCK_TTL_SECONDS = 120; // 2 minutes — covers npm install + startup
const PREVIEW_LOCK_PREFIX = 'ant:lock:preview:';

/**
 * PreviewService
 * 
 * Manages preview servers for projects at feature/branch level.
 * 
 * Key Features:
 * - Multi-package support: Starts ALL runnable packages (frontend, backend, etc.)
 * - Smart detection: Identifies project structure (fullstack, monorepo, etc.)
 * - Entry point: Only the entry package (usually frontend) is registered for proxy
 * - Port management: Dynamic port allocation for all servers
 * - Process management: Tracks and manages all running processes
 */
export class PreviewService {
  // State maps (only non-serializable / pod-local data)
  private previewServers: Map<string, ChildProcess[]> = new Map();  // Process handles (cannot serialize)
  private installingProjects: Set<string> = new Set();
  private previewServerPaths: Map<string, string> = new Map(); // serverKey -> localPath (for infrastructure cleanup)
  
  // Start/Stop state management
  private startingServers: Set<string> = new Set(); // serverKeys currently in startPreview
  private startCancelledServers: Set<string> = new Set(); // startPreview should abort after spawn
  private stoppingServers: Set<string> = new Set();
  private stoppingPidsByServer: Map<string, Set<number>> = new Map();
  private stoppingCleanupTimers: Map<string, NodeJS.Timeout> = new Map();
  
  // Idle check
  private idleCheckTimer: ReturnType<typeof setInterval> | null = null;
  private idleTimeoutMs: number = DEFAULT_IDLE_TIMEOUT_MS;
  
  // Dependencies
  private onStatusChange?: (serverKey: string) => void;
  private portManager?: PortManager;
  private portRegistry?: PortRegistryPort;
  private stateStore?: StateStorePort;
  
  // Modular components
  private logManager: LogManager;
  private packageDetector: PackageDetector;
  private projectValidator: ProjectValidator;
  private structureDetector: ProjectStructureDetector;
  private dependencyInstaller: DependencyInstaller;
  private processSpawner: ProcessSpawner;
  private infrastructureManager: InfrastructureManager;
  private healthChecker: HealthChecker;
  private issueDetector: IssueDetector;
  
  constructor(
    portManager?: PortManager,
    portRegistry?: PortRegistryPort,
    callbacks?: {
      onStatusChange?: (serverKey: string) => void;
    },
    stateStore?: StateStorePort
  ) {
    this.portManager = portManager;
    this.portRegistry = portRegistry;
    this.onStatusChange = callbacks?.onStatusChange;
    this.stateStore = stateStore;
    
    // Initialize modular components
    this.logManager = new LogManager();
    this.packageDetector = new PackageDetector();
    this.projectValidator = new ProjectValidator();
    this.structureDetector = new ProjectStructureDetector(this.packageDetector);
    this.dependencyInstaller = new DependencyInstaller();
    this.processSpawner = new ProcessSpawner();
    this.infrastructureManager = new InfrastructureManager();
    this.healthChecker = new HealthChecker();
    this.issueDetector = new IssueDetector();
  }
  
  /**
   * Create unique server key: tenantId:userId:projectId:feature
   */
  private createServerKey(tenantId: string, userId: string, projectId: string, feature: string): string {
    return createServerKey(tenantId, userId, projectId, feature);
  }
  
  /**
   * Parse server key into components
   */
  private parseServerKey(serverKey: string): { tenantId: string; userId: string; projectId: string; feature: string } {
    return parseServerKey(serverKey);
  }
  
  /**
   * Update preview phase in Redis (single source of truth) and broadcast via SSE.
   * 
   * This is the ONLY method that should be used to change preview phase.
   * Redis is authoritative — local memory maps only store process handles and logs.
   */
  private async updatePhase(
    serverKey: string,
    phase: PreviewPhase,
    extra?: { error?: string; running?: boolean; ready?: boolean }
  ): Promise<void> {
    const { tenantId, userId, projectId, feature } = this.parseServerKey(serverKey);
    
    // 1. Update Redis (source of truth)
    if (this.portRegistry) {
      try {
        await this.portRegistry.updatePreview(tenantId, userId, projectId, feature, {
          phase,
          error: extra?.error,
          running: extra?.running ?? (phase === 'installing' || phase === 'starting' || phase === 'running'),
          ready: extra?.ready ?? (phase === 'running'),
        });
      } catch (err: any) {
        logger.warn(`[Preview] Failed to update Redis phase for ${serverKey}: ${err.message}`, { component: 'PreviewService' });
      }
    }
    
    // 2. Broadcast via SSE (real-time push to UI)
    // Read full state from Redis for the broadcast payload (single source of truth)
    let broadcastPayload: any;
    if (this.portRegistry) {
      try {
        const state = await this.portRegistry.getPreview(tenantId, userId, projectId, feature);
        if (state) {
          broadcastPayload = {
            running: state.running,
            ready: state.ready,
            phase: state.phase,
            error: state.error,
            port: state.port || undefined,
            url: state.port ? `/${toUrlKey(serverKey)}` : undefined,
            packages: state.packages || [],
            issues: state.issues || [],
          };
        }
      } catch {
        // Fall through to computed payload
      }
    }
    // Fallback: broadcast what we know from the update parameters
    if (!broadcastPayload) {
      broadcastPayload = {
        running: extra?.running ?? (phase === 'installing' || phase === 'starting' || phase === 'running'),
        ready: extra?.ready ?? (phase === 'running'),
        phase,
        error: extra?.error,
      };
    }
    this.broadcastStatus(serverKey, broadcastPayload);
  }
  
  /**
   * Get Pod host for K8s multi-replica support
   * In K8s: uses POD_IP env var or falls back to localhost
   * In local: uses localhost
   */
  private getPodHost(): string {
    // K8s typically sets POD_IP via downward API
    const podIp = process.env.POD_IP;
    if (podIp) {
      logger.warn(`[Preview] Using POD_IP: ${podIp}`, { component: 'PreviewService' });
      return podIp;
    }
    
    // Fallback: try to get IP from network interfaces
    try {
      const interfaces = os.networkInterfaces();
      for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name] || []) {
          // Skip internal/loopback and IPv6
          // Note: Node.js 18+ uses numeric family (4/6), older versions use strings
          const isIPv4 = iface.family === 'IPv4' || (iface.family as unknown) === 4;
          if (!iface.internal && isIPv4) {
            logger.warn(`[Preview] Using network interface IP: ${iface.address} (${name})`, { component: 'PreviewService' });
            return iface.address;
          }
        }
      }
    } catch (err) {
      logger.warn(`[Preview] Failed to get network interfaces`, { component: 'PreviewService' }, err);
    }
    
    logger.warn(`[Preview] No POD_IP or network interface found, using localhost`, { component: 'PreviewService' });
    return 'localhost';
  }
  
  /**
   * Append log entry and broadcast via Redis Pub/Sub
   * 
   * Message structure for frontend (usePreviewManager.ts):
   * - SSE type: 'preview' (SSEMessageType)
   * - data.type: 'log' (subtype)
   * - data.data: LogEntry
   */
  private appendLog(serverKey: string, type: 'stdout' | 'stderr', message: string): void {
    const logEntry = this.logManager.appendLog(serverKey, type, message);
    
    if (this.stateStore) {
      const { tenantId, userId, projectId, feature } = this.parseServerKey(serverKey);
      if (!tenantId || !userId) {
        logger.warn('Cannot publish preview log without userContext', { component: 'PreviewService', projectId, featureName: feature });
        return;
      }
      const channel = getRealtimeBroadcastChannel(tenantId, userId);
      this.stateStore.publish(channel, {
        projectId,
        featureName: feature,
        userContext: { organizationId: tenantId, userId, workspacePath: '' },
        type: 'preview',  // SSEMessageType
        data: {
          type: 'log',    // subtype for frontend handler
          data: logEntry
        }
      }).catch(err => logger.error(`[Preview] PUBLISH log failed for ${serverKey}`, { component: 'PreviewService' }, err));
    }
  }
  
  /**
   * Broadcast status update via Redis Pub/Sub
   * 
   * Message structure for frontend (usePreviewManager.ts):
   * - SSE type: 'preview' (SSEMessageType)
   * - data.type: 'status' (subtype)
   * - data.data: PreviewStatus
   */
  private broadcastStatus(serverKey: string, status: any): void {
    if (this.stateStore) {
      const { tenantId, userId, projectId, feature } = this.parseServerKey(serverKey);
      if (!tenantId || !userId) {
        logger.warn('Cannot publish preview status without userContext', { component: 'PreviewService', projectId, featureName: feature });
        return;
      }
      const channel = getRealtimeBroadcastChannel(tenantId, userId);
      logger.debug(`[Preview] Broadcasting status: ${serverKey} running=${status?.running} ready=${status?.ready}`, { component: 'PreviewService' });
      this.stateStore.publish(channel, {
        projectId,
        featureName: feature,
        userContext: { organizationId: tenantId, userId, workspacePath: '' },
        type: 'preview',  // SSEMessageType
        data: {
          type: 'status', // subtype for frontend handler
          data: status
        }
      }).then(() => {
        logger.debug(`[Preview] Published to ${channel}: ${projectId}/${feature}`, { component: 'PreviewService' });
      }).catch(err => logger.error(`[Preview] PUBLISH failed for ${serverKey} on channel ${channel}`, { component: 'PreviewService' }, err));
    } else {
      logger.warn(`[Preview] No stateStore, cannot broadcast: ${serverKey}`, { component: 'PreviewService' });
    }
    
    if (this.onStatusChange) {
      this.onStatusChange(serverKey);
    }
  }
  
  /**
   * Validate preview server setup for frontend projects
   */
  async validatePreviewSetup(codebasePath: string): Promise<ValidationResult> {
    return await this.projectValidator.validate(codebasePath);
  }
  
  /**
   * Start preview server for a project feature
   * 
   * @param forceRestart - If true, stops existing server before starting a new one
   */
  async startPreview(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    localPath: string,
    port?: number,
    forceRestart: boolean = true
  ): Promise<{
    success: boolean;
    message?: string;
    error?: string;
    port?: number;
    serverKey?: string;
    url?: string;
    setupReasoning?: string;
    setupReason?: string;
    suggestedFix?: string;
    issues?: PreviewIssue[];
    status?: { running: boolean; ready: boolean; port?: number; logs?: any[]; packages?: any[]; backendPort?: number; issues?: any[] };
  }> {
    logger.warn(`[Preview] startPreview: ${tenantId}:${userId}:${projectId}:${feature}`, { component: 'PreviewService' });
    
    const serverKey = this.createServerKey(tenantId, userId, projectId, feature);
    const urlKey = toUrlKey(serverKey);
    const proxyUrl = `/${urlKey}`;
    
    // ── Distributed lock: prevent multi-pod race ──
    // Only one pod should handle start for a given serverKey at a time.
    // Without this, ALB round-robin can send multiple start requests to different pods,
    // causing npm install race on the same EFS path and corrupted node_modules.
    const lockKey = `${PREVIEW_LOCK_PREFIX}${serverKey}`;
    let lockAcquired = false;
    
    if (this.stateStore) {
      lockAcquired = await this.stateStore.acquireLock(lockKey, PREVIEW_LOCK_TTL_SECONDS);
      if (!lockAcquired) {
        logger.warn(`[Preview] Lock not acquired for ${serverKey} — another pod is handling this`, { component: 'PreviewService' });
        return {
          success: false,
          error: 'Preview is starting on another server. Please wait and check status.',
          serverKey,
          url: proxyUrl
        };
      }
    }
    
    // Check if already running in our memory tracking
    if (this.previewServers.has(serverKey)) {
      if (forceRestart) {
        logger.info(`Force restarting: stopping existing server for ${serverKey}`, { component: 'PreviewService' });
        await this.stopPreview(tenantId, userId, projectId, feature);
        // Small delay to ensure port is released
        await new Promise(resolve => setTimeout(resolve, 500));
      } else {
        // Release lock — not starting
        if (this.stateStore && lockAcquired) {
          await this.stateStore.releaseLock(lockKey).catch(() => {});
        }
        // Read port from Redis (source of truth)
        let existingPort: number | undefined;
        if (this.portRegistry) {
          existingPort = (await this.portRegistry.getPreviewPort(tenantId, userId, projectId, feature)) ?? undefined;
        }
        return { 
          success: false, 
          error: 'Preview server already running', 
          port: existingPort,
          serverKey,
          url: proxyUrl
        };
      }
    }
    
    // Check if registered in portRegistry (Redis) but not in memory
    // This happens when server restarts but preview process is still running (orphan)
    if (this.portRegistry) {
      const registeredPort = await this.portRegistry.getPreviewPort(tenantId, userId, projectId, feature);
      if (registeredPort) {
        logger.info(`Found stale registry entry for ${serverKey} (port ${registeredPort}), cleaning up`, { component: 'PreviewService' });
        // Unregister from portRegistry since we'll re-register after starting
        await this.portRegistry.unregisterPreview(tenantId, userId, projectId, feature);
      }
    }
    
    // Clean up orphan processes (from server restarts or crashed processes)
    const codebasePath = path.join(localPath, 'codebase');
    const fs = await import('fs');
    const orphansKilled = this.processSpawner.killOrphanProcesses(
      fs.existsSync(codebasePath) ? codebasePath : localPath
    );
    if (orphansKilled > 0) {
      logger.info(`Cleaned up ${orphansKilled} orphan process(es) before starting`, { component: 'PreviewService' });
      // Small delay after killing orphans
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    // Check if installing
    if (this.installingProjects.has(serverKey)) {
      // Release lock — not starting
      if (this.stateStore && lockAcquired) {
        await this.stateStore.releaseLock(lockKey).catch(() => {});
      }
      return { success: false, error: 'Dependencies are being installed. Please wait...' };
    }
    
    this.installingProjects.add(serverKey);
    this.startingServers.add(serverKey);
    
    try {
      // 0. Register in Redis immediately with phase: 'installing'
      //    This ensures ANY pod can report the current state, even before processes start.
      const host = this.getPodHost();
      if (this.portRegistry) {
        await this.portRegistry.registerPreview({
          tenantId, userId, projectId, feature,
          running: false, ready: false,
          port: 0,  // Not yet allocated
          host,
          podId: os.hostname(),
          phase: 'installing',
          packages: [],
          issues: [],
          startedAt: new Date()
        });
      }
      await this.updatePhase(serverKey, 'installing');
      
      // 1. Detect project structure
      const structure = await this.structureDetector.detect(localPath);
      logger.warn(`[Preview] Structure: type=${structure.type}, packages=${structure.packages.length}, entry=${structure.entry?.name || 'none'}`, { component: 'PreviewService' });
      
      if (structure.packages.length === 0) {
        throw new Error('No runnable packages found');
      }
      
      // 1.1. Save structureType to Redis (auto-detect for Preview Config UI)
      if (this.portRegistry) {
        await this.portRegistry.updatePreview(tenantId, userId, projectId, feature, {
          structureType: structure.type as any,
        });
      }
      
      // 2. Install dependencies for all packages
      const logCallback = (type: 'stdout' | 'stderr', msg: string) => this.appendLog(serverKey, type, msg);
      for (const pkg of structure.packages) {
        await this.dependencyInstaller.installIfNeeded(pkg.path, pkg.name, logCallback);
      }
      
      this.installingProjects.delete(serverKey);
      
      // 2.5. Start infrastructure services (if docker-compose.yml exists)
      this.previewServerPaths.set(serverKey, localPath);
      const infraProjectName = `ant-${projectId}-${feature}`.replace(/[^a-zA-Z0-9_-]/g, '-');
      await this.infrastructureManager.startInfrastructure(localPath, logCallback, infraProjectName);
      
      // 3. Allocate ports and start all preview servers
      const processes: ChildProcess[] = [];
      let backendPort: number | undefined;
      
      // Start backend first
      const orderedPackages = [...structure.packages].sort((a, b) => {
        const prio = (p: PackageInfo) => (p.type === 'backend' ? 0 : p.type === 'frontend' ? 1 : 2);
        return prio(a) - prio(b);
      });
      
      for (const pkg of orderedPackages) {
        const pkgPort = this.portManager 
          ? await this.portManager.allocate() 
          : 3000 + processes.length;
        
        pkg.port = pkgPort;
        
        if (!backendPort && pkg.type === 'backend') {
          backendPort = pkgPort;
        }
        
        const extraEnv: Record<string, string | undefined> = {};
        if (pkg.type === 'frontend') {
          if (backendPort) {
            // Same-project backend (fullstack/monorepo)
            extraEnv.VITE_API_BASE_URL = `/${toUrlKey(serverKey)}`;
          } else {
            // Check for cross-project linkedBackend from Preview Config
            const existingState = this.portRegistry 
              ? await this.portRegistry.getPreview(tenantId, userId, projectId, feature) 
              : null;
            const linkedBackend = existingState?.linkedBackend;
            if (linkedBackend?.type === 'project' && linkedBackend.resolvedUrlKey) {
              extraEnv.VITE_API_BASE_URL = `/${linkedBackend.resolvedUrlKey}`;
              logger.info(`[Preview] Cross-project API base: /${linkedBackend.resolvedUrlKey}`, { component: 'PreviewService' });
            } else if (linkedBackend?.type === 'url' && linkedBackend.url) {
              extraEnv.VITE_API_BASE_URL = linkedBackend.url;
              logger.info(`[Preview] Direct URL API base: ${linkedBackend.url}`, { component: 'PreviewService' });
            }
          }
        }
        
        const childProcess = this.processSpawner.spawn(pkg, pkgPort, {
          serverKey,
          extraEnv,
          onLog: (type, msg) => this.appendLog(serverKey, type, msg),
          onExit: (code, signal) => this.handleProcessExit(serverKey, pkg.name, code, signal),
          onError: (error) => this.handleProcessError(serverKey, pkg.name, error)
        });
        
        pkg.process = childProcess;
        processes.push(childProcess);
      }

      // Build package ports for Redis registration
      const packagePorts = orderedPackages
        .filter(p => typeof p.port === 'number')
        .map(p => ({ name: p.name, type: p.type, port: p.port as number }));
      
      // 4. Update Redis with full port/package info + phase: 'starting'
      if (structure.entry && this.portRegistry) {
        const backendPort = packagePorts.find(p => p.type === 'backend')?.port;
        
        // Preserve linkedBackend from existing state (user-configured via Preview Config UI)
        const existingPreviewState = this.portRegistry 
          ? await this.portRegistry.getPreview(tenantId, userId, projectId, feature) 
          : null;
        
        const previewState: Omit<PreviewState, 'lastAccessedAt'> = {
          tenantId,
          userId,
          projectId,
          feature,
          running: true,
          ready: false,  // Will be updated after health check
          phase: 'starting',
          port: structure.entry.port!,
          backendPort,
          structureType: structure.type as any,
          linkedBackend: existingPreviewState?.linkedBackend,
          host,
          podId: os.hostname(),
          packages: packagePorts,
          issues: [],
          startedAt: new Date()
        };
        
        await this.portRegistry.registerPreview(previewState);
        logger.info(`[Preview] Registered: ${serverKey} -> ${host}:${structure.entry.port}`, { component: 'PreviewService' });
      }
      await this.updatePhase(serverKey, 'starting', { running: true });
      
      // 5. Store processes (port is already in Redis via registerPreview)
      this.previewServers.set(serverKey, processes);
      this.startingServers.delete(serverKey);
      
      // Check if stopPreview was called while we were starting
      if (this.startCancelledServers.has(serverKey)) {
        this.startCancelledServers.delete(serverKey);
        logger.warn(`[Preview] Start was cancelled for ${serverKey}, cleaning up`, { component: 'PreviewService' });
        await this.stopPreview(tenantId, userId, projectId, feature);
        if (this.stateStore && lockAcquired) {
          await this.stateStore.releaseLock(lockKey).catch(() => {});
        }
        return { success: false, error: 'Preview start was cancelled', serverKey };
      }
      
      this.appendLog(serverKey, 'stdout', '✅ All preview servers started successfully!');
      
      // 6. Validate frontend setup
      let validation: ValidationResult = { valid: true };
      
      if (structure.entry?.type === 'frontend') {
        validation = await this.validatePreviewSetup(structure.entry.path);
        
        if (!validation.valid) {
          return this.handleValidationFailure(serverKey, tenantId, userId, projectId, feature, processes, orderedPackages, structure.entry.path, validation);
        }
        
        // Log framework detection (all frameworks now use native base path via env var)
        if (validation.framework) {
          logger.info(`[Preview] Framework detected: ${validation.framework} for ${serverKey}`, { component: 'PreviewService' });
        }
      }

      // 7. Non-fatal issues detection
      const issues: PreviewIssue[] = [];
      const entryFrontendPath = structure.entry?.type === 'frontend' ? structure.entry.path : undefined;
      const hasBackend = orderedPackages.some(p => p.type === 'backend' && typeof p.port === 'number');
      
      if (entryFrontendPath && hasBackend) {
        const apiIssue = await this.issueDetector.detectApiBaseIssue(entryFrontendPath);
        if (apiIssue) issues.push(apiIssue);
      }
      
      // Write issues to Redis and broadcast
      if (this.portRegistry) {
        try {
          await this.portRegistry.updatePreview(tenantId, userId, projectId, feature, {
            issues: issues as any
          });
        } catch { /* best-effort */ }
      }
      if (issues.length > 0) {
        const updatedStatus = await this.getPreviewStatus(tenantId, userId, projectId, feature);
        this.broadcastStatus(serverKey, updatedStatus);
      }
      
      // 8. Health check (async)
      // If health check fails, kill all processes and clean up — the dev server is unusable.
      const entryPort = structure.entry?.port || structure.packages[0].port!;
      this.healthChecker.check(entryPort, logCallback).then(async (ready) => {
        // Release lock after health check completes (success or fail)
        if (this.stateStore && lockAcquired) {
          this.stateStore.releaseLock(lockKey).catch(() => {});
        }
        
        if (ready) {
          await this.updatePhase(serverKey, 'running', { running: true, ready: true });
        } else {
          // Health check failed — dev server is not responding. Clean up everything.
          logger.warn(`[Preview] Health check failed for ${serverKey}, stopping all processes`, { component: 'PreviewService' });
          this.appendLog(serverKey, 'stderr', '❌ Dev server failed health check. Stopping preview.');
          
          try {
            await this.stopPreview(tenantId, userId, projectId, feature);
          } catch { /* best-effort */ }
          
          await this.updatePhase(serverKey, 'error', {
            running: false, ready: false,
            error: `Dev server failed to respond on port ${entryPort}`
          });
        }
      });
      
      const finalStatus = await this.getPreviewStatus(tenantId, userId, projectId, feature);
      
      return {
        success: true,
        message: `Started ${structure.packages.length} package(s)`,
        port: structure.entry?.port || structure.packages[0].port!,
        serverKey,
        url: proxyUrl,
        setupReasoning: validation.reasoning,
        setupReason: validation.reason,
        suggestedFix: validation.suggestedFix,
        status: finalStatus
      };
      
    } catch (error: any) {
      this.installingProjects.delete(serverKey);
      this.startingServers.delete(serverKey);
      this.startCancelledServers.delete(serverKey);
      logger.error(`Error starting preview server: ${error.message}`, { component: 'PreviewService' }, error);
      this.appendLog(serverKey, 'stderr', `❌ Error: ${error.message}`);
      
      // Release distributed lock on failure
      if (this.stateStore && lockAcquired) {
        await this.stateStore.releaseLock(lockKey).catch(() => {});
      }
      
      // Update Redis + broadcast failure
      await this.updatePhase(serverKey, 'error', {
        running: false, ready: false,
        error: error.message || 'Failed to start preview server'
      });
      
      return {
        success: false,
        error: error.message || 'Failed to start preview server',
        serverKey
      };
    }
  }
  
  /**
   * Handle validation failure
   */
  private async handleValidationFailure(
    serverKey: string,
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    processes: ChildProcess[],
    orderedPackages: PackageInfo[],
    entryPath: string,
    validation: ValidationResult
  ) {
    logger.info(`Frontend setup validation failed - stopping server`, { component: 'PreviewService' });
    
    // Stop all processes
    for (const process of processes) {
      this.processSpawner.kill(process);
    }
    
    // Clean up local state (process handles, paths, logs)
    this.previewServers.delete(serverKey);
    this.previewServerPaths.delete(serverKey);
    this.logManager.clearLogs(serverKey);
    
    // Build issues stack
    const issues: PreviewIssue[] = [];
    issues.push(this.issueDetector.createFatalIssue(
      (validation.reasoning || 'unknown') as PreviewIssueReasoning,
      validation.reason || 'Preview server setup validation failed',
      validation.suggestedFix
    ));
    
    try {
      const hasBackend = orderedPackages.some(p => p.type === 'backend');
      const apiIssue = hasBackend ? await this.issueDetector.detectApiBaseIssue(entryPath) : null;
      if (apiIssue) issues.push(apiIssue);
    } catch {
      // Best-effort only
    }
    
    const combinedSuggestedFix = this.issueDetector.combineIssueFixes(issues);
    
    // Write issues + validation info to Redis, then update phase to error
    if (this.portRegistry) {
      try {
        await this.portRegistry.updatePreview(tenantId, userId, projectId, feature, {
          issues: issues as any,
          setupReasoning: validation.reasoning || 'unknown',
          setupReason: validation.reason,
          suggestedFix: combinedSuggestedFix,
        });
      } catch { /* best-effort */ }
    }
    
    // Update Redis state to error (don't unregister — let UI see the error reason)
    await this.updatePhase(serverKey, 'error', {
      running: false, ready: false,
      error: validation.reason || 'Preview server setup validation failed'
    });
    
    return {
      success: false,
      error: 'Preview server setup validation failed',
      setupReasoning: validation.reasoning || 'unknown',
      setupReason: validation.reason,
      suggestedFix: combinedSuggestedFix,
      serverKey,
      issues,
    };
  }
  
  /**
   * Handle process exit
   * 
   * When a process exits unexpectedly (not via stopPreview), we need to:
   * 1. Log the exit
   * 2. Check if ALL processes for this serverKey are dead
   * 3. If so, clean up all state (maps, Redis, ports)
   */
  private handleProcessExit(serverKey: string, pkgName: string, code: number | null, signal: NodeJS.Signals | null): void {
    const pid = this.getCurrentPidForServer(serverKey);
    const stoppingPids = this.stoppingPidsByServer.get(serverKey);
    const isExpectedStop =
      this.stoppingServers.has(serverKey) ||
      (pid != null && stoppingPids?.has(pid));
    
    if (isExpectedStop) {
      if (pid != null && stoppingPids) {
        stoppingPids.delete(pid);
        if (stoppingPids.size === 0) {
          this.stoppingPidsByServer.delete(serverKey);
          this.stoppingServers.delete(serverKey);
          
          const t = this.stoppingCleanupTimers.get(serverKey);
          if (t) {
            clearTimeout(t);
            this.stoppingCleanupTimers.delete(serverKey);
          }
        }
      }
      return;
    }
    
    if (code !== 0 && code !== null) {
      this.appendLog(serverKey, 'stderr', `❌ ${pkgName} exited with code ${code}`);
    } else {
      this.appendLog(serverKey, 'stdout', `⚠️  ${pkgName} exited with code ${code}`);
    }
    
    // Check if all processes are dead — if so, full cleanup
    this.cleanupIfAllDead(serverKey);
  }
  
  private getCurrentPidForServer(serverKey: string): number | undefined {
    const processes = this.previewServers.get(serverKey);
    return processes?.[0]?.pid;
  }
  
  /**
   * Handle process error
   */
  private handleProcessError(serverKey: string, pkgName: string, error: Error): void {
    this.appendLog(serverKey, 'stderr', `❌ ${pkgName} error: ${error.message}`);
    
    // Check if all processes are dead — if so, full cleanup
    this.cleanupIfAllDead(serverKey);
  }
  
  /**
   * Check if all processes for a serverKey have exited.
   * If so, clean up all state maps, release ports, unregister from Redis,
   * and broadcast stopped status.
   */
  private async cleanupIfAllDead(serverKey: string): Promise<void> {
    const processes = this.previewServers.get(serverKey);
    if (!processes) return;
    
    const alive = processes.filter(p => !p.killed && p.exitCode === null);
    
    if (alive.length > 0) {
      // Some processes still running — just broadcast updated status
      const { tenantId, userId, projectId, feature } = this.parseServerKey(serverKey);
      this.updatePhase(serverKey, 'starting', { running: true }).catch(() => {});
      return;
    }
    
    // All processes dead — full cleanup
    logger.warn(`[Preview] All processes exited for ${serverKey}, cleaning up`, { component: 'PreviewService' });
    
    try {
      // Release port (read from Redis)
      const { tenantId: t, userId: u, projectId: p, feature: f } = this.parseServerKey(serverKey);
      if (this.portRegistry && this.portManager) {
        try {
          const state = await this.portRegistry.getPreview(t, u, p, f);
          if (state?.port) {
            this.portManager.release(state.port);
          }
        } catch { /* best-effort */ }
      }
      
      // Clear local state (process handles, paths)
      this.previewServers.delete(serverKey);
      this.previewServerPaths.delete(serverKey);
      
      // Update Redis to error + broadcast
      await this.updatePhase(serverKey, 'error', {
        running: false, ready: false,
        error: 'All preview processes exited unexpectedly'
      });
    } catch (e: any) {
      logger.warn(`[Preview] Cleanup error for ${serverKey}: ${e.message}`, { component: 'PreviewService' });
    }
  }
  
  /**
   * Stop preview server
   */
  async stopPreview(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<{ success: boolean; message?: string; error?: string }> {
    const serverKey = this.createServerKey(tenantId, userId, projectId, feature);
    
    // If startPreview is still running (before previewServers.set), signal it to cancel
    if (this.startingServers.has(serverKey)) {
      logger.warn(`[Preview] stopPreview called while startPreview is running for ${serverKey}`, { component: 'PreviewService' });
      this.startCancelledServers.add(serverKey);
      return { success: true, message: 'Start operation will be cancelled' };
    }
    
    const processes = this.previewServers.get(serverKey);
    if (!processes || processes.length === 0) {
      return { success: false, error: 'Preview server not running' };
    }

    // Mark stopping
    this.stoppingServers.add(serverKey);
    const pidSet = new Set<number>();
    for (const p of processes) {
      if (p?.pid != null) pidSet.add(p.pid);
    }
    if (pidSet.size > 0) {
      this.stoppingPidsByServer.set(serverKey, pidSet);
    }
    
    // Fallback cleanup timer
    const existingTimer = this.stoppingCleanupTimers.get(serverKey);
    if (existingTimer) clearTimeout(existingTimer);
    this.stoppingCleanupTimers.set(
      serverKey,
      setTimeout(() => {
        this.stoppingServers.delete(serverKey);
        this.stoppingPidsByServer.delete(serverKey);
        this.stoppingCleanupTimers.delete(serverKey);
      }, 10_000)
    );
    
    // Stop infrastructure services (best-effort, before killing app processes)
    const localPath = this.previewServerPaths.get(serverKey);
    if (localPath) {
      const { projectId, feature } = this.parseServerKey(serverKey);
      const infraProjectName = `ant-${projectId}-${feature}`.replace(/[^a-zA-Z0-9_-]/g, '-');
      const logCallback = (type: 'stdout' | 'stderr', msg: string) => this.appendLog(serverKey, type, msg);
      await this.infrastructureManager.stopInfrastructure(localPath, logCallback, infraProjectName);
    }
    
    // Kill all processes
    for (const process of processes) {
      this.processSpawner.kill(process);
    }
    
    // Release port (read from Redis before unregister)
    if (this.portRegistry && this.portManager) {
      try {
        const state = await this.portRegistry.getPreview(tenantId, userId, projectId, feature);
        if (state?.port) {
          this.portManager.release(state.port);
        }
      } catch { /* best-effort */ }
    }
    
    // Unregister from PortRegistry (Redis)
    if (this.portRegistry) {
      await this.portRegistry.unregisterPreview(tenantId, userId, projectId, feature);
    }
    
    // Cleanup local state (process handles, paths, logs)
    this.previewServers.delete(serverKey);
    this.previewServerPaths.delete(serverKey);
    this.logManager.clearLogs(serverKey);
    
    logger.info(`Stopped all servers for ${serverKey}`, { component: 'PreviewService' });
    
    // Broadcast stopped status (Redis already unregistered above)
    this.broadcastStatus(serverKey, {
      running: false,
      ready: false,
      phase: 'stopped',
      port: null,
      packages: [],
      issues: [],
    });
    
    if (this.onStatusChange) {
      this.onStatusChange(serverKey);
    }
    
    return { 
      success: true, 
      message: `Stopped ${processes.length} process(es)` 
    };
  }
  
  /**
   * Get preview server status
   */
  /**
   * Get preview server status.
   * 
   * Redis is the single source of truth for state (phase, running, ready, error).
   * Local memory is only used for process handles and log buffer.
   * This ensures any pod can return accurate status regardless of which pod owns the preview.
   */
  async getPreviewStatus(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<{
    running: boolean;
    ready: boolean;
    port?: number;
    url?: string;
    processCount?: number;
    backendPort?: number;
    packages?: Array<{ name: string; type: 'frontend' | 'backend' | 'other'; port: number }>;
    issues?: PreviewIssue[];
    phase?: string;
    error?: string;
    structureType?: string;
    linkedBackend?: any;
    setupReasoning?: string;
    setupReason?: string;
    suggestedFix?: string;
  }> {
    const serverKey = this.createServerKey(tenantId, userId, projectId, feature);
    
    // 1. Read from Redis (source of truth)
    if (this.portRegistry) {
      try {
        const redisState = await this.portRegistry.getPreview(tenantId, userId, projectId, feature);
        if (redisState) {
          // Supplement with local process count (only available on owning pod)
          const processes = this.previewServers.get(serverKey);
          const aliveProcesses = processes?.filter(p => !p.killed && p.exitCode === null) || [];
          
          return {
            running: redisState.running,
            ready: redisState.ready,
            phase: redisState.phase || (redisState.ready ? 'running' : redisState.running ? 'starting' : 'idle'),
            error: redisState.error,
            port: redisState.port || undefined,
            url: redisState.port ? `/${toUrlKey(serverKey)}` : undefined,
            processCount: aliveProcesses.length || (redisState.packages?.length || 0),
            backendPort: redisState.backendPort,
            packages: redisState.packages || [],
            issues: (redisState.issues || []) as any,
            structureType: redisState.structureType,
            linkedBackend: redisState.linkedBackend,
            setupReasoning: redisState.setupReasoning,
            setupReason: redisState.setupReason,
            suggestedFix: redisState.suggestedFix,
          };
        }
      } catch (err: any) {
        logger.warn(`[Preview] Redis getPreview failed for ${serverKey}: ${err.message}`, { component: 'PreviewService' });
        // Fall through to local-only check
      }
    }
    
    // 2. Fallback: process-handle-only degraded mode (no Redis or Redis failure)
    //    We can only determine if processes are alive — no port/package/issue data.
    const processes = this.previewServers.get(serverKey);
    const aliveProcesses = processes?.filter(p => !p.killed && p.exitCode === null) || [];
    const running = aliveProcesses.length > 0;
    
    const phase: PreviewPhase = this.installingProjects.has(serverKey) ? 'installing'
      : running ? 'starting'
      : 'idle';
    
    return {
      running,
      ready: false,  // Cannot determine without Redis
      phase,
      processCount: aliveProcesses.length,
    };
  }
  
  /**
   * Get logs for a preview server
   */
  getPreviewLogs(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): LogEntry[] {
    const serverKey = this.createServerKey(tenantId, userId, projectId, feature);
    return this.logManager.getLogs(serverKey);
  }
  
  // nativeBasePath check removed — all frameworks now use native base path via env var injection.
  // The proxy always keeps the URL key prefix and streams responses without rewriting.
  
  /**
   * Stream logs via SSE (used by RealtimeServer only)
   * Note: In cloud mode, this is handled by the dedicated Realtime Server
   */
  async streamPreviewLogs(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    res: Response
  ): Promise<void> {
    const serverKey = this.createServerKey(tenantId, userId, projectId, feature);
    
    logger.debug(`SSE connection opened for ${serverKey}`, { component: 'PreviewService' });
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Send initial status
    const status = await this.getPreviewStatus(tenantId, userId, projectId, feature);
    res.write(`data: ${JSON.stringify({ type: 'status', data: status })}\n\n`);
    
    // Send existing logs
    const existingLogs = this.logManager.getLogs(serverKey);
    existingLogs.forEach((log: LogEntry) => {
      res.write(`data: ${JSON.stringify({ type: 'log', data: log })}\n\n`);
    });
  }
  
  // ==========================================
  // Idle Check Management
  // ==========================================
  
  /**
   * Set idle timeout duration
   */
  setIdleTimeout(timeoutMs: number): void {
    this.idleTimeoutMs = timeoutMs;
    logger.info(`Idle timeout set to ${timeoutMs}ms (${timeoutMs / 60000} minutes)`, { 
      component: 'PreviewService' 
    });
  }
  
  /**
   * Start idle check timer
   * Periodically checks for idle preview servers and terminates them
   */
  startIdleCheck(): void {
    if (this.idleCheckTimer) {
      logger.debug('Idle check timer already running', { component: 'PreviewService' });
      return;
    }
    
    this.idleCheckTimer = setInterval(async () => {
      await this.checkIdleInstances();
    }, IDLE_CHECK_INTERVAL_MS);
    
    logger.info(`[IdleCheck] Started idle check timer (interval: ${IDLE_CHECK_INTERVAL_MS / 1000}s, timeout: ${this.idleTimeoutMs / 60000}min)`, { 
      component: 'PreviewService' 
    });
  }
  
  /**
   * Stop idle check timer
   */
  stopIdleCheck(): void {
    if (this.idleCheckTimer) {
      clearInterval(this.idleCheckTimer);
      this.idleCheckTimer = null;
      logger.info('[IdleCheck] Stopped idle check timer', { component: 'PreviewService' });
    }
  }
  
  /**
   * Check for idle instances and terminate them
   * Uses lastAccessedAt from Redis state, or local state as fallback
   */
  private async checkIdleInstances(): Promise<void> {
    const now = Date.now();
    let checkedCount = 0;
    let terminatedCount = 0;
    
    try {
      // If stateStore is available, use Redis-based idle check
      if (this.stateStore) {
        const previews = await this.stateStore.listPreviews();
        
        for (const preview of previews) {
          const serverKey = this.createServerKey(
            preview.tenantId, 
            preview.userId, 
            preview.projectId, 
            preview.feature
          );
          
          // Skip if not running on this Pod
          if (!this.previewServers.has(serverKey)) {
            continue;
          }
          
          checkedCount++;
          
          // Check last access time (convert Date to timestamp)
          const lastAccessTime = preview.lastAccessedAt?.getTime?.() 
            || (typeof preview.lastAccessedAt === 'number' ? preview.lastAccessedAt : 0);
          const startTime = preview.startedAt?.getTime?.() 
            || (typeof preview.startedAt === 'number' ? preview.startedAt : 0);
          const lastAccess = lastAccessTime || startTime || 0;
          const idleTime = now - lastAccess;
          
          if (idleTime > this.idleTimeoutMs) {
            logger.info(`[IdleCheck] Terminating idle preview: ${serverKey} (idle for ${Math.round(idleTime / 60000)} minutes)`, {
              component: 'PreviewService'
            });
            
            try {
              await this.stopPreview(
                preview.tenantId,
                preview.userId,
                preview.projectId,
                preview.feature
              );
              terminatedCount++;
            } catch (error: any) {
              logger.warn(`[IdleCheck] Failed to terminate idle preview ${serverKey}: ${error.message}`, {
                component: 'PreviewService'
              });
            }
          }
        }
      } else if (this.portRegistry) {
        // Fallback: use local portRegistry
        const previews = await this.portRegistry.listPreviews();
        
        for (const preview of previews) {
          const serverKey = this.createServerKey(
            preview.tenantId, 
            preview.userId, 
            preview.projectId, 
            preview.feature
          );
          
          // Skip if not running locally
          if (!this.previewServers.has(serverKey)) {
            continue;
          }
          
          checkedCount++;
          
          // Check last access time
          const lastAccessTime = preview.lastAccessedAt?.getTime?.() 
            || (typeof preview.lastAccessedAt === 'number' ? preview.lastAccessedAt : 0);
          const startTime = preview.startedAt?.getTime?.() 
            || (typeof preview.startedAt === 'number' ? preview.startedAt : 0);
          const lastAccess = lastAccessTime || startTime || 0;
          const idleTime = now - lastAccess;
          
          if (idleTime > this.idleTimeoutMs) {
            logger.info(`[IdleCheck] Terminating idle preview: ${serverKey} (idle for ${Math.round(idleTime / 60000)} minutes)`, {
              component: 'PreviewService'
            });
            
            try {
              await this.stopPreview(
                preview.tenantId,
                preview.userId,
                preview.projectId,
                preview.feature
              );
              terminatedCount++;
            } catch (error: any) {
              logger.warn(`[IdleCheck] Failed to terminate idle preview ${serverKey}: ${error.message}`, {
                component: 'PreviewService'
              });
            }
          }
        }
      } else {
        logger.debug('[IdleCheck] No stateStore or portRegistry configured, skipping', { 
          component: 'PreviewService' 
        });
        return;
      }
      
      if (checkedCount > 0) {
        logger.debug(`[IdleCheck] Checked ${checkedCount} preview(s), terminated ${terminatedCount}`, {
          component: 'PreviewService'
        });
      }
    } catch (error: any) {
      logger.error('[IdleCheck] Error during idle check', { component: 'PreviewService' }, error);
    }
  }
  
  /**
   * Cleanup all preview servers
   */
  async cleanup(): Promise<void> {
    // Stop idle check timer first
    this.stopIdleCheck();
    
    const serverKeys = Array.from(this.previewServers.keys());
    
    if (serverKeys.length === 0) {
      logger.debug('No running preview servers to cleanup', { component: 'PreviewService' });
      return;
    }
    
    logger.info(`Cleaning up ${serverKeys.length} preview server(s)...`, { component: 'PreviewService' });
    
    const cleanupPromises: Promise<void>[] = [];
    
    for (const serverKey of serverKeys) {
      const { tenantId, userId, projectId, feature } = this.parseServerKey(serverKey);
      
      const cleanupPromise = this.stopPreview(tenantId, userId, projectId, feature)
        .then(() => {
          logger.debug(`Stopped: ${serverKey}`, { component: 'PreviewService' });
        })
        .catch((error) => {
          logger.warn(`Failed to stop ${serverKey}: ${error.message}`, { component: 'PreviewService' });
        });
      
      cleanupPromises.push(cleanupPromise);
    }
    
    await Promise.all(cleanupPromises);
    
    // Close PortRegistry connection if exists
    if (this.portRegistry && typeof this.portRegistry.close === 'function') {
      try {
        await this.portRegistry.close();
        logger.debug('PortRegistry closed', { component: 'PreviewService' });
      } catch (error: any) {
        logger.warn(`PortRegistry close error: ${error.message}`, { component: 'PreviewService' });
      }
    }
    
    logger.info(`Cleanup complete (${serverKeys.length} server(s) stopped)`, { component: 'PreviewService' });
  }
}
