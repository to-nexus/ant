import { ChildProcess } from 'child_process';
import { Response } from 'express';
import * as path from 'path';
import * as os from 'os';
import { LogEntry } from '../../../../../core/ports/http';
import { PortManager } from '../../../../../infrastructure/networking/PortManager';
import { PortRegistryPort, PreviewState, PreviewPackage, PreviewPhase, ServiceConnection } from '../../../../../core/ports/portRegistry';
import type { StateStorePort } from '../../../../../core/ports/stateStore';
import { PreviewIssue, PreviewIssueReasoning, PackageInfo, ValidationResult } from './types';
import { createServerKey, parseServerKey, toUrlKey, toUrlKeyWithService, packageSlug } from './utils/serverKeyUtils';
import { LogManager } from './managers/LogManager';
import { PackageDetector } from './detectors/PackageDetector';
import { ProjectValidator } from './validators/ProjectValidator';
import { ProjectStructureDetector } from './detectors/ProjectStructureDetector';
import { ConnectionDetector } from './detectors/ConnectionDetector';
import { RuntimeDiagnostics } from './detectors/RuntimeDiagnostics';
import { DependencyInstaller } from './managers/DependencyInstaller';
import { ProcessSpawner } from './managers/ProcessSpawner';
import { InfrastructureManager } from './managers/InfrastructureManager';
import { HealthChecker } from './utils/HealthChecker';
import { IssueDetector } from './detectors/IssueDetector';
import { logger } from '../../../../../utils/logger';
import { getRealtimeBroadcastChannel } from '../../../../../infrastructure/state';
import { CredentialsStore, GitHubCredentials, buildCredentialEnv } from '../../../../../utils/userConfig';
import { DevProcessControl, isPortConflictOutput } from '../../../../../core/process/DevProcessControl';

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
  private startAbortControllers: Map<string, AbortController> = new Map(); // abort ongoing install/infra during startup
  private stoppingServers: Set<string> = new Set();
  private stoppingPidsByServer: Map<string, Set<number>> = new Map();
  private stoppingCleanupTimers: Map<string, NodeJS.Timeout> = new Map();
  
  // Spawn timestamps for early-exit detection (RuntimeDiagnostics)
  private spawnTimestamps: Map<string, number> = new Map();
  
  // Health check abort controllers (cancel on process exit or stop)
  private healthCheckAbortControllers: Map<string, AbortController> = new Map();
  
  // Idle check
  private idleCheckTimer: ReturnType<typeof setInterval> | null = null;
  private idleTimeoutMs: number = DEFAULT_IDLE_TIMEOUT_MS;
  
  // Dependencies
  private onStatusChange?: (serverKey: string) => void;
  private portManager?: PortManager;
  private portRegistry?: PortRegistryPort;
  private stateStore?: StateStorePort;
  private workspaceRoot?: string;
  
  // Modular components
  private logManager: LogManager;
  private packageDetector: PackageDetector;
  private projectValidator: ProjectValidator;
  private structureDetector: ProjectStructureDetector;
  private connectionDetector: ConnectionDetector;
  private runtimeDiagnostics: RuntimeDiagnostics;
  private dependencyInstaller: DependencyInstaller;
  private processSpawner: ProcessSpawner;
  private infrastructureManager: InfrastructureManager;
  private healthChecker: HealthChecker;
  private issueDetector: IssueDetector;

  /** SSOT for descendant kill / Next-lock cleanup / port detection.
   *  Shared instance from `processSpawner` so both classes operate on the
   *  same logger sink and platform gates. */
  private dev: DevProcessControl;
  
  constructor(
    portManager?: PortManager,
    portRegistry?: PortRegistryPort,
    callbacks?: {
      onStatusChange?: (serverKey: string) => void;
    },
    stateStore?: StateStorePort,
    workspaceRoot?: string
  ) {
    this.portManager = portManager;
    this.portRegistry = portRegistry;
    this.onStatusChange = callbacks?.onStatusChange;
    this.stateStore = stateStore;
    this.workspaceRoot = workspaceRoot;
    
    // Initialize modular components
    this.logManager = new LogManager();
    this.packageDetector = new PackageDetector();
    this.projectValidator = new ProjectValidator();
    this.structureDetector = new ProjectStructureDetector(this.packageDetector);
    this.connectionDetector = new ConnectionDetector();
    this.runtimeDiagnostics = new RuntimeDiagnostics();
    this.dependencyInstaller = new DependencyInstaller();
    this.processSpawner = new ProcessSpawner();
    this.infrastructureManager = new InfrastructureManager();
    this.healthChecker = new HealthChecker();
    this.issueDetector = new IssueDetector();
    this.dev = this.processSpawner.getDevProcessControl();
  }
  
  /**
   * Read GitHub PAT from CredentialsStore and build env vars for private module access.
   * Returns empty object on any failure (safe no-op).
   */
  private async getCredentialEnv(
    orgId: string,
    userId: string,
    projectId: string,
    codebasePath?: string
  ): Promise<Record<string, string>> {
    try {
      const wsRoot = this.workspaceRoot || process.env.ANT_WORKSPACE_BASE_PATH;
      if (!wsRoot) return {};

      const store = new CredentialsStore(wsRoot);
      const creds = await store.get<GitHubCredentials>(
        { organizationId: orgId, userId },
        'github'
      );
      if (!creds?.token) return {};

      const fs = await import('fs');
      const pathMod = await import('path');
      const configPath = pathMod.join(wsRoot, orgId, userId, projectId, 'config.json');
      let githubRepo: string | null = null;
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        githubRepo = config.githubRepo || null;
      }

      const credEnv = buildCredentialEnv(creds.token, githubRepo, codebasePath);
      if (Object.keys(credEnv).length > 0) {
        logger.info('🔑 Injecting GitHub credentials for private module access', { component: 'PreviewService' });
      }
      return credEnv;
    } catch {
      return {};
    }
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
            // Top-level url is the "representative" Open URL. For
            // multi-frontend monorepos there is no single representative —
            // emit `null` so old FE clients gracefully hide the Open button
            // instead of silently opening an arbitrary frontend. New FE
            // clients fall back to per-package URLs in `packages[].url`.
            url: this.computeTopLevelUrl(state.packages, state.port, serverKey) || undefined,
            packages: this.enrichPackagesWithUrl(state.packages || []),
            issues: state.issues || [],
            structureType: state.structureType || undefined,
            connections: state.connections || [],
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
        userContext: { organizationId: tenantId, userId },
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
        userContext: { organizationId: tenantId, userId },
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
   * Decide the "representative" Open URL emitted at the top level of the
   * status payload.
   *
   * 0 frontends    → null (backend-only project; no public URL).
   * 1 frontend     → `/{4partUrlKey}`. Equals the legacy single-package URL —
   *                  bit-stable for callers that haven't migrated to
   *                  `packages[].url` yet.
   * 2+ frontends   → null. Old FE clients gracefully hide the Open button;
   *                  new FE clients render one Open button per
   *                  `packages[].url`.
   *
   * Falls back to legacy `port`-based URL when `packages` is empty (e.g.
   * stale Redis records written by older builds — they had no `packages` at
   * all and a single top-level port).
   */
  private computeTopLevelUrl(
    packages: PreviewPackage[] | undefined,
    legacyPort: number | undefined,
    serverKey: string
  ): string | null {
    const frontends = (packages || []).filter(p => p.type === 'frontend');
    if (frontends.length === 1) {
      return frontends[0].urlKey ? `/${frontends[0].urlKey}` : `/${toUrlKey(serverKey)}`;
    }
    if (frontends.length === 0) {
      // Legacy fallback: backend-only state with port set, or stale state
      // missing `packages`. Single 4-part URL is still useful to stale
      // clients (e.g. cross-project proxy).
      return legacyPort ? `/${toUrlKey(serverKey)}` : null;
    }
    return null;
  }

  /**
   * Enrich `PreviewPackage[]` with a per-frontend `url` field for FE
   * consumption. Backend / other packages get `url: null` to make absence
   * explicit.
   */
  private enrichPackagesWithUrl(packages: PreviewPackage[]): Array<PreviewPackage & { url: string | null }> {
    return packages.map(p => ({
      ...p,
      url: p.type === 'frontend' && p.urlKey ? `/${p.urlKey}` : null,
    }));
  }

  /**
   * Assign URL-safe slug + per-package `urlKey` to every package, in place.
   *
   * Single-frontend rule (1 frontend, possibly N non-frontend):
   *   the lone frontend gets the 4-part `urlKey = toUrlKey(serverKey)`
   *   so existing single-package URLs remain bit-stable.
   *
   * Multi-frontend rule (>= 2 frontends):
   *   every frontend gets a 5-part `urlKey = toUrlKeyWithService(serverKey, slug)`
   *   carrying its slug. There is NO "primary" frontend.
   *
   * Backend / other packages always receive a slug (used by the proxy when
   * resolving cross-project `serviceName` connections) but never a `urlKey` —
   * they have no public URL and no basePath to inject.
   *
   * Slug derivation is delegated to `packageSlug()` (SSOT). Collisions are
   * resolved by appending `-2`, `-3`, … in the order packages appear in
   * `structure.packages`. This is deterministic across restarts because the
   * detector returns packages in stable order (sorted by path).
   */
  private assignPackageUrlIdentity(packages: PackageInfo[], serverKey: string): void {
    const used = new Set<string>();
    for (const pkg of packages) {
      let base = packageSlug(pkg.name);
      let slug = base;
      let suffix = 2;
      while (used.has(slug)) {
        slug = `${base}-${suffix++}`;
      }
      used.add(slug);
      pkg.slug = slug;
    }

    const frontendCount = packages.filter(p => p.type === 'frontend').length;
    for (const pkg of packages) {
      if (pkg.type !== 'frontend') {
        pkg.urlKey = undefined;
        continue;
      }
      pkg.urlKey = frontendCount > 1
        ? toUrlKeyWithService(serverKey, pkg.slug!)
        : toUrlKey(serverKey);
    }
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
    /**
     * Representative Open URL.
     * `null` when there are 2+ frontends (caller must use `status.packages[].url`).
     */
    url?: string | null;
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
    
    // Clear previous session logs on new start
    this.logManager.clearLogs(serverKey);
    
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
        // Suppress the trailing 'stopped' broadcast so the UI keeps the
        // restart loading state continuously: stopping → installing →
        // starting → running. Without this the browser briefly sees
        // 'stopped' and disables the cancel button + clears the log feed
        // until the next 'installing' broadcast lands.
        //
        // stopPreview already polls `waitForCleanState` (3s) for ports +
        // Next dev locks, so we don't need an additional wait here — the
        // SSOT guarantee lives inside stopPreview, not at every caller.
        await this.stopPreview(tenantId, userId, projectId, feature, {
          suppressStoppedBroadcast: true,
        });
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
        // Stop stale Docker infrastructure (may be orphaned from a crashed Pod or different Pod's stop)
        try {
          const infraProjectName = `ant-${projectId}-${feature}`.replace(/[^a-zA-Z0-9_-]/g, '-');
          const logCb = (type: 'stdout' | 'stderr', msg: string) => this.appendLog(serverKey, type, msg);
          await this.infrastructureManager.stopInfrastructure(localPath, logCb, infraProjectName);
        } catch { /* best-effort */ }
        // Unregister from portRegistry since we'll re-register after starting
        await this.portRegistry.unregisterPreview(tenantId, userId, projectId, feature);
      }
    }
    
    // Pre-flight cleanup: kill any lingering dev processes for this codebase
    // BEFORE we start spawning. The previous behaviour only scanned the
    // workspace root via `killOrphanProcesses(localPath)`, which missed
    // (a) detached `next dev` grandchildren whose ps line referenced only
    // the package cwd (e.g. `apps/hub`), and (b) Next dev locks
    // (`.next/dev/server.json`) that block the new spawn even when the
    // recorded PID is dead.
    //
    // Pre-spawn we don't yet know per-package cwds (structure detection
    // happens further down), so we sweep the workspace root first; the
    // package-cwd sweep happens at the spawn site below where the cwds
    // are known. See B' in the preview-cleanup plan.
    const fs = await import('fs');
    const preflightFound = await this.dev.detect({ cwds: [localPath], ports: [] });
    if (preflightFound.length > 0) {
      this.appendLog(serverKey, 'stdout',
        `⚠️  Detected ${preflightFound.length} stale dev process(es) under ${localPath}. Cleaning up before start...`);
      await this.dev.forceCleanup(preflightFound);
      await this.dev.waitForCleanState({ cwds: [localPath], ports: [], timeoutMs: 5_000 });
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
    const startAbort = new AbortController();
    this.startAbortControllers.set(serverKey, startAbort);
    const startSignal = startAbort.signal;
    
    // Track every ChildProcess we successfully spawn so the catch block
    // below can tear them down. Without this, an exception thrown after
    // the spawn loop but BEFORE `previewServers.set(serverKey, processes)`
    // would leave detached children running forever (cleanupIfAllDead
    // early-returns when the serverKey is missing from the map).
    // We carry cwd + port alongside so the catch handler can also clean
    // Next dev locks and release allocated ports for the failed packages.
    const spawned: Array<{ child: ChildProcess; cwd: string; port: number }> = [];

    try {
      // 0. Register in Redis immediately with phase: 'installing'
      //    This ensures ANY pod can report the current state, even before processes start.
      const host = this.getPodHost();
      if (this.portRegistry) {
        await this.portRegistry.registerPreview({
          tenantId, userId, projectId, feature,
          running: false, ready: false,
          port: 0,
          host,
          podId: os.hostname(),
          phase: 'installing',
          packages: [],
          issues: [],
          connections: [],
          startedAt: new Date()
        });
      }
      await this.updatePhase(serverKey, 'installing');
      
      // 1. Detect project structure
      //    Read projectProfile from Preview Config (set by decompose via PreviewBroadcaster)
      let projectProfile: { language: string; framework?: string } | undefined;
      if (this.stateStore) {
        try {
          const previewConfig = await this.stateStore.getPreviewConfig(tenantId, userId, projectId, feature);
          if (previewConfig?.projectProfile) {
            projectProfile = previewConfig.projectProfile;
            logger.info(`[Preview] Using projectProfile from config: ${projectProfile.language}/${projectProfile.framework || 'none'}`, { component: 'PreviewService' });
          }
        } catch { /* best-effort */ }
      }
      
      const structure = await this.structureDetector.detect(localPath, projectProfile);
      logger.warn(`[Preview] Structure: type=${structure.type}, packages=${structure.packages.length}, entry=${structure.entry?.name || 'none'}`, { component: 'PreviewService' });
      
      if (structure.packages.length === 0) {
        throw new Error('No runnable packages found');
      }
      
      // 1.1. Save structureType + projectProfile to Redis (auto-detect for Preview Config UI)
      const detectedProfile = structure.entry?.projectProfile || structure.packages[0]?.projectProfile;
      if (this.portRegistry) {
        await this.portRegistry.updatePreview(tenantId, userId, projectId, feature, {
          structureType: structure.type as any,
          ...(detectedProfile ? { projectProfile: detectedProfile } : {}),
        });
      }
      
      // 2. Install dependencies for all packages
      const logCallback = (type: 'stdout' | 'stderr', msg: string) => this.appendLog(serverKey, type, msg);
      const credentialEnv = await this.getCredentialEnv(tenantId, userId, projectId, localPath);
      for (const pkg of structure.packages) {
        if (startSignal.aborted) throw new Error('Preview start cancelled');
        await this.dependencyInstaller.installIfNeeded(pkg.path, pkg.name, logCallback, pkg.projectProfile, credentialEnv, startSignal);
      }
      
      this.installingProjects.delete(serverKey);
      
      // 2.5. Start infrastructure services (if docker-compose.yml exists)
      if (startSignal.aborted) throw new Error('Preview start cancelled');
      this.previewServerPaths.set(serverKey, localPath);
      const infraProjectName = `ant-${projectId}-${feature}`.replace(/[^a-zA-Z0-9_-]/g, '-');
      await this.infrastructureManager.startInfrastructure(localPath, logCallback, infraProjectName, startSignal);
      if (startSignal.aborted) throw new Error('Preview start cancelled');
      
      const infraStatus = await this.infrastructureManager.getInfraStatus(localPath, infraProjectName);

      // 3. Allocate ports and start all preview servers
      const processes: ChildProcess[] = [];
      let backendPort: number | undefined;
      
      // Start backend first
      const orderedPackages = [...structure.packages].sort((a, b) => {
        const prio = (p: PackageInfo) => (p.type === 'backend' ? 0 : p.type === 'frontend' ? 1 : 2);
        return prio(a) - prio(b);
      });
      
      // Allocate ports for all packages
      for (const pkg of orderedPackages) {
        const pkgPort = this.portManager 
          ? await this.portManager.allocate() 
          : 3000 + processes.length;
        pkg.port = pkgPort;
        if (!backendPort && pkg.type === 'backend') {
          backendPort = pkgPort;
        }
      }

      // Assign URL-safe slug + per-package urlKey BEFORE spawning so the
      // ProcessSpawner can inject the correct ANT_BASE_PATH / VITE_BASE_PATH /
      // NEXT_PUBLIC_BASE_PATH for each frontend. Required for multi-frontend
      // monorepos where each dev server is reachable at a unique URL.
      this.assignPackageUrlIdentity(orderedPackages, serverKey);

      // Read connections from Redis registry, auto-detect if empty
      const savedConfig = this.stateStore
        ? await this.stateStore.getPreviewConfig(tenantId, userId, projectId, feature)
        : null;
      let connections: ServiceConnection[] = savedConfig?.connections || [];

      if (connections.length === 0) {
        try {
          const detected = this.connectionDetector.detect(localPath, structure, serverKey);
          if (detected.length > 0) {
            connections = detected;
            if (this.stateStore) {
              await this.stateStore.savePreviewConfig(tenantId, userId, projectId, feature, { connections });
            }
            logger.info(`[Preview] Auto-detected ${connections.length} connections for ${serverKey}`, { component: 'PreviewService' });
          }
        } catch (err: any) {
          logger.debug(`[Preview] Connection auto-detect failed: ${err.message}`, { component: 'PreviewService' });
        }
      }

      // Update connection status based on infrastructure state
      if (infraStatus.length > 0) {
        for (const conn of connections) {
          const isDocker = typeof conn.resolution === 'object' && conn.resolution?.type === 'docker';
          if (isDocker) {
            const dockerService = (conn.resolution as { type: 'docker'; service: string }).service || conn.id;
            const svc = infraStatus.find(s =>
              s.name === dockerService || conn.id.includes(s.name) || s.name.includes(conn.id)
            );
            conn.status = svc?.status === 'running' ? 'active'
                        : svc?.status === 'stopped' ? 'stopped'
                        : svc ? 'error' : conn.status;
          }
        }
      }

      // Enrich ant-project connections with target preview status
      if (this.portRegistry) {
        for (const conn of connections) {
          const isAntProject = typeof conn.resolution === 'object' && conn.resolution?.type === 'ant-project';
          if (isAntProject) {
            const res = conn.resolution as { type: 'ant-project'; projectId: string; feature: string };
            try {
              const targetState = await this.portRegistry.getPreview(tenantId, userId, res.projectId, res.feature);
              conn.status = targetState?.running && targetState?.ready ? 'active'
                          : targetState?.running ? 'starting'
                          : 'stopped';
            } catch { conn.status = 'error'; }
          }
        }
      }

      logger.info(`[Preview] ${connections.length} connections from registry for ${serverKey}`, { component: 'PreviewService' });

      if (startSignal.aborted) throw new Error('Preview start cancelled');

      // Per-package pre-flight: now that ports are allocated and cwds known,
      // sweep each package cwd + port for stale dev processes/locks. This
      // closes the gap where a previous run's `next dev` survived in
      // `apps/hub` but the workspace-root sweep above didn't match.
      const allPkgCwds = orderedPackages.map(p => p.path);
      const allPkgPorts = orderedPackages.map(p => p.port!).filter((n): n is number => typeof n === 'number');
      const pkgFlightFound = await this.dev.detect({ cwds: allPkgCwds, ports: allPkgPorts });
      if (pkgFlightFound.length > 0) {
        this.appendLog(serverKey, 'stdout',
          `⚠️  Detected ${pkgFlightFound.length} stale dev process(es) on package ports/cwds. Cleaning up...`);
        await this.dev.forceCleanup(pkgFlightFound);
        await this.dev.waitForCleanState({ cwds: allPkgCwds, ports: allPkgPorts, timeoutMs: 5_000 });
      }

      // Spawn processes with connections (filtered by source in ProcessSpawner).
      // `spawnWithConflictRetry` watches each child for ~6s after spawn — if
      // it dies with a port-conflict signature (Next "Another dev server",
      // EADDRINUSE, Vite "Port X is already in use"), DPC cleans the port +
      // lock and we re-spawn ONCE for that package. Other packages are
      // unaffected; non-conflict failures fall through to normal handling.
      for (const pkg of orderedPackages) {
        const pkgPort = pkg.port!;
        const packageSource = path.relative(localPath, pkg.path) || '*';

        const childProcess = await this.spawnWithConflictRetry(pkg, pkgPort, {
          serverKey,
          packageUrlKey: pkg.urlKey,
          projectRoot: localPath,
          connections,
          packageSource,
          baseLog: (type, msg) => this.appendLog(serverKey, type, msg),
          baseExit: (code, signal, exitedPid) =>
            this.handleProcessExit(serverKey, pkg.name, exitedPid ?? null, code, signal),
          baseError: (error) => this.handleProcessError(serverKey, pkg.name, error),
        });

        pkg.process = childProcess;
        processes.push(childProcess);
        spawned.push({ child: childProcess, cwd: pkg.path, port: pkgPort });
      }

      // Record spawn timestamp for early-exit detection
      this.spawnTimestamps.set(serverKey, Date.now());

      // Build package ports for Redis registration. Persist `slug` + per-package
      // `urlKey` so the proxy can route `/{4part}--{slug}/...` requests directly
      // to the matching frontend dev server, and so the FE can render an
      // "Open" button per accessible frontend.
      const packagePorts: PreviewPackage[] = orderedPackages
        .filter(p => typeof p.port === 'number')
        .map(p => ({
          name: p.name,
          slug: p.slug,
          type: p.type,
          port: p.port as number,
          urlKey: p.urlKey,
        }));
      
      // 4. Update Redis with full port/package info + phase: 'starting'
      //    Use entry port (frontend) if available, otherwise first package port
      //    (backend-only projects still need a registered port for cross-project proxy routing).
      const entryPort = structure.entry?.port ?? orderedPackages[0]?.port;
      if (entryPort && this.portRegistry) {
        const backendPort = packagePorts.find(p => p.type === 'backend')?.port;
        
        const previewState: Omit<PreviewState, 'lastAccessedAt'> = {
          tenantId,
          userId,
          projectId,
          feature,
          running: true,
          ready: false,  // Will be updated after health check
          phase: 'starting',
          port: entryPort,
          backendPort,
          structureType: structure.type as any,
          connections,
          host,
          podId: os.hostname(),
          packages: packagePorts,
          issues: [],
          startedAt: new Date()
        };
        
        await this.portRegistry.registerPreview(previewState);
        logger.info(`[Preview] Registered: ${serverKey} -> ${host}:${entryPort}`, { component: 'PreviewService' });
      }

      // Save connections separately if registerPreview was skipped
      if (!entryPort && connections.length > 0 && this.portRegistry) {
        await this.portRegistry.updatePreview(tenantId, userId, projectId, feature, { connections });
      }

      await this.updatePhase(serverKey, 'starting', { running: true });
      
      // 5. Store processes (port is already in Redis via registerPreview)
      this.previewServers.set(serverKey, processes);
      this.startingServers.delete(serverKey);
      this.startAbortControllers.delete(serverKey);
      
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
      
      // 6. Validate frontend setup.
      //    Single-frontend: entry validation is fatal (existing behavior).
      //    Multi-frontend:  entry validation remains fatal (the project has
      //                     a primary frontend by convention — first frontend
      //                     in detector order). Validation failures of OTHER
      //                     frontends become non-fatal `warning` issues so
      //                     the preview still starts and the user can fix
      //                     each misconfigured frontend through the same
      //                     "Fix" UI flow.
      let validation: ValidationResult = { valid: true };
      const issues: PreviewIssue[] = [];
      const frontendPackages = orderedPackages.filter(p => p.type === 'frontend');
      
      if (structure.entry?.type === 'frontend') {
        validation = await this.validatePreviewSetup(structure.entry.path);
        
        if (!validation.valid) {
          return this.handleValidationFailure(serverKey, tenantId, userId, projectId, feature, processes, orderedPackages, structure.entry.path, validation);
        }
        
        if (validation.framework) {
          logger.info(`[Preview] Framework detected: ${validation.framework} for ${serverKey}`, { component: 'PreviewService' });
        }

        // Multi-frontend: validate each non-entry frontend so the user is
        // aware of misconfigured packages BEFORE clicking their Open link.
        // Failures emit warning-level issues — the entry frontend keeps the
        // existing fatal semantic for back-compat with single-frontend flows.
        if (frontendPackages.length > 1) {
          for (const fp of frontendPackages) {
            if (fp.path === structure.entry.path) continue;
            try {
              const fpValidation = await this.validatePreviewSetup(fp.path);
              if (!fpValidation.valid) {
                issues.push({
                  reasoning: (fpValidation.reasoning || 'unknown') as PreviewIssueReasoning,
                  severity: 'warning',
                  reason: `[${fp.name}] ${fpValidation.reason || 'Preview server setup validation failed'}`,
                  suggestedFix: fpValidation.suggestedFix,
                });
                logger.warn(`[Preview] Validation warning for ${fp.name}: ${fpValidation.reason}`, { component: 'PreviewService' });
              }
            } catch (err: any) {
              logger.warn(`[Preview] Validator threw for ${fp.name}: ${err.message}`, { component: 'PreviewService' });
            }
          }
        }
      }

      // 7. Non-fatal issues detection
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
      const healthAbort = new AbortController();
      this.healthCheckAbortControllers.set(serverKey, healthAbort);
      this.healthChecker.check(entryPort!, logCallback, undefined, undefined, healthAbort.signal).then(async (ready) => {
        this.healthCheckAbortControllers.delete(serverKey);
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

      // Conditional re-broadcast to handle late-subscribing FE clients
      // (handler registered after install→starting events already fired —
      // no event buffering exists). We ONLY re-push while still in a
      // transitional phase; if health check resolved faster than the
      // `getPreviewStatus` read above, `updatePhase('running')` has
      // already published the authoritative `phase:'running'` event and
      // re-broadcasting this pre-read snapshot would race-overwrite the
      // FE state back to 'starting'.
      const transitionalPhase =
        !finalStatus?.phase ||
        finalStatus.phase === 'idle' ||
        finalStatus.phase === 'installing' ||
        finalStatus.phase === 'starting';
      if (transitionalPhase) {
        this.broadcastStatus(serverKey, finalStatus);
      }

      return {
        success: true,
        message: `Started ${structure.packages.length} package(s)`,
        port: entryPort!,
        serverKey,
        // For multi-frontend monorepos `finalStatus.url` is `null` — pass
        // it through unchanged so the HTTP response is in sync with SSE.
        // Old single-frontend semantics are preserved: `proxyUrl` matches
        // `finalStatus.url` for that case.
        url: finalStatus?.url ?? proxyUrl,
        setupReasoning: validation.reasoning,
        setupReason: validation.reason,
        suggestedFix: validation.suggestedFix,
        status: finalStatus
      };
      
    } catch (error: any) {
      const wasCancelled = this.startCancelledServers.has(serverKey);
      this.installingProjects.delete(serverKey);
      this.startingServers.delete(serverKey);
      this.startCancelledServers.delete(serverKey);
      this.startAbortControllers.delete(serverKey);
      
      // Release distributed lock on failure
      if (this.stateStore && lockAcquired) {
        await this.stateStore.releaseLock(lockKey).catch(() => {});
      }

      // Tear down any children that successfully spawned BEFORE the error.
      // This covers two regression scenarios:
      //   • Multi-package fail-fast: spawn loop completed for pkg A, threw
      //     for pkg B. Without this, A's `next dev` keeps running and the
      //     next preview start hits "Another next dev server is already running".
      //   • Failure between spawn loop and `previewServers.set(...)` — same
      //     symptom because `cleanupIfAllDead` early-returns on missing key.
      // killTree handles descendant + Next dev lock; we also release ports
      // so subsequent allocations don't leak.
      if (spawned.length > 0) {
        for (const { child } of spawned) {
          try { await this.processSpawner.killAndWait(child, { graceMs: 2_000 }); }
          catch { /* best-effort */ }
        }
        const failedCwds = Array.from(new Set(spawned.map(s => s.cwd)));
        for (const cwd of failedCwds) {
          await this.dev.cleanupStaleLocks(cwd).catch(() => {});
        }
        if (this.portManager) {
          for (const { port } of spawned) {
            try { this.portManager.release(port); } catch { /* best-effort */ }
          }
        }
        this.appendLog(serverKey, 'stderr',
          `🧹 Cleaned up ${spawned.length} partially-started process tree(s) due to start failure`);
      }

      if (wasCancelled) {
        // User-initiated cancellation — clean up properly and report 'stopped'
        logger.info(`[Preview] Start cancelled for ${serverKey}, cleaning up`, { component: 'PreviewService' });
        this.appendLog(serverKey, 'stderr', `⏹️ Preview start cancelled`);
        
        // Clean up partially started infrastructure
        const infraPath = this.previewServerPaths.get(serverKey);
        if (infraPath) {
          const logCb = (type: 'stdout' | 'stderr', msg: string) => this.appendLog(serverKey, type, msg);
          const cancelInfraName = `ant-${projectId}-${feature}`.replace(/[^a-zA-Z0-9_-]/g, '-');
          await this.infrastructureManager.stopInfrastructure(infraPath, logCb, cancelInfraName).catch(() => {});
          this.previewServerPaths.delete(serverKey);
        }
        
        // Unregister from Redis and broadcast stopped
        if (this.portRegistry) {
          await this.portRegistry.unregisterPreview(tenantId, userId, projectId, feature).catch(() => {});
        }
        this.broadcastStatus(serverKey, {
          running: false,
          ready: false,
          phase: 'stopped',
          port: null,
          packages: [],
          issues: [],
        });
        
        return { success: false, error: 'Preview start was cancelled', serverKey };
      }
      
      // Actual error — report as 'error'
      logger.error(`Error starting preview server: ${error.message}`, { component: 'PreviewService' }, error);
      this.appendLog(serverKey, 'stderr', `❌ Error: ${error.message}`);
      
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

    // Tree-kill (descendants + lock cleanup) every spawned child. Same
    // SSOT as stopPreview / startPreview catch — DPC handles the
    // SIGKILL escalation if anything refuses to exit.
    await Promise.all(
      processes.map(proc =>
        this.processSpawner.killAndWait(proc, { graceMs: 2_000 })
          .catch(() => { /* best-effort */ }),
      ),
    );
    for (const pkg of orderedPackages) {
      await this.dev.cleanupStaleLocks(pkg.path).catch(() => { /* best-effort */ });
    }

    // Stop infrastructure services before clearing paths
    const localPath = this.previewServerPaths.get(serverKey);
    if (localPath) {
      const infraProjectName = `ant-${projectId}-${feature}`.replace(/[^a-zA-Z0-9_-]/g, '-');
      const logCb = (type: 'stdout' | 'stderr', msg: string) => this.appendLog(serverKey, type, msg);
      await this.infrastructureManager.stopInfrastructure(localPath, logCb, infraProjectName);
    }
    
    // Release every allocated package port — must happen BEFORE
    // `previewServers.delete` so the late `handleProcessExit` → `cleanupIfAllDead`
    // chain (which short-circuits on missing process map) cannot be the
    // last hope for port release. Multi-frontend projects leak N ports
    // here without this; single-frontend always leaked exactly 1.
    if (this.portManager) {
      const portsToRelease = new Set<number>();
      for (const pkg of orderedPackages) {
        if (typeof pkg.port === 'number') portsToRelease.add(pkg.port);
      }
      for (const p of portsToRelease) {
        this.portManager.release(p);
      }
    }
    
    // Clean up local state (process handles, paths)
    this.previewServers.delete(serverKey);
    this.previewServerPaths.delete(serverKey);
    
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
   * Spawn a package's dev server, watching for an early port-conflict exit.
   *
   * Why a wrapper instead of a flag on `ProcessSpawner.spawn`?
   * Lifecycle policy (settling window, retry budget, conflict patterns)
   * lives in the orchestrator (PreviewService), not the spawner. The
   * spawner stays purely about "how do I exec this command for this
   * package profile". Multi-call sites that don't want retry just call
   * `processSpawner.spawn` directly.
   *
   * Behaviour:
   *   1. Spawn child via `processSpawner.spawn`.
   *   2. Race the child's first close event against a 6s settling window.
   *   3. If the child survives the window → install caller's lifecycle
   *      handlers (onLog/onExit/onError) and return.
   *   4. If the child exits inside the window AND its accumulated stderr
   *      matches a port-conflict pattern (`isPortConflictOutput`) AND
   *      retry budget remains → DPC cleanup + waitForCleanState + 1 more
   *      spawn attempt.
   *   5. Anything else → forward the captured exit to the caller's
   *      `baseExit` so normal error reporting / cleanupIfAllDead runs.
   *
   * Hard cap: ONE retry per package. After that we fall through with the
   * second child (whose exit will be handled by the normal pipeline).
   * This is intentional — repeated retries on real config errors would
   * mask bugs and burn the user's lock budget.
   */
  private async spawnWithConflictRetry(
    pkg: PackageInfo,
    port: number,
    opts: {
      serverKey: string;
      packageUrlKey?: string;
      projectRoot: string;
      connections: ServiceConnection[];
      packageSource: string;
      baseLog: (type: 'stdout' | 'stderr', msg: string) => void;
      baseExit: (code: number | null, signal: NodeJS.Signals | null, exitedPid?: number) => void;
      baseError: (error: Error) => void;
    },
  ): Promise<ChildProcess> {
    const SETTLING_MS = 6_000;
    const MAX_ATTEMPTS = 2;  // 1 initial + 1 retry

    let attempt = 0;
    while (attempt < MAX_ATTEMPTS) {
      attempt += 1;

      // Per-attempt buffer + settling barrier. The wrapper intercepts
      // onLog/onExit until either the settling window elapses or the
      // child closes; once "promoted" we forward to the caller's handlers.
      let stderrBuf = '';
      let promoted = false;
      let earlyExit:
        | { code: number | null; signal: NodeJS.Signals | null; pid?: number }
        | undefined;
      let resolveSettled!: () => void;
      const settledP = new Promise<void>(r => { resolveSettled = r; });

      const child = this.processSpawner.spawn(pkg, port, {
        serverKey: opts.serverKey,
        packageUrlKey: opts.packageUrlKey,
        projectRoot: opts.projectRoot,
        connections: opts.connections,
        packageSource: opts.packageSource,
        onLog: (type, msg) => {
          if (!promoted && type === 'stderr') stderrBuf += msg;
          opts.baseLog(type, msg);
        },
        onExit: (code, signal, exitedPid) => {
          if (promoted) {
            opts.baseExit(code, signal, exitedPid);
            return;
          }
          earlyExit = { code, signal, pid: exitedPid };
          resolveSettled();
        },
        onError: (error) => {
          // Errors during settling window: surface to caller AND end the
          // window so we don't hang. We don't retry on `error` events
          // (those are spawn-time failures like ENOENT, not port conflicts).
          if (!promoted) resolveSettled();
          opts.baseError(error);
        },
      });

      const winner = await Promise.race([
        settledP.then(() => 'exited' as const),
        new Promise<'survived'>(r => setTimeout(() => r('survived'), SETTLING_MS)),
      ]);

      if (winner === 'survived' || !earlyExit) {
        // Healthy enough — promote so subsequent stderr / exit go to caller.
        promoted = true;
        return child;
      }

      // Child died inside settling window. Decide retry.
      const isConflict = isPortConflictOutput(stderrBuf);
      const canRetry = isConflict && attempt < MAX_ATTEMPTS;

      if (!canRetry) {
        // Surface the last few stderr lines so the user can see WHY the
        // package died. Without this, multi-package monorepos silently
        // ran with one frontend dead (handleProcessExit logs only the
        // "exited with code N" header and the actual error scrolls past
        // unseen). The user-visible "Open" button on the dead package
        // would then return ECONNREFUSED with no diagnostic trail —
        // exactly the apps/hub failure the restart_freeze_diagnosis
        // plan §3 traced. We cap to the last ~10 non-empty lines to
        // avoid flooding the log feed with stack traces.
        const tail = extractDiagnosticTail(stderrBuf);
        if (tail.length > 0) {
          opts.baseLog('stderr',
            `❌ ${pkg.name} crashed within ${SETTLING_MS}ms of spawn (code ${earlyExit.code ?? 'null'}). Recent stderr:\n${tail}`);
        }
        // Forward the captured exit to the caller exactly as if we never
        // intercepted it, then return the (already-dead) child for bookkeeping.
        promoted = true;
        opts.baseExit(earlyExit.code, earlyExit.signal, earlyExit.pid);
        return child;
      }

      // Conflict + retry budget available → cleanup and try once more.
      opts.baseLog('stdout',
        `↻ Port conflict detected on ${pkg.name} (port ${port}). Cleaning stale dev server and retrying once...`);
      try {
        const found = await this.dev.detect({ cwds: [pkg.path], ports: [port] });
        if (found.length > 0) await this.dev.forceCleanup(found);
        await this.dev.cleanupStaleLocks(pkg.path);
        await this.dev.waitForCleanState({
          cwds: [pkg.path],
          ports: [port],
          timeoutMs: 5_000,
        });
      } catch (cleanupErr: any) {
        opts.baseLog('stderr',
          `⚠️  Conflict cleanup encountered an error (continuing retry): ${cleanupErr?.message || cleanupErr}`);
      }
      // Loop continues → next spawn attempt.
    }

    // Defensive — loop always either returns or continues; we never reach here.
    throw new Error(`spawnWithConflictRetry: exhausted attempts for ${pkg.name}`);
  }

  /**
   * Handle process exit
   * 
   * When a process exits unexpectedly (not via stopPreview), we need to:
   * 1. Log the exit
   * 2. Check if ALL processes for this serverKey are dead
   * 3. If so, clean up all state (maps, Redis, ports)
   */
  private handleProcessExit(
    serverKey: string,
    pkgName: string,
    exitedPid: number | null,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    void signal;  // currently unused — handler differentiates only on `code`.
    const stoppingPids = this.stoppingPidsByServer.get(serverKey);
    const trackedExitedPid = exitedPid != null && stoppingPids?.has(exitedPid)
      ? exitedPid
      : undefined;
    const isExpectedStop =
      this.stoppingServers.has(serverKey) ||
      trackedExitedPid != null;

    if (isExpectedStop) {
      // Multi-package SSOT: delete the EXACT exited PID rather than always
      // popping `processes[0].pid`. The previous behaviour misattributed
      // sibling exits and left stale PIDs in the set, which delayed the
      // `stoppingServers.delete` cleanup and could mark a normal-exit child
      // as "unexpected" on a second pass.
      if (trackedExitedPid != null && stoppingPids) {
        stoppingPids.delete(trackedExitedPid);
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
    
    // Abort health check immediately if a process crashed — waiting is futile
    if (code !== 0 && code !== null) {
      const healthAbort = this.healthCheckAbortControllers.get(serverKey);
      if (healthAbort) {
        logger.info(`[Preview] Aborting health check for ${serverKey} — ${pkgName} crashed (code ${code})`, { component: 'PreviewService' });
        healthAbort.abort();
        this.healthCheckAbortControllers.delete(serverKey);
      }
    }

    // Early-exit diagnostics: if process died within 10 seconds, likely a config issue
    const spawnTime = this.spawnTimestamps.get(serverKey);
    if (spawnTime && (Date.now() - spawnTime < 10_000) && code !== 0) {
      this.runEarlyExitDiagnostics(serverKey).catch(err => {
        logger.warn(`[Preview] RuntimeDiagnostics failed: ${err.message}`, { component: 'PreviewService' });
      });
    }
    
    // Check if all processes are dead — if so, full cleanup
    this.cleanupIfAllDead(serverKey);
  }

  /**
   * Run RuntimeDiagnostics on early process exit.
   * Collects recent logs, analyzes against connections, broadcasts issues.
   */
  private async runEarlyExitDiagnostics(serverKey: string): Promise<void> {
    const logs = this.logManager.getLogs(serverKey);
    const recentLogText = logs.slice(-100).map(l => l.message).join('\n');
    
    // Get connections from Redis
    const { tenantId, userId, projectId, feature } = this.parseServerKey(serverKey);
    let connections: ServiceConnection[] = [];
    if (this.stateStore) {
      const config = await this.stateStore.getPreviewConfig(tenantId, userId, projectId, feature);
      connections = config?.connections || [];
    }

    const result = this.runtimeDiagnostics.analyze(recentLogText, connections);
    
    if (result.issues.length > 0) {
      logger.info(`[Preview] RuntimeDiagnostics found ${result.issues.length} issues for ${serverKey}`, { component: 'PreviewService' });
      
      // Update phase to error with diagnostic info
      const firstFatal = result.issues.find(i => i.severity === 'fatal');
      await this.updatePhase(serverKey, 'error', {
        error: firstFatal?.reason || 'Process exited unexpectedly',
      });

      // Broadcast issues via SSE
      if (this.stateStore) {
        const channel = getRealtimeBroadcastChannel(tenantId, userId);
        const message = {
          projectId,
          featureName: feature,
          type: 'preview' as const,
          data: {
            type: 'issues',
            data: { issues: result.issues, affectedConnections: result.affectedConnections },
          },
          userContext: { organizationId: tenantId, userId },
        };
        await this.stateStore.publish(channel, message);
      }
    }
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
    
    // Abort any running health check to prevent stale error messages
    const healthAbort = this.healthCheckAbortControllers.get(serverKey);
    if (healthAbort) {
      healthAbort.abort();
      this.healthCheckAbortControllers.delete(serverKey);
    }
    
    try {
      const { tenantId: t, userId: u, projectId: p, feature: f } = this.parseServerKey(serverKey);

      // Stop infrastructure services before clearing paths
      const localPath = this.previewServerPaths.get(serverKey);
      if (localPath) {
        const infraProjectName = `ant-${p}-${f}`.replace(/[^a-zA-Z0-9_-]/g, '-');
        const logCb = (type: 'stdout' | 'stderr', msg: string) => this.appendLog(serverKey, type, msg);
        await this.infrastructureManager.stopInfrastructure(localPath, logCb, infraProjectName);
      }

      // Release ALL ports (entry + every package port)
      if (this.portRegistry && this.portManager) {
        try {
          const state = await this.portRegistry.getPreview(t, u, p, f);
          if (state) {
            const portsToRelease = new Set<number>();
            if (state.port) portsToRelease.add(state.port);
            if (state.backendPort) portsToRelease.add(state.backendPort);
            for (const pkg of state.packages || []) {
              if (pkg.port) portsToRelease.add(pkg.port);
            }
            for (const p of portsToRelease) {
              this.portManager.release(p);
            }
          }
        } catch { /* best-effort */ }
      }
      
      // Clear local state (process handles, paths)
      this.previewServers.delete(serverKey);
      this.previewServerPaths.delete(serverKey);
      
      // Reset connection status to stopped
      if (this.portRegistry) {
        try {
          const currentState = await this.getPreviewStatus(t, u, p, f);
          if (currentState.connections?.length) {
            const resetConnections = currentState.connections.map((c: ServiceConnection) => ({ ...c, status: 'stopped' as const }));
            await this.portRegistry.updatePreview(t, u, p, f, { connections: resetConnections });
          }
        } catch { /* best-effort */ }
      }

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
   * Stop preview server.
   *
   * `opts.suppressStoppedBroadcast` (default `false`) — used by the
   * forceRestart code path. When `true`, the function still emits the
   * intermediate `'stopping'` broadcast (so the UI shows a loading state)
   * but withholds the final `'stopped'` broadcast. The caller is then
   * expected to immediately move the phase forward (e.g. `'installing'`),
   * giving the user a continuous progression `stopping → installing →
   * starting → running` instead of a flicker through `'stopped'` that
   * would disable the cancel button mid-restart and clear the log feed.
   */
  async stopPreview(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    opts?: { suppressStoppedBroadcast?: boolean },
  ): Promise<{ success: boolean; message?: string; error?: string }> {
    const serverKey = this.createServerKey(tenantId, userId, projectId, feature);
    
    // If startPreview is still running (before previewServers.set), abort it immediately
    if (this.startingServers.has(serverKey)) {
      logger.warn(`[Preview] stopPreview called while startPreview is running for ${serverKey} — aborting install/infra`, { component: 'PreviewService' });
      this.startCancelledServers.add(serverKey);
      const startAbort = this.startAbortControllers.get(serverKey);
      if (startAbort) {
        startAbort.abort();
      }
      return { success: true, message: 'Start operation is being cancelled' };
    }
    
    const processes = this.previewServers.get(serverKey);
    
    // Check Redis (source of truth) when local memory has no processes.
    // This handles: service restart (orphan processes), multi-pod (preview on another pod).
    let redisState: PreviewState | null = null;
    if ((!processes || processes.length === 0) && this.portRegistry) {
      try {
        redisState = await this.portRegistry.getPreview(tenantId, userId, projectId, feature);
      } catch (err: any) {
        logger.warn(`[Preview] Failed to read Redis state for ${serverKey}: ${err.message}`, { component: 'PreviewService' });
      }
    }
    
    const hasLocalProcesses = processes && processes.length > 0;
    const isRunningInRedis = redisState?.running === true;
    
    if (!hasLocalProcesses && !isRunningInRedis) {
      return { success: false, error: 'Preview server not running' };
    }

    // Abort any running health check
    const healthAbort = this.healthCheckAbortControllers.get(serverKey);
    if (healthAbort) {
      healthAbort.abort();
      this.healthCheckAbortControllers.delete(serverKey);
    }

    // Broadcast 'stopping' phase so the UI shows a loading indicator
    this.broadcastStatus(serverKey, {
      running: true,
      ready: false,
      phase: 'stopping',
    });
    
    // Mark stopping
    this.stoppingServers.add(serverKey);
    if (hasLocalProcesses) {
      const pidSet = new Set<number>();
      for (const p of processes) {
        if (p?.pid != null) pidSet.add(p.pid);
      }
      if (pidSet.size > 0) {
        this.stoppingPidsByServer.set(serverKey, pidSet);
      }
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
      const { projectId: pId, feature: feat } = this.parseServerKey(serverKey);
      const infraProjectName = `ant-${pId}-${feat}`.replace(/[^a-zA-Z0-9_-]/g, '-');
      const logCallback = (type: 'stdout' | 'stderr', msg: string) => this.appendLog(serverKey, type, msg);
      await this.infrastructureManager.stopInfrastructure(localPath, logCallback, infraProjectName);
    }
    
    // Kill local processes via DevProcessControl.killTree (descendant aware
    // + SIGKILL escalation), then verify ports/lock files are clear.
    let stoppedCount = 0;
    const portsToKill: number[] = [];
    const cwdsToClean: string[] = [];
    if (this.portRegistry) {
      try {
        const state = redisState || await this.portRegistry.getPreview(tenantId, userId, projectId, feature);
        for (const pkg of state?.packages || []) {
          if (pkg.port) portsToKill.push(pkg.port);
        }
      } catch { /* best-effort */ }
    }
    const localPathForCwds = this.previewServerPaths.get(serverKey);
    if (localPathForCwds) cwdsToClean.push(localPathForCwds);

    if (hasLocalProcesses) {
      // killTree handles process-group SIGTERM, descendants, and SIGKILL
      // escalation in one call. Doing this in parallel speeds up multi-package
      // teardown without losing the per-tree timeout guarantee.
      await Promise.all(
        processes.map(proc =>
          this.processSpawner.killAndWait(proc, { graceMs: 3_000 })
            .catch(err => logger.debug(`killAndWait error: ${err?.message}`, { component: 'PreviewService' })),
        ),
      );
      stoppedCount = processes.length;
    }

    // Safety net: kill anything still on the allocated ports + clean Next
    // dev locks. Both go through the SSOT detect/forceCleanup path so we
    // don't reimplement port + lock heuristics here.
    if (portsToKill.length > 0 || cwdsToClean.length > 0) {
      const survivors = await this.dev.detect({ cwds: cwdsToClean, ports: portsToKill });
      if (survivors.length > 0) {
        await this.dev.forceCleanup(survivors);
      }
      for (const cwd of cwdsToClean) {
        await this.dev.cleanupStaleLocks(cwd);
      }
      // Wait until ports are actually unbound + lock files gone before we
      // proceed to unregister. This shrinks the window where a fast
      // forceRestart caller can race a not-yet-dead `next dev`.
      await this.dev.waitForCleanState({
        cwds: cwdsToClean,
        ports: portsToKill,
        timeoutMs: 3_000,
      });
    }
    
    // Read connections from Redis BEFORE unregister (so we can include them in broadcast)
    let resetConnections: ServiceConnection[] = [];
    if (this.portRegistry) {
      try {
        const currentState = redisState || await this.portRegistry.getPreview(tenantId, userId, projectId, feature);
        if (currentState?.connections?.length) {
          resetConnections = currentState.connections.map(c => ({ ...c, status: 'stopped' as const }));
        }
        // Release ALL ports (entry + every package port)
        if (this.portManager) {
          const portsToRelease = new Set<number>();
          if (currentState?.port) portsToRelease.add(currentState.port);
          if (currentState?.backendPort) portsToRelease.add(currentState.backendPort);
          for (const pkg of currentState?.packages || []) {
            if (pkg.port) portsToRelease.add(pkg.port);
          }
          for (const p of portsToRelease) {
            this.portManager.release(p);
          }
        }
      } catch { /* best-effort */ }
    }
    
    // Unregister from PortRegistry (Redis)
    if (this.portRegistry) {
      await this.portRegistry.unregisterPreview(tenantId, userId, projectId, feature);
    }
    
    // Cleanup local state (process handles, paths — logs preserved until next start)
    this.previewServers.delete(serverKey);
    this.previewServerPaths.delete(serverKey);
    
    logger.info(`Stopped all servers for ${serverKey} (local=${stoppedCount}, redis=${isRunningInRedis})`, { component: 'PreviewService' });

    // Final 'stopped' broadcast — skipped during forceRestart so the UI
    // doesn't flash idle between teardown and the next 'installing' phase
    // (which itself disabled the cancel button and cleared logs).
    if (!opts?.suppressStoppedBroadcast) {
      this.broadcastStatus(serverKey, {
        running: false,
        ready: false,
        phase: 'stopped',
        port: null,
        packages: [],
        issues: [],
        connections: resetConnections,
      });
    }
    
    if (this.onStatusChange) {
      this.onStatusChange(serverKey);
    }
    
    return { 
      success: true, 
      message: stoppedCount > 0
        ? `Stopped ${stoppedCount} process(es)`
        : 'Cleaned up preview state from registry'
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
    /**
     * Representative Open URL.
     * `null` when there are 2+ frontends — FE must use `packages[].url`.
     */
    url?: string | null;
    processCount?: number;
    backendPort?: number;
    /**
     * Per-package details. Frontend packages carry a `url` (path under root)
     * pointing at their dev server. Non-frontend packages have `url: null`.
     */
    packages?: Array<{
      name: string;
      slug?: string;
      type: 'frontend' | 'backend' | 'other';
      port: number;
      urlKey?: string;
      url: string | null;
    }>;
    issues?: PreviewIssue[];
    phase?: string;
    error?: string;
    structureType?: string;
    projectProfile?: { language: string; framework?: string };
    connections?: ServiceConnection[];
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
          
          // Merge projectProfile from PREVIEW_CONFIG if runtime state lacks it
          let projectProfile = redisState.projectProfile;
          if (!projectProfile && this.stateStore) {
            try {
              const config = await this.stateStore.getPreviewConfig(tenantId, userId, projectId, feature);
              projectProfile = config?.projectProfile ?? undefined;
            } catch { /* best-effort */ }
          }
          
          return {
            running: redisState.running,
            ready: redisState.ready,
            phase: redisState.phase || (redisState.ready ? 'running' : redisState.running ? 'starting' : 'idle'),
            error: redisState.error,
            port: redisState.port || undefined,
            url: this.computeTopLevelUrl(redisState.packages, redisState.port, serverKey),
            processCount: aliveProcesses.length || (redisState.packages?.length || 0),
            backendPort: redisState.backendPort,
            packages: this.enrichPackagesWithUrl(redisState.packages || []),
            issues: (redisState.issues || []) as any,
            structureType: redisState.structureType,
            projectProfile,
            connections: redisState.connections,
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Extract the most informative tail of a stderr buffer for surfacing to
 * the log feed when a dev-server child dies during the spawn settling
 * window. Strategy:
 *   - drop empty lines
 *   - drop ANSI escape sequences (Next/Vite color output)
 *   - keep the last `MAX_LINES` non-empty lines
 *   - cap the total length so a single mega-line stack trace can't blow
 *     out the SSE log feed
 *
 * Returns '' when the buffer carries nothing useful (silent crash —
 * caller already prints the "exited with code N" header). 10 lines is
 * empirically enough for `next dev` startup errors (port bind, missing
 * config, syntax error in next.config.js) without bringing full stack
 * traces into the user's view.
 */
function extractDiagnosticTail(stderrBuf: string): string {
  const MAX_LINES = 10;
  const MAX_CHARS = 2_000;
  if (!stderrBuf) return '';
  // ANSI strip (CSI sequences).
  // eslint-disable-next-line no-control-regex
  const stripped = stderrBuf.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  const nonEmpty = stripped.split('\n').map(l => l.trimEnd()).filter(l => l.length > 0);
  if (nonEmpty.length === 0) return '';
  const tailLines = nonEmpty.slice(-MAX_LINES);
  const joined = tailLines.join('\n');
  return joined.length > MAX_CHARS ? `…${joined.slice(-MAX_CHARS)}` : joined;
}
