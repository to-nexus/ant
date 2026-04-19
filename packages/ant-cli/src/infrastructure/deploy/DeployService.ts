/**
 * DeployService
 *
 * Orchestrates the deploy lifecycle:
 * 1. Detect framework
 * 2. Run production build (with base path injection)
 * 3. Start static server
 * 4. Register deploy state in Redis
 * 5. Persist re-hydration metadata to workspace (.deploy/meta.json)
 * 6. Broadcast status via SSE
 *
 * Supports lazy re-hydration: when URL is accessed but the static server
 * process is gone (pod restart, idle eviction, crash), `ensureRunning()` reads
 * meta.json and re-spawns the static server without re-building.
 */

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { PortManager } from '../networking/PortManager';
import { StateStorePort, DeployState, DeployPhase } from '../../core/ports/stateStore';
import { detectFramework, getBuildOutputDir, runBuild } from './BuildRunner';
import { startStaticServer, StaticServerHandle } from './StaticServer';
import { DeployMetaStore } from './DeployMetaStore';
import { resolveDeployWorkspacePath, syncDeployWorkspace } from './DeployWorkspace';
import { getRealtimeBroadcastChannel } from '../state/redisConstants';
import { toUrlKey } from '../../periphery/adapters/http/services/PreviewService/utils/serverKeyUtils';
import { logger } from '../../utils/logger';

/**
 * Structured reason codes returned from startDeploy so the HTTP layer can
 * map them to appropriate status codes (400 for validation, 409 for
 * conflict with an active job, 500 for infrastructure failures).
 */
export type DeployFailureReason =
  | 'base-branch-not-allowed'
  | 'code-job-active'
  | 'port-allocation-failed'
  | 'state-register-failed'
  | 'workspace-sync-failed';

export interface StartDeployResult {
  success: boolean;
  message: string;
  reason?: DeployFailureReason;
}

export interface DeployServiceOptions {
  portManager: PortManager;
  stateStore: StateStorePort;
  workspacesPath?: string;
}

interface ActiveDeploy {
  handle: StaticServerHandle;
  state: DeployState;
}

const DEFAULT_IDLE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MIN_IDLE_CHECK_MS = 60 * 1000; // 1 min floor
const MAX_IDLE_CHECK_MS = 10 * 60 * 1000; // 10 min ceiling

export class DeployService {
  private portManager: PortManager;
  private stateStore: StateStorePort;
  private workspacesBasePath: string;
  private metaStore = new DeployMetaStore();
  private activeDeploys = new Map<string, ActiveDeploy>();
  /**
   * Monotonically increasing generation per deploy key.
   * Incremented on every startDeploy/stopDeploy call.
   * executeBuild checks its generation against current — if mismatched,
   * a newer deploy or stop was issued and this build should abort.
   */
  private deployGeneration = new Map<string, number>();
  /**
   * In-memory rehydrate lock per key — prevents concurrent static-server
   * spawns for the same deploy. Pod-local only; multi-pod races are harmless
   * (last `registerDeploy` wins).
   */
  private rehydrateLocks = new Map<string, Promise<DeployState | null>>();
  private idleCheckInterval?: NodeJS.Timeout;

  constructor(options: DeployServiceOptions) {
    this.portManager = options.portManager;
    this.stateStore = options.stateStore;
    this.workspacesBasePath =
      options.workspacesPath || process.env.ANT_WORKSPACE_BASE_PATH || '/mnt/workspaces';
  }

  private makeKey(tenantId: string, userId: string, projectId: string, feature: string): string {
    return `${tenantId}:${userId}:${projectId}:${feature}`;
  }

  /**
   * Mirror of PreviewServer.resolveWorkspacePath — needed when we must
   * rehydrate from scratch and don't have `workspacePath` on the Redis state.
   *
   * Deploy is only allowed on feature branches (see startDeploy), so the
   * `main` branch is never a valid input here; callers should not reach this
   * path with `feature === 'main'`.
   */
  private guessCodebasePath(
    tenantId: string, userId: string, projectId: string, feature: string
  ): string {
    return path.join(this.workspacesBasePath, tenantId, userId, projectId, 'features', feature, 'codebase');
  }

  /**
   * Deploy workspace = sibling `deploy/` of the codebase. This is where
   * `next build`, `next start`, and static serving all run, fully isolated
   * from the preview `next dev` process in `codebase/`.
   */
  private guessDeployWorkspacePath(
    tenantId: string, userId: string, projectId: string, feature: string
  ): string {
    return resolveDeployWorkspacePath(
      this.guessCodebasePath(tenantId, userId, projectId, feature)
    );
  }

  /**
   * Returns true iff a `code` job is currently in flight for this feature.
   * Other job types (`design`, `plan`, `learn`, `ask`, `inline-ask`) do not
   * modify the source tree, so they do not invalidate a deploy snapshot.
   */
  private async hasActiveCodeJob(projectId: string, feature: string): Promise<boolean> {
    try {
      const jobs = await this.stateStore.listJobsByFeature(projectId, feature);
      return jobs.some(
        (j) =>
          j.type === 'code' &&
          (j.status === 'pending' ||
            j.status === 'queued' ||
            j.status === 'running' ||
            j.status === 'paused')
      );
    } catch (err: any) {
      // If we cannot determine job state, fail open: do not block deploy.
      // The build itself would surface a partially-written source tree.
      logger.warn(`[Deploy] hasActiveCodeJob lookup failed: ${err.message}`, { component: 'DeployService' });
      return false;
    }
  }

  private getPodHost(): string {
    const podIp = process.env.POD_IP;
    if (podIp) return podIp;

    try {
      const interfaces = os.networkInterfaces();
      for (const [name, ifaces] of Object.entries(interfaces)) {
        if (!ifaces) continue;
        for (const iface of ifaces) {
          if (iface.internal || iface.family !== 'IPv4') continue;
          if (name === 'eth0' || name.startsWith('en')) return iface.address;
        }
      }
    } catch { /* ignore */ }
    return 'localhost';
  }

  /**
   * Broadcast a deploy status SSE event. Exposed publicly so the proxy
   * middleware can notify the UI of host/port failures.
   */
  async broadcastStatus(
    tenantId: string, userId: string,
    projectId: string, featureName: string,
    data: Record<string, any>
  ): Promise<void> {
    try {
      const channel = getRealtimeBroadcastChannel(tenantId, userId);
      await this.stateStore.publish(channel, {
        type: 'deploy',
        projectId,
        featureName,
        data: { type: 'status', data },
        userContext: { organizationId: tenantId, userId },
      });
    } catch (err: any) {
      logger.warn(`[Deploy] Broadcast failed: ${err.message}`, { component: 'DeployService' });
    }
  }

  private async broadcastLog(
    tenantId: string, userId: string,
    projectId: string, featureName: string,
    message: string
  ): Promise<void> {
    try {
      const channel = getRealtimeBroadcastChannel(tenantId, userId);
      await this.stateStore.publish(channel, {
        type: 'deploy',
        projectId,
        featureName,
        data: {
          type: 'log',
          data: { timestamp: new Date().toISOString(), type: 'stdout', message },
        },
        userContext: { organizationId: tenantId, userId },
      });
    } catch { /* best-effort */ }
  }

  /**
   * Start a deploy: validate, allocate port, register state, then kick off
   * the build asynchronously. Returns immediately (non-blocking) so the HTTP
   * response is sent within milliseconds — no ALB/proxy timeout risk.
   * All subsequent status updates are delivered via SSE.
   *
   * Validation order (fail fast, no side effects before success):
   *   1. base branch rejected (deploy is feature-scoped by design)
   *   2. active `code` job rejected (snapshotting a tree mid-write would
   *      yield half-written source files in the deployed build)
   *   3. snapshot codebase → deploy workspace (incremental)
   *   4. allocate port, register Redis state, spawn executeBuild
   *
   * @param codebasePath  absolute path to the dev codebase (the preview
   *                      workspace). Deploy never builds here directly; it
   *                      syncs into the sibling `deploy/` workspace.
   */
  async startDeploy(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    codebasePath: string
  ): Promise<StartDeployResult> {
    // 1) Base branch guard — main is not deployable. Features only.
    if (!feature || feature === 'main') {
      return {
        success: false,
        reason: 'base-branch-not-allowed',
        message: 'Deploy is only available on feature branches',
      };
    }

    const key = this.makeKey(tenantId, userId, projectId, feature);

    // 2) Active code-job guard — do this BEFORE any snapshot/port work so
    // the caller sees a clean 409 without transient side effects. Other
    // job types do not touch the source tree.
    if (await this.hasActiveCodeJob(projectId, feature)) {
      return {
        success: false,
        reason: 'code-job-active',
        message: 'A code job is currently running on this feature. Deploy is blocked until it completes.',
      };
    }

    // Stop existing deploy if any (port cleanup + generation bump via stopDeploy).
    const existing = this.activeDeploys.get(key);
    if (existing) {
      await this.stopDeploy(tenantId, userId, projectId, feature);
    }

    // Bump generation — invalidates any in-flight executeBuild for this key
    const generation = (this.deployGeneration.get(key) ?? 0) + 1;
    this.deployGeneration.set(key, generation);

    const host = this.getPodHost();

    // 3) Snapshot the codebase into the sibling deploy workspace. From here
    // on, all build/serve operations target `deployWorkspacePath` — the
    // preview dev server's `codebase/.next` is never touched.
    let deployWorkspacePath: string;
    try {
      deployWorkspacePath = await syncDeployWorkspace(codebasePath, (line) => {
        this.broadcastLog(tenantId, userId, projectId, feature, line);
      });
    } catch (err: any) {
      logger.error(`[Deploy] Workspace sync failed for ${key}: ${err.message}`, { component: 'DeployService' });
      return {
        success: false,
        reason: 'workspace-sync-failed',
        message: `Failed to prepare deploy workspace: ${err.message}`,
      };
    }

    const framework = detectFramework(deployWorkspacePath);
    const serverKey = `${tenantId}:${userId}:${projectId}:${feature}`;
    const urlKey = toUrlKey(serverKey);
    const basePath = `/deploy/${urlKey}`;

    // Allocate port
    let port: number;
    try {
      port = await this.portManager.allocate('deploy');
    } catch (err: any) {
      return {
        success: false,
        reason: 'port-allocation-failed',
        message: `Port allocation failed: ${err.message}`,
      };
    }

    // Register initial state in Redis. `workspacePath` is now the deploy
    // workspace — rehydrate and stopDeploy both use it as the source of
    // truth for cwd and meta.json location.
    const initialState: Omit<DeployState, 'lastAccessedAt'> = {
      tenantId, userId, projectId, feature,
      phase: 'building',
      port,
      host,
      podId: os.hostname(),
      framework,
      buildOutputDir: getBuildOutputDir(deployWorkspacePath, framework),
      basePath,
      workspacePath: deployWorkspacePath,
      urlKey,
      startedAt: new Date(),
    };

    try {
      await this.stateStore.registerDeploy(initialState);
    } catch (err: any) {
      this.portManager.release(port);
      return {
        success: false,
        reason: 'state-register-failed',
        message: `Failed to register deploy state: ${err.message}`,
      };
    }

    await this.broadcastStatus(tenantId, userId, projectId, feature, { phase: 'building', framework });

    // Fire-and-forget: build + serve runs in background
    this.executeBuild(tenantId, userId, projectId, feature, deployWorkspacePath, port, framework, urlKey, basePath, initialState, generation)
      .catch(err => logger.error(`[Deploy] Unexpected executeBuild error for ${key}: ${err.message}`, { component: 'DeployService' }));

    logger.info(`[Deploy] Build started: ${key} (${framework}) in ${deployWorkspacePath}`, { component: 'DeployService' });
    return { success: true, message: 'Build started' };
  }

  /**
   * Async build + serve pipeline. Runs in the background after startDeploy()
   * returns. All state transitions are broadcast via SSE.
   * Wrapped in try/finally to guarantee port release on any failure path.
   */
  private async executeBuild(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    workspacePath: string,
    port: number,
    framework: ReturnType<typeof detectFramework>,
    urlKey: string,
    basePath: string,
    initialState: Omit<DeployState, 'lastAccessedAt'>,
    generation: number
  ): Promise<void> {
    const key = this.makeKey(tenantId, userId, projectId, feature);
    const host = initialState.host;
    let buildSucceeded = false;

    const isStale = () => this.deployGeneration.get(key) !== generation;

    try {
      const buildResult = await runBuild(workspacePath, basePath, (line) => {
        this.broadcastLog(tenantId, userId, projectId, feature, line);
      });

      if (isStale()) {
        logger.info(`[Deploy] Build completed but deploy generation is stale: ${key}`, { component: 'DeployService' });
        return;
      }

      if (!buildResult.success) {
        await this.stateStore.updateDeploy(tenantId, userId, projectId, feature, {
          phase: 'error',
          error: buildResult.error,
          buildLog: buildResult.logs,
        });
        await this.broadcastStatus(tenantId, userId, projectId, feature, {
          phase: 'error',
          error: buildResult.error,
        });
        return;
      }

      // Transition to deploying (spawning static server)
      await this.broadcastStatus(tenantId, userId, projectId, feature, { phase: 'deploying' });
      await this.stateStore.updateDeploy(tenantId, userId, projectId, feature, {
        phase: 'deploying',
      });

      const handle = await startStaticServer({
        framework,
        outputDir: buildResult.outputDir,
        port,
        basePath,
        workspacePath,
      });

      const deployUrl = `/deploy/${urlKey}`;
      const now = new Date().toISOString();

      // Persist re-hydration meta BEFORE marking running — meta.json is source of truth.
      try {
        await this.metaStore.write(workspacePath, {
          version: 1,
          tenantId, userId, projectId, feature,
          framework,
          workspacePath,
          buildOutputDir: buildResult.outputDir,
          basePath,
          urlKey,
          createdAt: now,
          updatedAt: now,
        });
      } catch (err: any) {
        logger.warn(`[Deploy] Failed to persist meta.json: ${err.message}`, { component: 'DeployService' });
      }

      await this.stateStore.updateDeploy(tenantId, userId, projectId, feature, {
        phase: 'running',
        url: deployUrl,
      });

      this.activeDeploys.set(key, {
        handle,
        state: {
          ...initialState,
          phase: 'running',
          url: deployUrl,
          buildOutputDir: buildResult.outputDir,
          lastAccessedAt: new Date(),
        },
      });

      buildSucceeded = true;

      await this.broadcastStatus(tenantId, userId, projectId, feature, {
        phase: 'running',
        url: deployUrl,
        port,
        framework,
      });

      logger.info(`[Deploy] Deployed: ${key} -> ${host}:${port} (${framework})`, { component: 'DeployService' });
    } catch (err: any) {
      await this.stateStore.updateDeploy(tenantId, userId, projectId, feature, {
        phase: 'error',
        error: err.message,
      }).catch(() => {});
      await this.broadcastStatus(tenantId, userId, projectId, feature, { phase: 'error', error: err.message });
      logger.error(`[Deploy] Build/serve failed for ${key}: ${err.message}`, { component: 'DeployService' });
    } finally {
      if (!buildSucceeded) {
        this.portManager.release(port);
      }
    }
  }

  /**
   * Stop a running deploy. Bumps the deploy generation so any in-flight
   * executeBuild() with an older generation will abort on its next check.
   */
  async stopDeploy(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<{ success: boolean; message: string }> {
    const key = this.makeKey(tenantId, userId, projectId, feature);

    this.deployGeneration.set(key, (this.deployGeneration.get(key) ?? 0) + 1);

    // Wait for any in-flight rehydrate to observe the bumped generation and
    // abort itself, so this stop cannot race with a concurrent wake-up that
    // would otherwise leave a zombie static server alive.
    const inflight = this.rehydrateLocks.get(key);
    if (inflight) {
      try { await inflight; } catch { /* ignore */ }
    }

    const active = this.activeDeploys.get(key);
    const workspacePath = active?.state.workspacePath
      ?? (await this.stateStore.getDeploy(tenantId, userId, projectId, feature))?.workspacePath
      ?? this.guessDeployWorkspacePath(tenantId, userId, projectId, feature);

    if (active) {
      try {
        await active.handle.stop();
      } catch (err: any) {
        logger.warn(`[Deploy] Stop error: ${err.message}`, { component: 'DeployService' });
      }
      this.portManager.release(active.state.port);
      this.activeDeploys.delete(key);
    }

    await this.stateStore.unregisterDeploy(tenantId, userId, projectId, feature);
    await this.metaStore.remove(workspacePath);
    await this.broadcastStatus(tenantId, userId, projectId, feature, { phase: 'stopped' });

    logger.info(`[Deploy] Stopped: ${key}`, { component: 'DeployService' });
    return { success: true, message: 'Deploy stopped' };
  }

  /**
   * Ensure the deploy's static server is running on this pod. If it is
   * already healthy, returns the current state. Otherwise performs lazy
   * re-hydration: reads meta.json, allocates a port, spawns the static
   * server, and broadcasts phase transitions (starting → running).
   *
   * Returns null if the deploy cannot be revived (no meta, artifact missing,
   * port exhausted). Callers must treat this as "unavailable — user must
   * re-deploy".
   */
  async ensureRunning(
    tenantId: string, userId: string, projectId: string, feature: string
  ): Promise<DeployState | null> {
    const key = this.makeKey(tenantId, userId, projectId, feature);
    const state = await this.stateStore.getDeploy(tenantId, userId, projectId, feature);
    const active = this.activeDeploys.get(key);
    const selfPod = os.hostname();

    // Fast path: we are the owning pod and the process is alive.
    if (state?.phase === 'running' && active && state.podId === selfPod) {
      return state;
    }

    // Another pod owns a running deploy — trust it, no rehydrate.
    if (state?.phase === 'running' && state.podId && state.podId !== selfPod) {
      return state;
    }

    // Dedup concurrent rehydrate requests for the same key.
    const inflight = this.rehydrateLocks.get(key);
    if (inflight) return inflight;

    // Capture the generation at the start of rehydrate. If stopDeploy/startDeploy
    // bumps it mid-flight, rehydrate will detect and abort (disposing of any
    // freshly spawned static server) instead of leaving a zombie.
    const genAtStart = this.deployGeneration.get(key) ?? 0;

    const promise = this.rehydrate(tenantId, userId, projectId, feature, state, genAtStart)
      .finally(() => this.rehydrateLocks.delete(key));
    this.rehydrateLocks.set(key, promise);
    return promise;
  }

  private async rehydrate(
    tenantId: string, userId: string, projectId: string, feature: string,
    existing: DeployState | null,
    genAtStart: number
  ): Promise<DeployState | null> {
    const key = this.makeKey(tenantId, userId, projectId, feature);
    const lockKey = `deploy:rehydrate:${key}`;

    // Multi-pod coordination: only one pod may spawn a static server for this
    // deploy at a time. If another pod wins the lock, wait briefly and read
    // Redis to see if it succeeded; otherwise surface unavailable.
    const acquired = await this.stateStore.acquireLock(lockKey, 30);
    if (!acquired) {
      await new Promise((r) => setTimeout(r, 500));
      const fresh = await this.stateStore.getDeploy(tenantId, userId, projectId, feature);
      if (fresh?.phase === 'running') return fresh;
      logger.warn(`[Deploy] Rehydrate skipped — another pod holds the lock: ${key}`, { component: 'DeployService' });
      return null;
    }

    try {
      const workspacePath = existing?.workspacePath
        ?? this.guessDeployWorkspacePath(tenantId, userId, projectId, feature);

      const meta = await this.metaStore.read(workspacePath);
      if (!meta) {
        await this.broadcastStatus(tenantId, userId, projectId, feature, { phase: 'unavailable' });
        logger.warn(`[Deploy] Rehydrate aborted — no meta.json: ${key}`, { component: 'DeployService' });
        return null;
      }

      if (!fs.existsSync(meta.buildOutputDir)) {
        await this.broadcastStatus(tenantId, userId, projectId, feature, {
          phase: 'unavailable',
          error: 'Build output missing',
        });
        await this.metaStore.remove(workspacePath);
        logger.warn(`[Deploy] Rehydrate aborted — buildOutputDir missing: ${meta.buildOutputDir}`, { component: 'DeployService' });
        return null;
      }

      await this.broadcastStatus(tenantId, userId, projectId, feature, { phase: 'starting' });

      let port: number;
      try {
        port = await this.portManager.allocate('deploy');
      } catch (err: any) {
        await this.broadcastStatus(tenantId, userId, projectId, feature, {
          phase: 'unavailable',
          error: err.message,
        });
        return null;
      }

      const host = this.getPodHost();
      try {
        const handle = await startStaticServer({
          framework: meta.framework,
          outputDir: meta.buildOutputDir,
          port,
          basePath: meta.basePath,
          workspacePath: meta.workspacePath,
        });

        // Generation guard: if a stopDeploy/startDeploy landed while we were
        // spawning, discard the freshly started server so it does not become
        // a zombie outliving the intended stop.
        if ((this.deployGeneration.get(key) ?? 0) !== genAtStart) {
          try { await handle.stop(); } catch { /* ignore */ }
          this.portManager.release(port);
          logger.info(`[Deploy] Rehydrate aborted (generation bumped): ${key}`, { component: 'DeployService' });
          return null;
        }

        const fullState: Omit<DeployState, 'lastAccessedAt'> = {
          tenantId, userId, projectId, feature,
          phase: 'running',
          port, host, podId: os.hostname(),
          framework: meta.framework,
          buildOutputDir: meta.buildOutputDir,
          basePath: meta.basePath,
          workspacePath: meta.workspacePath,
          urlKey: meta.urlKey,
          url: `/deploy/${meta.urlKey}`,
          startedAt: new Date(),
        };
        await this.stateStore.registerDeploy(fullState);
        this.activeDeploys.set(key, {
          handle,
          state: { ...fullState, lastAccessedAt: new Date() },
        });

        await this.broadcastStatus(tenantId, userId, projectId, feature, {
          phase: 'running',
          url: fullState.url,
          port,
          framework: meta.framework,
        });

        logger.info(`[Deploy] Rehydrated ${key} on ${host}:${port}`, { component: 'DeployService' });
        return { ...fullState, lastAccessedAt: new Date() };
      } catch (err: any) {
        this.portManager.release(port);
        await this.broadcastStatus(tenantId, userId, projectId, feature, {
          phase: 'unavailable',
          error: err.message,
        });
        logger.error(`[Deploy] Rehydrate failed: ${err.message}`, { component: 'DeployService' });
        return null;
      }
    } finally {
      await this.stateStore.releaseLock(lockKey).catch(() => { /* lock may have expired; safe to ignore */ });
    }
  }

  /**
   * Get deploy status — combines in-memory, Redis, and on-disk meta
   * to report the most accurate phase.
   *
   * Priority:
   *   1. Redis says running + active on this pod → running
   *   2. meta.json exists                        → hibernated
   *   3. Redis entry without meta                → unavailable (lost artifact)
   *   4. Nothing                                 → idle
   */
  async getStatus(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<{
    phase: DeployPhase;
    url?: string;
    port?: number;
    framework?: string;
    error?: string;
  }> {
    const key = this.makeKey(tenantId, userId, projectId, feature);
    const state = await this.stateStore.getDeploy(tenantId, userId, projectId, feature);
    const active = this.activeDeploys.get(key);
    const selfPod = os.hostname();

    // 1. Running on this pod and process alive
    if (state?.phase === 'running' && active && state.podId === selfPod) {
      return {
        phase: 'running',
        url: state.url,
        port: state.port,
        framework: state.framework,
      };
    }

    // 2. Running on another pod — trust Redis
    if (state?.phase === 'running' && state.podId && state.podId !== selfPod) {
      return {
        phase: 'running',
        url: state.url,
        port: state.port,
        framework: state.framework,
      };
    }

    // 3. In-flight build/deploy/start — surface as-is
    if (state?.phase === 'building' || state?.phase === 'deploying' || state?.phase === 'starting') {
      return {
        phase: state.phase,
        url: state.url,
        port: state.port,
        framework: state.framework,
      };
    }

    // 4. Error passed through
    if (state?.phase === 'error') {
      return { phase: 'error', error: state.error, framework: state?.framework };
    }

    // 5. Check meta.json → hibernated (auto-wake eligible)
    const workspacePath = state?.workspacePath
      ?? this.guessDeployWorkspacePath(tenantId, userId, projectId, feature);
    const meta = await this.metaStore.read(workspacePath);
    if (meta) {
      return {
        phase: 'hibernated',
        url: `/deploy/${meta.urlKey}`,
        framework: meta.framework,
      };
    }

    // 6. Redis entry but no meta → artifact lost
    if (state) {
      return { phase: 'unavailable', error: state.error, framework: state.framework };
    }

    // 7. Nothing at all
    return { phase: 'idle' };
  }

  /**
   * Clean up stale deploys left in Redis from a previous process lifecycle.
   * On restart, the in-memory activeDeploys Map and StaticServer processes
   * are gone, but Redis may still hold phase:'running' entries with this
   * pod's ID. Transition them to 'hibernated' so URL access triggers
   * lazy re-hydration via ensureRunning().
   */
  async cleanupStaleDeploys(): Promise<void> {
    const currentPodId = os.hostname();
    const allDeploys = await this.stateStore.listDeploys();

    const stale = allDeploys.filter(d =>
      d.podId === currentPodId &&
      (d.phase === 'running' || d.phase === 'deploying' || d.phase === 'building' || d.phase === 'starting')
    );

    for (const d of stale) {
      // Only `running` has a meta.json on disk, so only `running` is eligible
      // for lazy rehydration. `building`/`deploying`/`starting` were killed
      // mid-build with no artifact — surface as `error` so the UI shows the
      // real cause instead of a "Wake up" CTA that would immediately fail.
      const wasRunning = d.phase === 'running';
      const nextPhase: DeployPhase = wasRunning ? 'hibernated' : 'error';
      const errorMsg = wasRunning ? undefined : 'Pod restarted during build';

      logger.warn(
        `[Deploy] Transitioning stale deploy → ${nextPhase}: ${d.tenantId}:${d.userId}:${d.projectId}:${d.feature} (was ${d.phase})`,
        { component: 'DeployService' }
      );
      try {
        await this.stateStore.updateDeploy(d.tenantId, d.userId, d.projectId, d.feature, {
          phase: nextPhase,
          ...(errorMsg ? { error: errorMsg } : {}),
        });
        // NOTE: d.port was allocated by a previous pod process; this pod's
        // PortManager has no record of it, so release() would be a no-op.
        // The old OS-level process died with its pod — nothing to free here.
        await this.broadcastStatus(d.tenantId, d.userId, d.projectId, d.feature, {
          phase: nextPhase,
          ...(errorMsg ? { error: errorMsg } : {}),
        });
      } catch (err: any) {
        logger.warn(`[Deploy] cleanupStaleDeploys error for ${d.tenantId}:${d.projectId}:${d.feature}: ${err.message}`, { component: 'DeployService' });
      }
    }

    if (stale.length > 0) {
      logger.warn(
        `[Deploy] Cleaned up ${stale.length} stale deploy(s) from previous process`,
        { component: 'DeployService' }
      );
    }
  }

  /**
   * Periodically evict idle deploys: stop the static server process but
   * keep meta.json + Redis entry (with phase='hibernated'). Next URL access
   * will auto-rehydrate via ensureRunning().
   */
  startIdleEviction(): void {
    if (this.idleCheckInterval) {
      // Double-start would leak the previous interval handle. Caller bug —
      // log and bail out instead of silently doubling the eviction rate.
      logger.warn('[Deploy] startIdleEviction called twice — ignoring', { component: 'DeployService' });
      return;
    }

    const idleMs = Number(process.env.ANT_DEPLOY_IDLE_TTL_MS || DEFAULT_IDLE_TTL_MS);
    const checkMs = Math.min(Math.max(idleMs / 10, MIN_IDLE_CHECK_MS), MAX_IDLE_CHECK_MS);

    this.idleCheckInterval = setInterval(async () => {
      try {
        const selfPod = os.hostname();
        const all = await this.stateStore.listDeploys();
        const now = Date.now();

        for (const d of all) {
          if (d.phase !== 'running') continue;
          if (d.podId !== selfPod) continue;
          const last = new Date(d.lastAccessedAt).getTime();
          if (now - last <= idleMs) continue;

          const key = this.makeKey(d.tenantId, d.userId, d.projectId, d.feature);
          const active = this.activeDeploys.get(key);
          if (active) {
            try { await active.handle.stop(); } catch { /* ignore */ }
            this.portManager.release(d.port);
            this.activeDeploys.delete(key);
          }
          await this.stateStore.updateDeploy(d.tenantId, d.userId, d.projectId, d.feature, {
            phase: 'hibernated',
          });
          await this.broadcastStatus(d.tenantId, d.userId, d.projectId, d.feature, { phase: 'hibernated' });
          logger.info(`[Deploy] Hibernated idle deploy: ${key}`, { component: 'DeployService' });
        }
      } catch (err: any) {
        logger.warn(`[Deploy] Idle eviction error: ${err.message}`, { component: 'DeployService' });
      }
    }, checkMs);

    logger.info(`[Deploy] Idle eviction started (ttl=${idleMs}ms, interval=${checkMs}ms)`, { component: 'DeployService' });
  }

  stopIdleEviction(): void {
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
      this.idleCheckInterval = undefined;
    }
  }

  /**
   * Cleanup all active deploys (shutdown).
   */
  async cleanup(): Promise<void> {
    this.stopIdleEviction();
    for (const [key, active] of this.activeDeploys) {
      try {
        await active.handle.stop();
        this.portManager.release(active.state.port);
      } catch (err: any) {
        logger.warn(`[Deploy] Cleanup error for ${key}: ${err.message}`, { component: 'DeployService' });
      }
    }
    this.activeDeploys.clear();
  }
}
