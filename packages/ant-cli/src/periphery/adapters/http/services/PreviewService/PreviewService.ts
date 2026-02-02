import { ChildProcess } from 'child_process';
import { Response } from 'express';
import * as path from 'path';
import * as os from 'os';
import { LogEntry } from '../../../../../core/ports/http';
import { PortManager } from '../../../../../infrastructure/networking/PortManager';
import { PortRegistryPort } from '../../../../../core/ports/portRegistry';
import type { StateStorePort } from '../../../../../core/ports/stateStore';
import { PreviewIssue, PreviewIssueReasoning, PackageInfo, ValidationResult } from './types';
import { createServerKey, parseServerKey } from './utils/serverKeyUtils';
import { LogManager } from './managers/LogManager';
import { PackageDetector } from './detectors/PackageDetector';
import { ProjectValidator } from './validators/ProjectValidator';
import { ProjectStructureDetector } from './detectors/ProjectStructureDetector';
import { DependencyInstaller } from './managers/DependencyInstaller';
import { ProcessSpawner } from './managers/ProcessSpawner';
import { HealthChecker } from './utils/HealthChecker';
import { IssueDetector } from './detectors/IssueDetector';
import { logger } from '../../../../../utils/logger';
import { SSE_BROADCAST_CHANNEL } from '../SSEService';

// Use sse:broadcast channel with type:'preview' (SSEService subscribes to this)
const PREVIEW_CHANNEL = SSE_BROADCAST_CHANNEL;

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
  // State maps
  private previewServers: Map<string, ChildProcess[]> = new Map();
  private previewServerPorts: Map<string, number> = new Map();
  private previewServerReady: Map<string, boolean> = new Map();
  private installingProjects: Set<string> = new Set();
  private previewServerPackagePorts: Map<string, Array<{ name: string; type: 'frontend' | 'backend' | 'other'; port: number }>> = new Map();
  private previewServerIssues: Map<string, PreviewIssue[]> = new Map();
  
  // Stopping state management
  private stoppingServers: Set<string> = new Set();
  private stoppingPidsByServer: Map<string, Set<number>> = new Map();
  private stoppingCleanupTimers: Map<string, NodeJS.Timeout> = new Map();
  
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
   * Message structure for frontend (useDevServerManager.ts):
   * - SSE type: 'preview' (SSEMessageType)
   * - data.type: 'log' (subtype)
   * - data.data: LogEntry
   */
  private appendLog(serverKey: string, type: 'stdout' | 'stderr', message: string): void {
    const logEntry = this.logManager.appendLog(serverKey, type, message);
    
    if (this.stateStore) {
      const { tenantId, userId, projectId, feature } = this.parseServerKey(serverKey);
      this.stateStore.publish(PREVIEW_CHANNEL, {
        projectId,
        featureName: feature,
        userContext: { organizationId: tenantId, userId, workspacePath: '' },
        type: 'preview',  // SSEMessageType
        data: {
          type: 'log',    // subtype for frontend handler
          data: logEntry
        }
      }).catch(err => logger.warn('Failed to publish preview log', { component: 'PreviewService' }, err));
    }
  }
  
  /**
   * Broadcast status update via Redis Pub/Sub
   * 
   * Message structure for frontend (useDevServerManager.ts):
   * - SSE type: 'preview' (SSEMessageType)
   * - data.type: 'status' (subtype)
   * - data.data: PreviewStatus
   */
  private broadcastStatus(serverKey: string, status: any): void {
    if (this.stateStore) {
      const { tenantId, userId, projectId, feature } = this.parseServerKey(serverKey);
      logger.warn(`[Preview] Broadcasting status: ${serverKey} running=${status?.running} ready=${status?.ready}`, { component: 'PreviewService' });
      this.stateStore.publish(PREVIEW_CHANNEL, {
        projectId,
        featureName: feature,
        userContext: { organizationId: tenantId, userId, workspacePath: '' },
        type: 'preview',  // SSEMessageType
        data: {
          type: 'status', // subtype for frontend handler
          data: status
        }
      }).then(() => {
        logger.warn(`[Preview] Published to ${PREVIEW_CHANNEL}: ${projectId}/${feature}`, { component: 'PreviewService' });
      }).catch(err => logger.warn('Failed to publish preview status', { component: 'PreviewService' }, err));
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
    const proxyUrl = `/preview/${serverKey}`;
    
    // Check if already running in our memory tracking
    if (this.previewServers.has(serverKey)) {
      if (forceRestart) {
        logger.info(`Force restarting: stopping existing server for ${serverKey}`, { component: 'PreviewService' });
        await this.stopPreview(tenantId, userId, projectId, feature);
        // Small delay to ensure port is released
        await new Promise(resolve => setTimeout(resolve, 500));
      } else {
        const existingPort = this.previewServerPorts.get(serverKey);
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
      return { success: false, error: 'Dependencies are being installed. Please wait...' };
    }
    
    this.installingProjects.add(serverKey);
    
    try {
      // 1. Detect project structure
      const structure = await this.structureDetector.detect(localPath);
      logger.warn(`[Preview] Structure: packages=${structure.packages.length}, entry=${structure.entry?.name || 'none'}`, { component: 'PreviewService' });
      
      if (structure.packages.length === 0) {
        throw new Error('No runnable packages found');
      }
      
      // 2. Install dependencies for all packages
      const logCallback = (type: 'stdout' | 'stderr', msg: string) => this.appendLog(serverKey, type, msg);
      for (const pkg of structure.packages) {
        await this.dependencyInstaller.installIfNeeded(pkg.path, pkg.name, logCallback);
      }
      
      this.installingProjects.delete(serverKey);
      
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
        if (pkg.type === 'frontend' && backendPort) {
          extraEnv.VITE_API_BASE_URL = `/preview/${serverKey}`;
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

      // Persist package ports for UI
      const packagePorts = orderedPackages
        .filter(p => typeof p.port === 'number')
        .map(p => ({ name: p.name, type: p.type, port: p.port as number }));
      this.previewServerPackagePorts.set(serverKey, packagePorts);
      
      // 4. Register entry in PortRegistry
      // In K8s, use Pod IP instead of localhost for multi-replica support
      if (structure.entry && this.portRegistry) {
        const host = this.getPodHost();
        await this.portRegistry.registerPreview(
          tenantId, userId, projectId, feature,
          structure.entry.port!,
          host
        );
        logger.warn(`[Preview] Registered: ${serverKey} -> ${host}:${structure.entry.port}`, { component: 'PreviewService' });
      }
      
      // 5. Store processes and entry port
      this.previewServers.set(serverKey, processes);
      this.previewServerPorts.set(serverKey, structure.entry?.port || structure.packages[0].port!);
      
      this.appendLog(serverKey, 'stdout', '✅ All preview servers started successfully!');
      
      // 6. Validate frontend setup
      let validation: ValidationResult = { valid: true };
      
      if (structure.entry?.type === 'frontend') {
        validation = await this.validatePreviewSetup(structure.entry.path);
        
        if (!validation.valid) {
          return this.handleValidationFailure(serverKey, tenantId, userId, projectId, feature, processes, orderedPackages, structure.entry.path, validation);
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
      
      if (issues.length > 0) {
        this.previewServerIssues.set(serverKey, issues);
        const updatedStatus = this.getPreviewStatus(tenantId, userId, projectId, feature);
        this.broadcastStatus(serverKey, updatedStatus);
      } else {
        this.previewServerIssues.delete(serverKey);
      }
      
      // 8. Broadcast running status
      const runningStatus = this.getPreviewStatus(tenantId, userId, projectId, feature);
      this.broadcastStatus(serverKey, runningStatus);
      
      // 9. Health check (async)
      const entryPort = structure.entry?.port || structure.packages[0].port!;
      this.healthChecker.check(entryPort, logCallback).then(ready => {
        this.previewServerReady.set(serverKey, ready);
        const updatedStatus = this.getPreviewStatus(tenantId, userId, projectId, feature);
        this.broadcastStatus(serverKey, updatedStatus);
      });
      
      const finalStatus = this.getPreviewStatus(tenantId, userId, projectId, feature);
      
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
      logger.error(`Error starting preview server: ${error.message}`, { component: 'PreviewService' }, error);
      this.appendLog(serverKey, 'stderr', `❌ Error: ${error.message}`);
      
      return {
        success: false,
        error: error.message || 'Failed to start preview server'
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
    
    // Clean up
    this.previewServers.delete(serverKey);
    this.previewServerPorts.delete(serverKey);
    this.previewServerReady.delete(serverKey);
    this.logManager.clearLogs(serverKey);
    this.previewServerPackagePorts.delete(serverKey);
    this.previewServerIssues.delete(serverKey);
    
    if (this.portRegistry) {
      await this.portRegistry.unregisterPreview(tenantId, userId, projectId, feature);
    }

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
    
    this.previewServerIssues.set(serverKey, issues);
    const combinedSuggestedFix = this.issueDetector.combineIssueFixes(issues);
    
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
    
    try {
      const { tenantId, userId, projectId, feature } = this.parseServerKey(serverKey);
      const updatedStatus = this.getPreviewStatus(tenantId, userId, projectId, feature);
      this.broadcastStatus(serverKey, updatedStatus);
    } catch (e: any) {
      // Don't crash on exit handler
    }
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
    
    try {
      const { tenantId, userId, projectId, feature } = this.parseServerKey(serverKey);
      const updatedStatus = this.getPreviewStatus(tenantId, userId, projectId, feature);
      this.broadcastStatus(serverKey, updatedStatus);
    } catch (e: any) {
      // Ignore
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
    
    // Kill all processes
    for (const process of processes) {
      this.processSpawner.kill(process);
    }
    
    // Release ports
    const port = this.previewServerPorts.get(serverKey);
    if (port && this.portManager) {
      await this.portManager.release(port);
    }
    
    // Unregister from PortRegistry
    if (this.portRegistry) {
      await this.portRegistry.unregisterPreview(tenantId, userId, projectId, feature);
    }
    
    // Cleanup
    this.previewServers.delete(serverKey);
    this.previewServerPorts.delete(serverKey);
    this.previewServerReady.delete(serverKey);
    this.logManager.clearLogs(serverKey);
    this.previewServerPackagePorts.delete(serverKey);
    this.previewServerIssues.delete(serverKey);
    
    logger.info(`Stopped all servers for ${serverKey}`, { component: 'PreviewService' });
    
    // Broadcast stopped status
    try {
      const updatedStatus = this.getPreviewStatus(tenantId, userId, projectId, feature);
      this.broadcastStatus(serverKey, updatedStatus);
    } catch {
      // Best-effort only
    }
    
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
  getPreviewStatus(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): {
    running: boolean;
    ready: boolean;
    port?: number;
    url?: string;
    processCount?: number;
    backendPort?: number;
    packages?: Array<{ name: string; type: 'frontend' | 'backend' | 'other'; port: number }>;
    issues?: PreviewIssue[];
  } {
    const serverKey = this.createServerKey(tenantId, userId, projectId, feature);
    const processes = this.previewServers.get(serverKey);
    const port = this.previewServerPorts.get(serverKey);
    const ready = this.previewServerReady.get(serverKey) || false;
    const packages = this.previewServerPackagePorts.get(serverKey) || [];
    const backendPort = packages.find(p => p.type === 'backend')?.port;
    const issues = this.previewServerIssues.get(serverKey) || [];
    
    const running = !!processes && processes.length > 0;
    
    return {
      running,
      ready,
      port,
      url: port ? `/preview/${serverKey}` : undefined,
      processCount: processes?.length || 0,
      backendPort,
      packages,
      issues
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
  
  /**
   * Stream logs via SSE (used by RealtimeServer only)
   * Note: In cloud mode, this is handled by the dedicated Realtime Server
   */
  streamPreviewLogs(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    res: Response
  ): void {
    const serverKey = this.createServerKey(tenantId, userId, projectId, feature);
    
    logger.debug(`SSE connection opened for ${serverKey}`, { component: 'PreviewService' });
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Send initial status
    const status = this.getPreviewStatus(tenantId, userId, projectId, feature);
    res.write(`data: ${JSON.stringify({ type: 'status', data: status })}\n\n`);
    
    // Send existing logs
    const existingLogs = this.logManager.getLogs(serverKey);
    existingLogs.forEach((log: LogEntry) => {
      res.write(`data: ${JSON.stringify({ type: 'log', data: log })}\n\n`);
    });
  }
  
  /**
   * Cleanup all preview servers
   */
  async cleanup(): Promise<void> {
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
