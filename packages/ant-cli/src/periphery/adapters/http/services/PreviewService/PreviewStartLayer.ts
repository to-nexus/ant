/**
 * startPreview — the 9-step start sequence (register → detect → install →
 * infra → ports → provisioning → spawn → validate → health).
 *
 * One layer of the PreviewService inheritance chain (see PreviewServiceCore —
 * tests construct the service and reach protected members/prototype methods
 * directly, so methods stay on the prototype chain, verbatim).
 */

import { ChildProcess } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import { PortManager } from '../../../../../infrastructure/networking/PortManager';
import { PreviewState, PreviewPackage, PreviewErrorStage, ServiceConnection } from '../../../../../core/ports/portRegistry';
import type { ProjectProfile } from '@ant/shared';
import { PreviewIssue, PreviewIssueReasoning, PackageInfo, ValidationResult } from './types';
import { createServerKey, toUrlKey } from './utils/serverKeyUtils';
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
import { readPreviewManifest } from './managers/previewManifest';
import { HealthChecker } from './utils/HealthChecker';
import { IssueDetector } from './detectors/IssueDetector';
import { logger } from '../../../../../utils/logger';
import { DevProcessControl } from '../../../../../core/process/DevProcessControl';
import { PreviewSpawnLayer } from './PreviewSpawnLayer';
/**
 * Thrown when a startup stage (infra / provisioning) fails hard. Carries the
 * stage + an actionable hint so the catch block can surface "which stage, why,
 * what next" to the UI instead of a buried generic error.
 */
class PreviewStageError extends Error {
  constructor(
    message: string,
    readonly stage: PreviewErrorStage,
    readonly hint: string,
  ) {
    super(message);
    this.name = 'PreviewStageError';
  }
}

/**
 * Choose the appropriate post-spawn status line for the preview spawn loop.
 *
 * This runs right after spawn, BEFORE the async health check — so "all
 * processes survived the settling window" is NOT yet "the dev server responds".
 * The success line here is therefore neutral ("verifying…"); the truthful
 * `'All preview servers started successfully!'` line — which the FE progress
 * view ([packages/ant-ui/.../FeatureSection/utils/preview.ts]) matches to flip
 * packages to `'running'` — is emitted only AFTER the health check passes (see
 * the health-check `.then` in `startPreview`). This prevents the UI from
 * showing a false success that then fails 60s later.
 */
export function summarizePreviewSpawnOutcome(
  orderedPackages: ReadonlyArray<{ name: string; process?: ChildProcess | null }>,
): { type: 'stdout' | 'stderr'; message: string } {
  const crashedDuringSettling = orderedPackages
    .filter(p => p.process != null && p.process.exitCode !== null && p.process.exitCode !== 0)
    .map(p => p.name);
  if (crashedDuringSettling.length === 0) {
    return { type: 'stdout', message: '🚀 Processes spawned — verifying dev server health…' };
  }
  return {
    type: 'stderr',
    message: `❌ Preview started with ${crashedDuringSettling.length} failed package(s): ${crashedDuringSettling.join(', ')}`,
  };
}

// Distributed lock for preview operations (prevents multi-pod race)
const PREVIEW_LOCK_TTL_SECONDS = 120; // 2 minutes — covers npm install + startup
const PREVIEW_LOCK_PREFIX = 'ant:lock:preview:';

export class PreviewStartLayer extends PreviewSpawnLayer {
  async startPreview(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    localPath: string,
    port?: number,
    forceRestart: boolean = true,
    opts?: { lockScope?: 'global' | 'pod' }
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
    
    const serverKey = createServerKey(tenantId, userId, projectId, feature);
    const urlKey = toUrlKey(serverKey);
    const proxyUrl = this.previewUrlForKey(urlKey);

    // Clear previous session logs on new start
    this.logManager.clearLogs(serverKey);
    
    // ── Distributed lock: prevent multi-pod race ──
    // Only one pod should handle start for a given serverKey at a time.
    // Without this, ALB round-robin can send multiple start requests to different pods,
    // causing npm install race on the same EFS path and corrupted node_modules.
    // lockScope 'pod' (rehydrate path) suffixes the key with this hostname so
    // pods don't exclude EACH OTHER's rehydrates; same-pod duplicates are
    // coalesced in-process by `rehydrateLocks`.
    const lockScope = opts?.lockScope ?? 'global';
    const lockKey = `${PREVIEW_LOCK_PREFIX}${serverKey}${lockScope === 'pod' ? `:${os.hostname()}` : ''}`;
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
        // stopPreview already reaps the owned process groups (killAndWait on
        // live handles + killOwned on persisted identities) and clears Next
        // dev locks, so we don't need an additional wait here — the SSOT
        // guarantee lives inside stopPreview, not at every caller.
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
    
    // Pre-flight cleanup: reap any prior dev processes WE spawned for THIS
    // serverKey before starting (e.g. a previous start that crashed without
    // releasing). Identity-scoped via persisted (pid, pgid, podId) — it can
    // never match another project's process, unlike the old OS port/cwd scan
    // whose bare port number was only pod-local. Then clear stale framework
    // dev locks for filesystem hygiene.
    const priorRecords = await this.ownedRecordsFor(tenantId, userId, projectId, feature);
    if (priorRecords.length > 0) {
      this.appendLog(serverKey, 'stdout',
        `⚠️  Reaping ${priorRecords.length} prior preview process(es) for this feature before start...`);
      await this.dev.killOwned(priorRecords, { graceMs: 4_000 });
    }
    await this.dev.cleanupStaleLocks(localPath).catch(() => { /* best-effort */ });
    
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
      
      // 1. Detect project facts from the codebase. The cached profile is passed
      //    ONLY as a greenfield fallback — the manifests are authoritative
      //    (passing it as authority made a `typescript` hint run Node detection
      //    on a `go.mod` repo, and meant a framework was never derived at all).
      let hintProfile: ProjectProfile | undefined;
      if (this.stateStore) {
        try {
          const previewConfig = await this.stateStore.getPreviewConfig(tenantId, userId, projectId, feature);
          if (previewConfig?.projectProfile) {
            hintProfile = previewConfig.projectProfile;
          }
        } catch { /* best-effort */ }
      }

      const facts = await this.profileDetector.detectFacts(localPath, hintProfile);
      const structure = facts?.structure;
      if (!structure) {
        throw new Error('No recognized project files found');
      }
      logger.warn(`[Preview] Structure: type=${structure.type}, packages=${structure.packages.length}, entry=${structure.entry?.name || 'none'}, profile=${facts.profile.language ?? 'none'}/${facts.profile.framework ?? 'none'}`, { component: 'PreviewService' });

      if (structure.packages.length === 0) {
        throw new Error('No runnable packages found');
      }

      // 1.1. Mirror the observed facts onto the runtime state so any pod can
      //      report them without re-reading the filesystem.
      const detectedProfile = facts.profile;
      if (this.portRegistry) {
        await this.portRegistry.updatePreview(tenantId, userId, projectId, feature, {
          structureType: structure.type,
          projectProfile: detectedProfile,
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
      await this.updatePhase(serverKey, 'infra', { running: false, ready: false });
      const infraResult = await this.infrastructureManager.startInfrastructure(localPath, logCallback, infraProjectName, startSignal);
      if (startSignal.aborted) throw new Error('Preview start cancelled');

      // Fail-fast: a project that SHIPS a compose file but whose infra didn't
      // come up (or is up but not accepting connections) must not spawn the app
      // against missing infrastructure — that only yields cryptic runtime errors.
      if (infraResult.composePresent && !infraResult.ok && infraResult.stage !== 'cancelled') {
        const hint = infraResult.stage === 'docker-missing'
          ? 'This project requires Docker for its infrastructure. Start Docker and retry.'
          : infraResult.stage === 'readiness'
            ? `A required service did not become reachable (${infraResult.detail ?? 'timeout'}). Check the compose service config.`
            : `docker compose failed to start (${infraResult.detail ?? 'see logs'}).`;
        throw new PreviewStageError(`Infrastructure failed: ${infraResult.detail ?? infraResult.stage}`, 'infra', hint);
      }

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
          ? await this.portManager.allocate('dev-server', { podId: os.hostname(), serverKey })
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

      // 2.6. Provisioning: run post-infra setup commands (DB migration / seed /
      // declared) against the now-ready infra, BEFORE spawning the app. The
      // compose DB comes up empty (volumes are wiped each start), so without
      // this every query against an un-migrated schema fails. Same env as the
      // dev process so DATABASE_URL matches. Fatal on failure.
      const previewManifest = readPreviewManifest(localPath);
      const provisionCommands = this.provisioningManager.resolveSetupCommands(
        structure.packages, localPath, previewManifest,
      );
      if (provisionCommands.length > 0) {
        await this.updatePhase(serverKey, 'provisioning', { running: false, ready: false });
        const provisionResult = await this.provisioningManager.runProvisioning(
          structure.packages, localPath, connections, previewManifest, logCallback, startSignal,
        );
        if (startSignal.aborted) throw new Error('Preview start cancelled');
        if (!provisionResult.ok) {
          throw new PreviewStageError(
            `Provisioning failed: ${provisionResult.detail ?? 'unknown'}`,
            'provisioning',
            'A setup command (e.g. DB migration) failed. Check the logs above for the underlying error.',
          );
        }
      }

      // Per-package pre-flight: now that cwds are known, clear stale framework
      // dev locks (filesystem hygiene). The old port/cwd OS scan is removed —
      // with NX (Redis-authoritative) allocation the just-allocated ports are
      // provably unclaimed, so there is no living owner to detect-and-kill, and
      // any prior process WE owned was already reaped by the owned-record sweep
      // above. Port collisions are now structurally impossible across pods.
      const allPkgCwds = orderedPackages.map(p => p.path);
      for (const cwd of allPkgCwds) {
        await this.dev.cleanupStaleLocks(cwd).catch(() => { /* best-effort */ });
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
        // `pkg.port` may differ from `pkgPort` if spawnWithConflictRetry
        // reallocated on a port conflict — record the live one so failure
        // cleanup releases the port actually in use.
        spawned.push({ child: childProcess, cwd: pkg.path, port: pkg.port! });
      }

      // Record spawn timestamp for early-exit detection
      this.spawnTimestamps.set(serverKey, Date.now());

      // Build package ports for Redis registration. Persist `slug` + per-package
      // `urlKey` so the proxy can route `/{4part}--{slug}/...` requests directly
      // to the matching frontend dev server, and so the FE can render an
      // "Open" button per accessible frontend.
      //
      // Also persist ANT-owned process identity (pid/pgid/podId/spawnedAt) so
      // every later cleanup targets ONLY the exact process this pod spawned,
      // scoped to (podId, serverKey). `pgid === pid` by the `detached:true`
      // spawn contract (ProcessSpawner).
      const ownerPodId = os.hostname();
      const ownerSpawnedAt = Date.now();
      const packagePorts: PreviewPackage[] = orderedPackages
        .filter(p => typeof p.port === 'number')
        .map(p => ({
          name: p.name,
          slug: p.slug,
          type: p.type,
          port: p.port as number,
          urlKey: p.urlKey,
          pid: p.process?.pid,
          pgid: p.process?.pid,
          podId: ownerPodId,
          spawnedAt: ownerSpawnedAt,
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
          structureType: structure.type,
          // Carried through the full-state replace: omitting it wiped the
          // profile written by the `updatePreview` call at detection time.
          projectProfile: detectedProfile,
          connections,
          host,
          podId: os.hostname(),
          packages: packagePorts,
          issues: [],
          // Fresh spawn injects current .env/config, so any prior "needs
          // restart to apply" signal is satisfied by this start.
          restartRequired: false,
          startedAt: new Date()
        };
        
        await this.portRegistry.registerPreview(previewState);
        logger.info(`[Preview] Registered: ${serverKey} -> ${host}:${entryPort}`, { component: 'PreviewService' });

        // Pod-local copy of the spawn facts — survives another pod's
        // registerPreview REPLACE, which erases this pod's ports from Redis.
        this.localPreviews.set(serverKey, { ...previewState, lastAccessedAt: new Date() });
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

      // Status summary line — gated on factual outcome (no editorial verdict).
      // See `summarizePreviewSpawnOutcome` for the SSOT decision logic.
      const summary = summarizePreviewSpawnOutcome(orderedPackages);
      this.appendLog(serverKey, summary.type, summary.message);

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
      
      // 8. Health check (async, but AWAITABLE via `pendingReadiness`)
      // The chain still runs detached from this call (user-start returns
      // immediately as before); `ensureRunning` awaits the stored promise
      // (bounded) so a rehydrate-triggering request is not proxied to a
      // not-yet-listening dev server.
      // If health check fails, kill all processes and clean up — the dev server is unusable.
      const healthAbort = new AbortController();
      this.healthCheckAbortControllers.set(serverKey, healthAbort);
      const readiness = this.healthChecker.check(entryPort!, logCallback, undefined, undefined, healthAbort.signal).then(async (ready) => {
        this.healthCheckAbortControllers.delete(serverKey);
        // Release lock after health check completes (success or fail)
        if (this.stateStore && lockAcquired) {
          this.stateStore.releaseLock(lockKey).catch(() => {});
        }

        if (ready) {
          // Truthful success signal — emitted ONLY after the health check
          // passes. The FE progress view (preview.ts) matches this string to
          // flip packages to 'running'; the spawn-time summary above is
          // intentionally neutral so the UI never shows a premature success.
          this.appendLog(serverKey, 'stdout', '✅ All preview servers started successfully!');
          const localCopy = this.localPreviews.get(serverKey);
          if (localCopy) {
            this.localPreviews.set(serverKey, { ...localCopy, ready: true, phase: 'running' });
          }
          await this.updatePhase(serverKey, 'running', { running: true, ready: true });
        } else {
          // Health check failed — dev server is not responding. Clean up everything.
          logger.warn(`[Preview] Health check failed for ${serverKey}, stopping all processes`, { component: 'PreviewService' });
          this.appendLog(serverKey, 'stderr', '❌ Dev server failed health check. Stopping preview.');

          try {
            // Local failure only — do NOT fan out, other pods' instances of
            // this preview are independent and may be healthy.
            await this.stopPreview(tenantId, userId, projectId, feature, { skipFanout: true });
          } catch { /* best-effort */ }

          await this.updatePhase(serverKey, 'error', {
            running: false, ready: false,
            error: `Dev server failed to respond on port ${entryPort}`
          });
        }
        return ready;
      }).catch(() => false);
      this.pendingReadiness.set(serverKey, readiness);
      void readiness.finally(() => {
        if (this.pendingReadiness.get(serverKey) === readiness) {
          this.pendingReadiness.delete(serverKey);
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
      this.localPreviews.delete(serverKey);
      
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

      const stageErr = error instanceof PreviewStageError ? error : undefined;

      // A hard infra/provisioning failure leaves containers up but no app — tear
      // them down so the next start (and its preCleanup) begins from a clean slate.
      if (stageErr) {
        const infraPath = this.previewServerPaths.get(serverKey);
        if (infraPath) {
          const logCb = (type: 'stdout' | 'stderr', msg: string) => this.appendLog(serverKey, type, msg);
          await this.infrastructureManager.stopInfrastructure(infraPath, logCb, `ant-${projectId}-${feature}`.replace(/[^a-zA-Z0-9_-]/g, '-')).catch(() => {});
          this.previewServerPaths.delete(serverKey);
        }
      }

      await this.updatePhase(serverKey, 'error', {
        running: false, ready: false,
        error: error.message || 'Failed to start preview server',
        errorStage: stageErr?.stage,
        hint: stageErr?.hint,
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
}
