import { ChildProcess } from 'child_process';
import { Response } from 'express';
import * as path from 'path';
import { LogEntry } from '../../../../../core/ports/http';
import { PortManager } from '../../../../../infrastructure/networking/PortManager';
import { PortRegistryPort } from '../../../../../core/ports/portRegistry';
import { SSEService } from '../SSEService';
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
  private devServers: Map<string, ChildProcess[]> = new Map();
  private devServerPorts: Map<string, number> = new Map();
  private devServerReady: Map<string, boolean> = new Map();
  private installingProjects: Set<string> = new Set();
  private devServerPackagePorts: Map<string, Array<{ name: string; type: 'frontend' | 'backend' | 'other'; port: number }>> = new Map();
  private devServerIssues: Map<string, PreviewIssue[]> = new Map();
  
  // Stopping state management
  private stoppingServers: Set<string> = new Set();
  private stoppingPidsByServer: Map<string, Set<number>> = new Map();
  private stoppingCleanupTimers: Map<string, NodeJS.Timeout> = new Map();
  
  // Dependencies
  private onStatusChange?: (serverKey: string) => void;
  private portManager?: PortManager;
  private portRegistry?: PortRegistryPort;
  private sseService?: SSEService;
  
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
    sseService?: SSEService
  ) {
    this.portManager = portManager;
    this.portRegistry = portRegistry;
    this.onStatusChange = callbacks?.onStatusChange;
    this.sseService = sseService;
    
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
   * Append log entry and broadcast via SSEService
   */
  private appendLog(serverKey: string, type: 'stdout' | 'stderr', message: string): void {
    const logEntry = this.logManager.appendLog(serverKey, type, message);
    
    if (this.sseService) {
      const { tenantId, userId, projectId, feature } = this.parseServerKey(serverKey);
      this.sseService.broadcast(projectId, feature, 'preview', {
        type: 'log',
        data: logEntry
      }, { organizationId: tenantId, userId, workspacePath: '' });
    }
  }
  
  /**
   * Broadcast status update via SSEService
   */
  private broadcastStatus(serverKey: string, status: any): void {
    logger.debug('Broadcasting status update', { component: 'PreviewService' }, { serverKey, status });
    
    if (this.sseService) {
      const { tenantId, userId, projectId, feature } = this.parseServerKey(serverKey);
      this.sseService.broadcast(projectId, feature, 'preview', {
        type: 'status',
        data: status
      }, { organizationId: tenantId, userId, workspacePath: '' });
    }
    
    if (this.onStatusChange) {
      this.onStatusChange(serverKey);
    }
  }
  
  /**
   * Validate dev server setup for frontend projects
   */
  async validateDevServerSetup(codebasePath: string): Promise<ValidationResult> {
    return await this.projectValidator.validate(codebasePath);
  }
  
  /**
   * Start dev server for a project feature
   */
  async startDevServer(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    localPath: string,
    port?: number
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
    const serverKey = this.createServerKey(tenantId, userId, projectId, feature);
    const proxyUrl = `/preview/${serverKey}`;
    
    // Check if already running
    if (this.devServers.has(serverKey)) {
      const existingPort = this.devServerPorts.get(serverKey);
      return { 
        success: false, 
        error: 'Dev server already running', 
        port: existingPort,
        serverKey,
        url: proxyUrl
      };
    }
    
    // Check if installing
    if (this.installingProjects.has(serverKey)) {
      return { success: false, error: 'Dependencies are being installed. Please wait...' };
    }
    
    this.installingProjects.add(serverKey);
    
    try {
      // 1. Detect project structure
      const structure = await this.structureDetector.detect(localPath);
      
      if (structure.packages.length === 0) {
        throw new Error('No runnable packages found');
      }
      
      // 2. Install dependencies for all packages
      const logCallback = (type: 'stdout' | 'stderr', msg: string) => this.appendLog(serverKey, type, msg);
      for (const pkg of structure.packages) {
        await this.dependencyInstaller.installIfNeeded(pkg.path, pkg.name, logCallback);
      }
      
      this.installingProjects.delete(serverKey);
      
      // 3. Allocate ports and start all dev servers
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
      this.devServerPackagePorts.set(serverKey, packagePorts);
      
      // 4. Register entry in PortRegistry
      if (structure.entry && this.portRegistry) {
        await this.portRegistry.registerPreview(
          tenantId, userId, projectId, feature,
          structure.entry.port!
        );
        logger.info(`Registered entry: ${serverKey} -> ${structure.entry.port}`, { component: 'PreviewService' });
      }
      
      // 5. Store processes and entry port
      this.devServers.set(serverKey, processes);
      this.devServerPorts.set(serverKey, structure.entry?.port || structure.packages[0].port!);
      
      this.appendLog(serverKey, 'stdout', '✅ All dev servers started successfully!');
      
      // 6. Validate frontend setup
      let validation: ValidationResult = { valid: true };
      
      if (structure.entry?.type === 'frontend') {
        validation = await this.validateDevServerSetup(structure.entry.path);
        
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
        this.devServerIssues.set(serverKey, issues);
        const updatedStatus = this.getDevServerStatus(tenantId, userId, projectId, feature);
        this.broadcastStatus(serverKey, updatedStatus);
      } else {
        this.devServerIssues.delete(serverKey);
      }
      
      // 8. Broadcast running status
      const runningStatus = this.getDevServerStatus(tenantId, userId, projectId, feature);
      this.broadcastStatus(serverKey, runningStatus);
      
      // 9. Health check (async)
      const entryPort = structure.entry?.port || structure.packages[0].port!;
      this.healthChecker.check(entryPort, logCallback).then(ready => {
        this.devServerReady.set(serverKey, ready);
        const updatedStatus = this.getDevServerStatus(tenantId, userId, projectId, feature);
        this.broadcastStatus(serverKey, updatedStatus);
      });
      
      const finalStatus = this.getDevServerStatus(tenantId, userId, projectId, feature);
      
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
      logger.error(`Error starting dev server: ${error.message}`, { component: 'PreviewService' }, error);
      this.appendLog(serverKey, 'stderr', `❌ Error: ${error.message}`);
      
      return {
        success: false,
        error: error.message || 'Failed to start dev server'
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
    this.devServers.delete(serverKey);
    this.devServerPorts.delete(serverKey);
    this.devServerReady.delete(serverKey);
    this.logManager.clearLogs(serverKey);
    this.devServerPackagePorts.delete(serverKey);
    this.devServerIssues.delete(serverKey);
    
    if (this.portRegistry) {
      await this.portRegistry.unregisterPreview(tenantId, userId, projectId, feature);
    }

    // Build issues stack
    const issues: PreviewIssue[] = [];
    issues.push(this.issueDetector.createFatalIssue(
      (validation.reasoning || 'unknown') as PreviewIssueReasoning,
      validation.reason || 'Dev server setup validation failed',
      validation.suggestedFix
    ));
    
    try {
      const hasBackend = orderedPackages.some(p => p.type === 'backend');
      const apiIssue = hasBackend ? await this.issueDetector.detectApiBaseIssue(entryPath) : null;
      if (apiIssue) issues.push(apiIssue);
    } catch {
      // Best-effort only
    }
    
    this.devServerIssues.set(serverKey, issues);
    const combinedSuggestedFix = this.issueDetector.combineIssueFixes(issues);
    
    return {
      success: false,
      error: 'Dev server setup validation failed',
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
      const updatedStatus = this.getDevServerStatus(tenantId, userId, projectId, feature);
      this.broadcastStatus(serverKey, updatedStatus);
    } catch (e: any) {
      // Don't crash on exit handler
    }
  }
  
  private getCurrentPidForServer(serverKey: string): number | undefined {
    const processes = this.devServers.get(serverKey);
    return processes?.[0]?.pid;
  }
  
  /**
   * Handle process error
   */
  private handleProcessError(serverKey: string, pkgName: string, error: Error): void {
    this.appendLog(serverKey, 'stderr', `❌ ${pkgName} error: ${error.message}`);
    
    try {
      const { tenantId, userId, projectId, feature } = this.parseServerKey(serverKey);
      const updatedStatus = this.getDevServerStatus(tenantId, userId, projectId, feature);
      this.broadcastStatus(serverKey, updatedStatus);
    } catch (e: any) {
      // Ignore
    }
  }
  
  /**
   * Stop dev server
   */
  async stopDevServer(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<{ success: boolean; message?: string; error?: string }> {
    const serverKey = this.createServerKey(tenantId, userId, projectId, feature);
    
    const processes = this.devServers.get(serverKey);
    if (!processes || processes.length === 0) {
      return { success: false, error: 'Dev server not running' };
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
    const port = this.devServerPorts.get(serverKey);
    if (port && this.portManager) {
      await this.portManager.release(port);
    }
    
    // Unregister from PortRegistry
    if (this.portRegistry) {
      await this.portRegistry.unregisterPreview(tenantId, userId, projectId, feature);
    }
    
    // Cleanup
    this.devServers.delete(serverKey);
    this.devServerPorts.delete(serverKey);
    this.devServerReady.delete(serverKey);
    this.logManager.clearLogs(serverKey);
    this.devServerPackagePorts.delete(serverKey);
    this.devServerIssues.delete(serverKey);
    
    logger.info(`Stopped all servers for ${serverKey}`, { component: 'PreviewService' });
    
    // Broadcast stopped status
    try {
      const updatedStatus = this.getDevServerStatus(tenantId, userId, projectId, feature);
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
   * Get dev server status
   */
  getDevServerStatus(
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
    const processes = this.devServers.get(serverKey);
    const port = this.devServerPorts.get(serverKey);
    const ready = this.devServerReady.get(serverKey) || false;
    const packages = this.devServerPackagePorts.get(serverKey) || [];
    const backendPort = packages.find(p => p.type === 'backend')?.port;
    const issues = this.devServerIssues.get(serverKey) || [];
    
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
   * Get logs for a dev server
   */
  getDevServerLogs(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): LogEntry[] {
    const serverKey = this.createServerKey(tenantId, userId, projectId, feature);
    return this.logManager.getLogs(serverKey);
  }
  
  /**
   * Stream logs via SSE
   */
  streamDevServerLogs(
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
    const status = this.getDevServerStatus(tenantId, userId, projectId, feature);
    if (this.sseService) {
      this.sseService.sendInitialState(res, 'preview', { type: 'status', data: status });
    } else {
      res.write(`data: ${JSON.stringify({ type: 'status', data: status })}\n\n`);
    }
    
    // Send existing logs
    const existingLogs = this.logManager.getLogs(serverKey);
    existingLogs.forEach((log: LogEntry) => {
      if (this.sseService) {
        this.sseService.sendInitialState(res, 'preview', { type: 'log', data: log });
      } else {
        res.write(`data: ${JSON.stringify({ type: 'log', data: log })}\n\n`);
      }
    });
    
    // Register client with SSEService
    if (this.sseService) {
      this.sseService.registerClient(projectId, feature, res, { organizationId: tenantId, userId, workspacePath: '' });
    }
  }
  
  /**
   * Cleanup all dev servers
   */
  async cleanup(): Promise<void> {
    const serverKeys = Array.from(this.devServers.keys());
    
    if (serverKeys.length === 0) {
      logger.debug('No running dev servers to cleanup', { component: 'PreviewService' });
      return;
    }
    
    logger.info(`Cleaning up ${serverKeys.length} dev server(s)...`, { component: 'PreviewService' });
    
    const cleanupPromises: Promise<void>[] = [];
    
    for (const serverKey of serverKeys) {
      const { tenantId, userId, projectId, feature } = this.parseServerKey(serverKey);
      
      const cleanupPromise = this.stopDevServer(tenantId, userId, projectId, feature)
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
