/**
 * PreviewServiceCore — state maps, collaborator wiring, phase/broadcast/log
 * plumbing and URL identity. Root of the PreviewService inheritance chain:
 * queries → exit → stop → spawn → start → local, with PreviewService on top
 * (idle check, owned-identity reaping, shutdown).
 *
 * Why a chain rather than extracted functions over a ctx: the preview test
 * suites construct the service and replace protected fields / call protected
 * methods directly (spawn retry, pid tracking, local-first self-heal), so
 * every method must stay a prototype method reading `this.*` at call time.
 */

import { ChildProcess } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import { LogEntry } from '../../../../../core/ports/http';
import { PortManager } from '../../../../../infrastructure/networking/PortManager';
import { PortRegistryPort, PreviewState, PreviewPackage, PreviewPhase, PreviewErrorStage } from '../../../../../core/ports/portRegistry';
import type { StateStorePort } from '../../../../../core/ports/stateStore';
import type { ProjectProfile } from '@ant/shared';
import { PackageInfo, ValidationResult } from './types';
import { createServerKey, parseServerKey, toUrlKey, toUrlKeyWithService, packageSlug } from './utils/serverKeyUtils';
import { previewSubdomainAppUrlForUrlKey } from './utils/previewLabel';
import { isSubdomainRouting } from '../../../../../core/config/previewRouting';
import { LogManager } from './managers/LogManager';
import { PackageDetector } from './detectors/PackageDetector';
import { ProjectValidator } from './validators/ProjectValidator';
import { ProjectStructureDetector } from './detectors/ProjectStructureDetector';
import { ProjectProfileDetector } from './detectors/ProjectProfileDetector';
import { ConnectionDetector } from './detectors/ConnectionDetector';
import { RuntimeDiagnostics } from './detectors/RuntimeDiagnostics';
import { DependencyInstaller } from './managers/DependencyInstaller';
import { ProcessSpawner } from './managers/ProcessSpawner';
import { InfrastructureManager } from './managers/InfrastructureManager';
import { ProvisioningManager } from './managers/ProvisioningManager';
import { HealthChecker } from './utils/HealthChecker';
import { IssueDetector } from './detectors/IssueDetector';
import { logger } from '../../../../../utils/logger';
import { getRealtimeBroadcastChannel } from '../../../../../infrastructure/state';
import { CredentialsStore, GitHubCredentials, buildCredentialEnv } from '../../../../../utils/userConfig';
import { DevProcessControl } from '../../../../../core/process/DevProcessControl';

// Idle timeout configuration
export const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export class PreviewServiceCore {
  // State maps (only non-serializable / pod-local data)
  protected previewServers: Map<string, ChildProcess[]> = new Map();  // Process handles (cannot serialize)
  protected installingProjects: Set<string> = new Set();
  protected previewServerPaths: Map<string, string> = new Map(); // serverKey -> localPath (for infrastructure cleanup)
  
  // Start/Stop state management
  protected startingServers: Set<string> = new Set(); // serverKeys currently in startPreview
  protected startCancelledServers: Set<string> = new Set(); // startPreview should abort after spawn
  protected startAbortControllers: Map<string, AbortController> = new Map(); // abort ongoing install/infra during startup
  protected stoppingServers: Set<string> = new Set();
  protected stoppingPidsByServer: Map<string, Set<number>> = new Map();
  protected stoppingCleanupTimers: Map<string, NodeJS.Timeout> = new Map();
  
  // Spawn timestamps for early-exit detection (RuntimeDiagnostics)
  protected spawnTimestamps: Map<string, number> = new Map();
  
  // Health check abort controllers (cancel on process exit or stop)
  protected healthCheckAbortControllers: Map<string, AbortController> = new Map();

  // Pod-local spawn facts — the preview twin of DeployService.activeDeploys /
  // rehydrateLocks (permitted per-process lifecycle bookkeeping, NOT a Redis
  // mirror): after another pod's rehydrate REPLACEs the shared Redis record,
  // THIS pod's dev-server ports exist nowhere else. Local-first serving
  // (getLocalPreview) reads these so a healthy local instance stays reachable
  // regardless of who currently owns the shared record.
  protected localPreviews: Map<string, PreviewState> = new Map();
  // In-flight health check per serverKey — ensureRunning awaits this (bounded)
  // so the triggering request is not proxied to a not-yet-listening dev server.
  protected pendingReadiness: Map<string, Promise<boolean>> = new Map();
  // In-process rehydrate coalescing (deploy parity): concurrent requests on
  // this pod share one rehydrate instead of racing startPreview.
  protected rehydrateLocks: Map<string, Promise<PreviewState | null>> = new Map();
  
  // Idle check
  protected idleCheckTimer: ReturnType<typeof setInterval> | null = null;
  protected idleTimeoutMs: number = DEFAULT_IDLE_TIMEOUT_MS;
  
  // Dependencies
  protected onStatusChange?: (serverKey: string) => void;
  protected portManager?: PortManager;
  protected portRegistry?: PortRegistryPort;
  protected stateStore?: StateStorePort;
  protected workspaceRoot?: string;
  
  // Modular components
  protected logManager: LogManager;
  protected packageDetector: PackageDetector;
  protected projectValidator: ProjectValidator;
  protected structureDetector: ProjectStructureDetector;
  protected profileDetector: ProjectProfileDetector;
  protected connectionDetector: ConnectionDetector;
  protected runtimeDiagnostics: RuntimeDiagnostics;
  protected dependencyInstaller: DependencyInstaller;
  protected processSpawner: ProcessSpawner;
  protected infrastructureManager: InfrastructureManager;
  protected provisioningManager: ProvisioningManager;
  protected healthChecker: HealthChecker;
  protected issueDetector: IssueDetector;

  /** SSOT for descendant kill / Next-lock cleanup / port detection.
   *  Shared instance from `processSpawner` so both classes operate on the
   *  same logger sink and platform gates. */
  protected dev: DevProcessControl;
  
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
    this.profileDetector = new ProjectProfileDetector(this.structureDetector);
    this.connectionDetector = new ConnectionDetector();
    this.runtimeDiagnostics = new RuntimeDiagnostics();
    this.dependencyInstaller = new DependencyInstaller();
    this.processSpawner = new ProcessSpawner();
    this.infrastructureManager = new InfrastructureManager();
    this.provisioningManager = new ProvisioningManager();
    this.healthChecker = new HealthChecker();
    this.issueDetector = new IssueDetector();
    this.dev = this.processSpawner.getDevProcessControl();
  }
  
  /**
   * Read GitHub PAT from CredentialsStore and build env vars for private module access.
   * Returns empty object on any failure (safe no-op).
   */
  protected async getCredentialEnv(
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
   * Update preview phase in Redis (single source of truth) and broadcast via SSE.
   * 
   * This is the ONLY method that should be used to change preview phase.
   * Redis is authoritative — local memory maps only store process handles and logs.
   */
  protected async updatePhase(
    serverKey: string,
    phase: PreviewPhase,
    extra?: { error?: string; running?: boolean; ready?: boolean; errorStage?: PreviewErrorStage; hint?: string }
  ): Promise<void> {
    const { tenantId, userId, projectId, feature } = parseServerKey(serverKey);

    // infra / provisioning are mid-startup gates: the dev server is NOT up yet.
    const midStartup = phase === 'infra' || phase === 'provisioning';
    const defaultRunning = phase === 'installing' || phase === 'starting' || phase === 'running';

    // 1. Update Redis (source of truth)
    if (this.portRegistry) {
      try {
        await this.portRegistry.updatePreview(tenantId, userId, projectId, feature, {
          phase,
          error: extra?.error,
          errorStage: phase === 'error' ? extra?.errorStage : undefined,
          hint: phase === 'error' ? extra?.hint : undefined,
          running: extra?.running ?? (defaultRunning && !midStartup),
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
            errorStage: state.errorStage,
            hint: state.hint,
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
            projectProfile: state.projectProfile || undefined,
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
  protected getPodHost(): string {
    // K8s typically sets POD_IP via downward API
    const podIp = process.env.POD_IP;
    if (podIp) {
      logger.debug(`[Preview] Using POD_IP: ${podIp}`, { component: 'PreviewService' });
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
            logger.debug(`[Preview] Using network interface IP: ${iface.address} (${name})`, { component: 'PreviewService' });
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
  protected appendLog(serverKey: string, type: 'stdout' | 'stderr', message: string): void {
    const logEntry = this.logManager.appendLog(serverKey, type, message);
    
    if (this.stateStore) {
      const { tenantId, userId, projectId, feature } = parseServerKey(serverKey);
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
  protected broadcastStatus(serverKey: string, status: any): void {
    if (this.stateStore) {
      const { tenantId, userId, projectId, feature } = parseServerKey(serverKey);
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
   * Push freshly observed project facts to the frontend.
   *
   * Used by `PreviewServer.refreshProjectFacts` so a post-code-job re-detection
   * reaches an open Preview Config panel without a manual reload. A partial
   * status patch is safe — the frontend slice shallow-merges, and the profile
   * carries its provenance so the rank rule keeps a manifest result from being
   * demoted by a later hint.
   */
  broadcastProjectFacts(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    facts: { structureType?: string | null; projectProfile?: ProjectProfile | null; canStart?: boolean },
  ): void {
    const serverKey = createServerKey(tenantId, userId, projectId, feature);
    this.broadcastStatus(serverKey, {
      ...(facts.structureType ? { structureType: facts.structureType } : {}),
      ...(facts.projectProfile ? { projectProfile: facts.projectProfile } : {}),
      ...(facts.canStart !== undefined ? { canStart: facts.canStart } : {}),
    });
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
  /**
   * Public URL for a frontend package's urlKey.
   *   path routing      → `/{urlKey}` (relative, on the shared preview host).
   *   subdomain routing → `https://{label}.<baseDomain>` (per-app host root);
   *                       falls back to `/{urlKey}` if no base domain configured.
   */
  protected previewUrlForKey(urlKey: string): string {
    if (isSubdomainRouting()) return previewSubdomainAppUrlForUrlKey(urlKey) ?? `/${urlKey}`;
    return `/${urlKey}`;
  }

  protected computeTopLevelUrl(
    packages: PreviewPackage[] | undefined,
    legacyPort: number | undefined,
    serverKey: string
  ): string | null {
    const frontends = (packages || []).filter(p => p.type === 'frontend');
    if (frontends.length === 1) {
      return this.previewUrlForKey(frontends[0].urlKey || toUrlKey(serverKey));
    }
    if (frontends.length === 0) {
      // Legacy fallback: backend-only state with port set, or stale state
      // missing `packages`. Single 4-part URL is still useful to stale
      // clients (e.g. cross-project proxy).
      return legacyPort ? this.previewUrlForKey(toUrlKey(serverKey)) : null;
    }
    return null;
  }

  /**
   * Enrich `PreviewPackage[]` with a per-frontend `url` field for FE
   * consumption. Backend / other packages get `url: null` to make absence
   * explicit.
   */
  protected enrichPackagesWithUrl(packages: PreviewPackage[]): Array<PreviewPackage & { url: string | null }> {
    return packages.map(p => ({
      ...p,
      url: p.type === 'frontend' && p.urlKey ? this.previewUrlForKey(p.urlKey) : null,
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
  protected assignPackageUrlIdentity(packages: PackageInfo[], serverKey: string): void {
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
   * Pod-local spawn facts for a preview THIS pod is running, or null. Gated on
   * live process handles so a stopped/crashed instance never resolves. Unlike
   * the Redis record, this survives another pod's rehydrate REPLACE — it is the
   * only place this pod's dev-server ports remain known after ownership moves.
   */
}
