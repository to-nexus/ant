/**
 * DeployService
 *
 * Orchestrates the deploy lifecycle:
 * 1. Detect frontend packages (single or multi)
 * 2. Run production build for EACH package (with per-package basePath)
 * 3. Start a static server per package
 * 4. Register deploy state in Redis (packages[] is SSOT)
 * 5. Persist re-hydration metadata to workspace (.deploy/meta.json v2)
 * 6. Broadcast status via SSE
 *
 * Multi-package contract (mirrors PreviewService):
 *   - 1 frontend  → `/deploy/{4partUrlKey}` (legacy single-package URL).
 *   - 2+ frontends→ `/deploy/{4partUrlKey}--{slug}` per package, top-level
 *                   `state.url` is null (FE renders one Open button per
 *                   `packages[].url`).
 *
 * Lazy re-hydration: when ANY package's URL is hit but the static server
 * process is gone, `ensureRunning()` reads meta.json and respawns ALL
 * packages (re-hydration is per-deploy, not per-package — it's cheap and
 * keeps the state consistent).
 */

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { PortManager } from '../networking/PortManager';
import { StateStorePort, DeployState, DeployPackage, DeployPhase } from '../../core/ports/stateStore';
import { detectFramework, getBuildOutputDir, runBuild } from './BuildRunner';
import { startStaticServer, StaticServerHandle } from './StaticServer';
import { DeployMetaStore, DeployMetaPackage } from './DeployMetaStore';
import { resolveDeployWorkspacePath, syncDeployWorkspace } from './DeployWorkspace';
import { getRealtimeBroadcastChannel } from '../state/redisConstants';
import {
  toUrlKey,
  toUrlKeyWithService,
  packageSlug,
} from '../../periphery/adapters/http/services/PreviewService/utils/serverKeyUtils';
import { ProjectStructureDetector } from '../../periphery/adapters/http/services/PreviewService/detectors/ProjectStructureDetector';
import type { PackageInfo } from '../../periphery/adapters/http/services/PreviewService/types';
import { logger } from '../../utils/logger';

/**
 * Structured reason codes returned from startDeploy so the HTTP layer can
 * map them to appropriate status codes (400 for validation, 409 for
 * conflict with an active job, 500 for infrastructure failures).
 */
export type DeployFailureReason =
  | 'base-branch-not-allowed'
  | 'code-job-active'
  | 'no-deployable-package'
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
  /** One handle per package — index aligns with `state.packages`. */
  handles: StaticServerHandle[];
  state: DeployState;
}

const DEFAULT_IDLE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MIN_IDLE_CHECK_MS = 60 * 1000; // 1 min floor
const MAX_IDLE_CHECK_MS = 10 * 60 * 1000; // 10 min ceiling

/**
 * Aggregate per-package phases into a single deploy-level phase.
 *
 *   any error      → error
 *   any building   → building
 *   any deploying  → deploying
 *   all running    → running
 *   all hibernated → hibernated
 *   any starting   → starting
 *   else           → first non-running phase encountered (best-effort)
 */
function aggregatePhase(packages: Array<{ phase: DeployPhase }>): DeployPhase {
  if (packages.length === 0) return 'idle';
  if (packages.some(p => p.phase === 'error')) return 'error';
  if (packages.some(p => p.phase === 'building')) return 'building';
  if (packages.some(p => p.phase === 'deploying')) return 'deploying';
  if (packages.some(p => p.phase === 'starting')) return 'starting';
  if (packages.every(p => p.phase === 'running')) return 'running';
  if (packages.every(p => p.phase === 'hibernated')) return 'hibernated';
  if (packages.every(p => p.phase === 'stopped')) return 'stopped';
  // Mixed terminal states (e.g. some hibernated, some unavailable) → degrade.
  return packages.find(p => p.phase !== 'running')?.phase || 'running';
}

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
   * Decide the "representative" Open URL emitted at the top level of the
   * status payload — same contract as `PreviewService.computeTopLevelUrl`.
   *
   *   1 package  → `packages[0].url` (back-compat with single-package).
   *   2+ packages→ null (FE must use `packages[].url`).
   *   0 packages → null.
   */
  private computeTopLevelDeployUrl(packages: DeployPackage[] | undefined): string | null {
    if (!packages || packages.length === 0) return null;
    if (packages.length === 1) return packages[0].url || null;
    return null;
  }

  /**
   * Broadcast a deploy status SSE event. Exposed publicly so the proxy
   * middleware can notify the UI of host/port failures.
   *
   * Convention: callers pass a SHALLOW patch (e.g. `{ phase: 'building' }`).
   * This method is responsible for enriching with `packages` + top-level
   * `url` when those are available in Redis, so the UI always renders the
   * latest per-package state.
   */
  async broadcastStatus(
    tenantId: string, userId: string,
    projectId: string, featureName: string,
    data: Record<string, any>
  ): Promise<void> {
    let enriched = { ...data };
    try {
      const state = await this.stateStore.getDeploy(tenantId, userId, projectId, featureName);
      if (state) {
        enriched = {
          packages: state.packages,
          url: this.computeTopLevelDeployUrl(state.packages),
          ...enriched,
        };
      }
    } catch { /* best-effort */ }

    try {
      const channel = getRealtimeBroadcastChannel(tenantId, userId);
      await this.stateStore.publish(channel, {
        type: 'deploy',
        projectId,
        featureName,
        data: { type: 'status', data: enriched },
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
   * Discover deployable frontend packages in the deploy workspace.
   *
   * Reuses `ProjectStructureDetector` (the same detector PreviewService
   * uses) — SSOT for "what frontends does this project have?". Filters to
   * `type === 'frontend'` only, since the static-server primitives in this
   * service only support frontend artifacts.
   *
   * Returns packages sorted by `path` so slug deduplication and
   * Redis serialization are deterministic across rebuilds.
   */
  private async detectFrontendPackages(workspacePath: string): Promise<PackageInfo[]> {
    const detector = new ProjectStructureDetector();
    const structure = await detector.detect(workspacePath);
    return structure.packages
      .filter(p => p.type === 'frontend')
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  /**
   * Assign URL-safe `slug` (deduped) + per-package `urlKey` to every
   * frontend package. Identical contract to `PreviewService` so producers
   * and consumers agree on the same identifier for any given package name.
   */
  private assignDeployIdentity(packages: PackageInfo[], serverKey: string): void {
    const used = new Set<string>();
    for (const pkg of packages) {
      const base = packageSlug(pkg.name);
      let slug = base;
      let suffix = 2;
      while (used.has(slug)) {
        slug = `${base}-${suffix++}`;
      }
      used.add(slug);
      pkg.slug = slug;
    }

    const isMulti = packages.length > 1;
    for (const pkg of packages) {
      pkg.urlKey = isMulti
        ? toUrlKeyWithService(serverKey, pkg.slug!)
        : toUrlKey(serverKey);
    }
  }

  /**
   * Start a deploy: validate, allocate ports for every frontend package,
   * register state, then kick off the build asynchronously. Returns
   * immediately (non-blocking) so the HTTP response is sent within
   * milliseconds — no ALB/proxy timeout risk.
   * All subsequent status updates are delivered via SSE.
   *
   * Validation order (fail fast, no side effects before success):
   *   1. base branch rejected (deploy is feature-scoped by design)
   *   2. active `code` job rejected (snapshotting a tree mid-write would
   *      yield half-written source files in the deployed build)
   *   3. snapshot codebase → deploy workspace (incremental)
   *   4. detect frontend packages — must be at least 1
   *   5. allocate N ports, register Redis state, spawn executeBuild
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
    // the caller sees a clean 409 without transient side effects.
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

    // 3) Snapshot the codebase into the sibling deploy workspace.
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

    // 4) Detect frontend packages. Backend-only / unsupported projects fail fast.
    const frontends = await this.detectFrontendPackages(deployWorkspacePath);
    if (frontends.length === 0) {
      return {
        success: false,
        reason: 'no-deployable-package',
        message: 'No frontend package found to deploy. Deploy requires at least one frontend (Vite, Next.js, CRA, or static).',
      };
    }

    const serverKey = `${tenantId}:${userId}:${projectId}:${feature}`;
    this.assignDeployIdentity(frontends, serverKey);

    // 5) Allocate one port per package, then build the initial DeployPackage[].
    const allocatedPorts: number[] = [];
    const packagesState: DeployPackage[] = [];
    try {
      for (const fp of frontends) {
        const port = await this.portManager.allocate('deploy');
        allocatedPorts.push(port);
        const framework = detectFramework(fp.path);
        const buildOutputDir = getBuildOutputDir(fp.path, framework);
        const urlKey = fp.urlKey!;
        const basePath = `/deploy/${urlKey}`;
        packagesState.push({
          name: fp.name,
          slug: fp.slug!,
          framework,
          workspacePath: fp.path,
          buildOutputDir,
          basePath,
          port,
          urlKey,
          url: basePath, // deploy URL == basePath (same prefix)
          phase: 'building',
        });
      }
    } catch (err: any) {
      // Release any ports we already grabbed before failing.
      for (const p of allocatedPorts) this.portManager.release(p);
      return {
        success: false,
        reason: 'port-allocation-failed',
        message: `Port allocation failed: ${err.message}`,
      };
    }

    const initialState: Omit<DeployState, 'lastAccessedAt'> = {
      tenantId, userId, projectId, feature,
      phase: 'building',
      host,
      podId: os.hostname(),
      workspacePath: deployWorkspacePath,
      packages: packagesState,
      startedAt: new Date(),
    };

    try {
      await this.stateStore.registerDeploy(initialState);
    } catch (err: any) {
      for (const p of allocatedPorts) this.portManager.release(p);
      return {
        success: false,
        reason: 'state-register-failed',
        message: `Failed to register deploy state: ${err.message}`,
      };
    }

    await this.broadcastStatus(tenantId, userId, projectId, feature, { phase: 'building' });

    // Fire-and-forget: build + serve runs in background
    this.executeBuild(tenantId, userId, projectId, feature, deployWorkspacePath, initialState, generation)
      .catch(err => logger.error(`[Deploy] Unexpected executeBuild error for ${key}: ${err.message}`, { component: 'DeployService' }));

    const summary = packagesState.map(p => `${p.slug}(${p.framework}@${p.port})`).join(', ');
    logger.info(`[Deploy] Build started: ${key} — ${packagesState.length} package(s): ${summary}`, { component: 'DeployService' });
    return { success: true, message: `Build started for ${packagesState.length} package(s)` };
  }

  /**
   * Async build + serve pipeline. Runs in the background after startDeploy()
   * returns. Loops over `state.packages` SERIALLY — concurrent builds in
   * the same workspace would race over `node_modules` and tooling caches.
   *
   * Per-package failures don't abort the whole deploy: the failed package
   * is marked `phase: 'error'` and successful packages continue running.
   * Aggregate state is `error` if ANY package errored, else `running`.
   */
  private async executeBuild(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    workspacePath: string,
    initialState: Omit<DeployState, 'lastAccessedAt'>,
    generation: number
  ): Promise<void> {
    const key = this.makeKey(tenantId, userId, projectId, feature);
    const isStale = () => this.deployGeneration.get(key) !== generation;

    // Working copy of packages we mutate as builds complete.
    const packages: DeployPackage[] = initialState.packages.map(p => ({ ...p }));
    const handles: StaticServerHandle[] = [];
    const tagFor = (pkg: DeployPackage) => packages.length > 1 ? `[${pkg.slug}] ` : '';

    try {
      for (let i = 0; i < packages.length; i++) {
        if (isStale()) {
          logger.info(`[Deploy] executeBuild aborted — generation stale: ${key}`, { component: 'DeployService' });
          return;
        }

        const pkg = packages[i];
        const tag = tagFor(pkg);

        // Build phase
        await this.broadcastLog(tenantId, userId, projectId, feature, `${tag}🏗️  Building ${pkg.name}…`);
        pkg.phase = 'building';
        await this.stateStore.updateDeploy(tenantId, userId, projectId, feature, { phase: 'building', packages });

        const buildResult = await runBuild(pkg.workspacePath, pkg.basePath, (line) => {
          this.broadcastLog(tenantId, userId, projectId, feature, `${tag}${line}`);
        });

        if (isStale()) return;

        if (!buildResult.success) {
          pkg.phase = 'error';
          pkg.error = buildResult.error;
          // Keep going for OTHER packages — partial success is still useful.
          await this.stateStore.updateDeploy(tenantId, userId, projectId, feature, {
            phase: aggregatePhase(packages),
            packages,
            error: buildResult.error,
            buildLog: buildResult.logs,
          });
          await this.broadcastStatus(tenantId, userId, projectId, feature, {
            phase: aggregatePhase(packages),
            error: buildResult.error,
          });
          continue;
        }

        // refresh outputDir from buildResult (e.g. nextjs static export → out/)
        pkg.buildOutputDir = buildResult.outputDir;

        // Serve phase
        pkg.phase = 'deploying';
        await this.stateStore.updateDeploy(tenantId, userId, projectId, feature, {
          phase: aggregatePhase(packages),
          packages,
        });
        await this.broadcastStatus(tenantId, userId, projectId, feature, { phase: aggregatePhase(packages) });

        try {
          const handle = await startStaticServer({
            framework: pkg.framework,
            outputDir: pkg.buildOutputDir,
            port: pkg.port,
            basePath: pkg.basePath,
            workspacePath: pkg.workspacePath,
          });
          handles.push(handle);
          pkg.phase = 'running';
          await this.broadcastLog(tenantId, userId, projectId, feature, `${tag}✅ Deployed at ${pkg.url}`);
        } catch (err: any) {
          pkg.phase = 'error';
          pkg.error = err.message;
          await this.broadcastLog(tenantId, userId, projectId, feature, `${tag}❌ Static server failed: ${err.message}`);
        }
      }

      if (isStale()) {
        // Tear down anything we spun up during this stale build.
        for (const h of handles) { try { await h.stop(); } catch { /* ignore */ } }
        for (const p of packages) this.portManager.release(p.port);
        return;
      }

      const aggregate = aggregatePhase(packages);
      const now = new Date().toISOString();

      // Persist meta.json BEFORE marking running — meta is the rehydrate SSOT.
      const metaPackages: DeployMetaPackage[] = packages
        .filter(p => p.phase === 'running')
        .map(p => ({
          name: p.name,
          slug: p.slug,
          framework: p.framework,
          workspacePath: p.workspacePath,
          buildOutputDir: p.buildOutputDir,
          basePath: p.basePath,
          urlKey: p.urlKey,
        }));

      if (metaPackages.length > 0) {
        try {
          await this.metaStore.write(workspacePath, {
            version: 2,
            tenantId, userId, projectId, feature,
            workspacePath,
            packages: metaPackages,
            createdAt: now,
            updatedAt: now,
          });
        } catch (err: any) {
          logger.warn(`[Deploy] Failed to persist meta.json: ${err.message}`, { component: 'DeployService' });
        }
      }

      await this.stateStore.updateDeploy(tenantId, userId, projectId, feature, {
        phase: aggregate,
        packages,
      });

      // Stash handles for stopDeploy/cleanup. Only packages that actually
      // started have a handle; failed packages have already been logged.
      this.activeDeploys.set(key, {
        handles,
        state: { ...initialState, phase: aggregate, packages, lastAccessedAt: new Date() },
      });

      await this.broadcastStatus(tenantId, userId, projectId, feature, { phase: aggregate });

      const successCount = packages.filter(p => p.phase === 'running').length;
      logger.info(
        `[Deploy] Build completed for ${key} — ${successCount}/${packages.length} package(s) running`,
        { component: 'DeployService' }
      );
    } catch (err: any) {
      // Catastrophic error — release all ports and mark deploy errored.
      for (const h of handles) { try { await h.stop(); } catch { /* ignore */ } }
      for (const p of packages) this.portManager.release(p.port);
      await this.stateStore.updateDeploy(tenantId, userId, projectId, feature, {
        phase: 'error',
        error: err.message,
      }).catch(() => {});
      await this.broadcastStatus(tenantId, userId, projectId, feature, { phase: 'error', error: err.message });
      logger.error(`[Deploy] Build/serve failed for ${key}: ${err.message}`, { component: 'DeployService' });
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
    // abort itself, so this stop cannot race with a concurrent wake-up.
    const inflight = this.rehydrateLocks.get(key);
    if (inflight) {
      try { await inflight; } catch { /* ignore */ }
    }

    const active = this.activeDeploys.get(key);
    const workspacePath = active?.state.workspacePath
      ?? (await this.stateStore.getDeploy(tenantId, userId, projectId, feature))?.workspacePath
      ?? this.guessDeployWorkspacePath(tenantId, userId, projectId, feature);

    if (active) {
      // Stop every static server in parallel — they're independent.
      await Promise.all(active.handles.map(async (h) => {
        try { await h.stop(); }
        catch (err: any) { logger.warn(`[Deploy] Stop handle error: ${err.message}`, { component: 'DeployService' }); }
      }));
      for (const pkg of active.state.packages) {
        this.portManager.release(pkg.port);
      }
      this.activeDeploys.delete(key);
    }

    await this.stateStore.unregisterDeploy(tenantId, userId, projectId, feature);
    await this.metaStore.remove(workspacePath);
    await this.broadcastStatus(tenantId, userId, projectId, feature, { phase: 'stopped' });

    logger.info(`[Deploy] Stopped: ${key}`, { component: 'DeployService' });
    return { success: true, message: 'Deploy stopped' };
  }

  /**
   * Ensure the deploy's static servers are running on this pod. If already
   * healthy, returns the current state. Otherwise performs lazy
   * re-hydration: reads meta.json, allocates N ports, spawns ALL static
   * servers, and broadcasts phase transitions.
   *
   * Returns null if the deploy cannot be revived (no meta, all artifacts
   * missing, ports exhausted). Callers must treat this as
   * "unavailable — user must re-deploy".
   */
  async ensureRunning(
    tenantId: string, userId: string, projectId: string, feature: string
  ): Promise<DeployState | null> {
    const key = this.makeKey(tenantId, userId, projectId, feature);
    const state = await this.stateStore.getDeploy(tenantId, userId, projectId, feature);
    const active = this.activeDeploys.get(key);
    const selfPod = os.hostname();

    if (state?.phase === 'running' && active && state.podId === selfPod) {
      return state;
    }

    if (state?.phase === 'running' && state.podId && state.podId !== selfPod) {
      return state;
    }

    const inflight = this.rehydrateLocks.get(key);
    if (inflight) return inflight;

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

    const acquired = await this.stateStore.acquireLock(lockKey, 30);
    if (!acquired) {
      await new Promise((r) => setTimeout(r, 500));
      const fresh = await this.stateStore.getDeploy(tenantId, userId, projectId, feature);
      if (fresh?.phase === 'running') return fresh;
      logger.warn(`[Deploy] Rehydrate skipped — another pod holds the lock: ${key}`, { component: 'DeployService' });
      return null;
    }

    const allocatedPorts: number[] = [];
    const handles: StaticServerHandle[] = [];

    try {
      const workspacePath = existing?.workspacePath
        ?? this.guessDeployWorkspacePath(tenantId, userId, projectId, feature);

      const meta = await this.metaStore.read(workspacePath);
      if (!meta || meta.packages.length === 0) {
        await this.broadcastStatus(tenantId, userId, projectId, feature, { phase: 'unavailable' });
        logger.warn(`[Deploy] Rehydrate aborted — no meta.json: ${key}`, { component: 'DeployService' });
        return null;
      }

      // Validate every package's build artifact exists. If ANY are missing,
      // the meta is stale — clear it and surface unavailable to force a
      // fresh deploy.
      const missing = meta.packages.filter(p => !fs.existsSync(p.buildOutputDir));
      if (missing.length > 0) {
        await this.broadcastStatus(tenantId, userId, projectId, feature, {
          phase: 'unavailable',
          error: `Build output missing for ${missing.map(p => p.slug).join(', ')}`,
        });
        await this.metaStore.remove(workspacePath);
        logger.warn(`[Deploy] Rehydrate aborted — buildOutputDir missing for ${missing.map(p => p.slug).join(', ')}`, { component: 'DeployService' });
        return null;
      }

      await this.broadcastStatus(tenantId, userId, projectId, feature, { phase: 'starting' });

      const host = this.getPodHost();
      const packagesState: DeployPackage[] = [];

      for (const mp of meta.packages) {
        let port: number;
        try {
          port = await this.portManager.allocate('deploy');
          allocatedPorts.push(port);
        } catch (err: any) {
          logger.warn(`[Deploy] Port allocation failed for ${mp.slug}: ${err.message}`, { component: 'DeployService' });
          throw err;
        }

        const handle = await startStaticServer({
          framework: mp.framework,
          outputDir: mp.buildOutputDir,
          port,
          basePath: mp.basePath,
          workspacePath: mp.workspacePath,
        });
        handles.push(handle);

        packagesState.push({
          name: mp.name,
          slug: mp.slug,
          framework: mp.framework,
          workspacePath: mp.workspacePath,
          buildOutputDir: mp.buildOutputDir,
          basePath: mp.basePath,
          port,
          urlKey: mp.urlKey,
          url: mp.basePath,
          phase: 'running',
        });
      }

      // Generation guard: if a stopDeploy/startDeploy landed mid-spawn,
      // discard everything we just started.
      if ((this.deployGeneration.get(key) ?? 0) !== genAtStart) {
        for (const h of handles) { try { await h.stop(); } catch { /* ignore */ } }
        for (const p of allocatedPorts) this.portManager.release(p);
        logger.info(`[Deploy] Rehydrate aborted (generation bumped): ${key}`, { component: 'DeployService' });
        return null;
      }

      const fullState: Omit<DeployState, 'lastAccessedAt'> = {
        tenantId, userId, projectId, feature,
        phase: 'running',
        host,
        podId: os.hostname(),
        workspacePath: meta.workspacePath,
        packages: packagesState,
        startedAt: new Date(),
      };
      await this.stateStore.registerDeploy(fullState);
      this.activeDeploys.set(key, {
        handles,
        state: { ...fullState, lastAccessedAt: new Date() },
      });

      await this.broadcastStatus(tenantId, userId, projectId, feature, { phase: 'running' });

      const portsLabel = packagesState.map(p => `${p.slug}:${p.port}`).join(',');
      logger.info(`[Deploy] Rehydrated ${key} on ${host} [${portsLabel}]`, { component: 'DeployService' });
      return { ...fullState, lastAccessedAt: new Date() };
    } catch (err: any) {
      for (const h of handles) { try { await h.stop(); } catch { /* ignore */ } }
      for (const p of allocatedPorts) this.portManager.release(p);
      await this.broadcastStatus(tenantId, userId, projectId, feature, {
        phase: 'unavailable',
        error: err.message,
      });
      logger.error(`[Deploy] Rehydrate failed: ${err.message}`, { component: 'DeployService' });
      return null;
    } finally {
      await this.stateStore.releaseLock(lockKey).catch(() => { /* lock may have expired; safe to ignore */ });
    }
  }

  /**
   * Get deploy status — combines in-memory, Redis, and on-disk meta
   * to report the most accurate phase.
   *
   * Top-level `url` follows the multi-package contract (null for 2+ packages).
   */
  async getStatus(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<{
    phase: DeployPhase;
    url?: string | null;
    packages?: DeployPackage[];
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
        url: this.computeTopLevelDeployUrl(state.packages),
        packages: state.packages,
      };
    }

    // 2. Running on another pod — trust Redis
    if (state?.phase === 'running' && state.podId && state.podId !== selfPod) {
      return {
        phase: 'running',
        url: this.computeTopLevelDeployUrl(state.packages),
        packages: state.packages,
      };
    }

    // 3. In-flight build/deploy/start — surface as-is
    if (state?.phase === 'building' || state?.phase === 'deploying' || state?.phase === 'starting') {
      return {
        phase: state.phase,
        url: this.computeTopLevelDeployUrl(state.packages),
        packages: state.packages,
      };
    }

    // 4. Error passed through
    if (state?.phase === 'error') {
      return {
        phase: 'error',
        error: state.error,
        packages: state.packages,
      };
    }

    // 5. Check meta.json → hibernated (auto-wake eligible)
    const workspacePath = state?.workspacePath
      ?? this.guessDeployWorkspacePath(tenantId, userId, projectId, feature);
    const meta = await this.metaStore.read(workspacePath);
    if (meta && meta.packages.length > 0) {
      // Reconstruct DeployPackage[] from meta — port is unknown until rehydrate.
      const synth: DeployPackage[] = meta.packages.map(mp => ({
        name: mp.name,
        slug: mp.slug,
        framework: mp.framework,
        workspacePath: mp.workspacePath,
        buildOutputDir: mp.buildOutputDir,
        basePath: mp.basePath,
        port: 0,
        urlKey: mp.urlKey,
        url: mp.basePath,
        phase: 'hibernated',
      }));
      return {
        phase: 'hibernated',
        url: this.computeTopLevelDeployUrl(synth),
        packages: synth,
      };
    }

    // 6. Redis entry but no meta → artifact lost
    if (state) {
      return {
        phase: 'unavailable',
        error: state.error,
        packages: state.packages,
      };
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
      // Only `running` has a meta.json on disk and is rehydrate-eligible.
      const wasRunning = d.phase === 'running';
      const nextPhase: DeployPhase = wasRunning ? 'hibernated' : 'error';
      const errorMsg = wasRunning ? undefined : 'Pod restarted during build';

      const summary = (d.packages || []).map(p => `${p.slug}:${p.phase}`).join(',');
      logger.warn(
        `[Deploy] Transitioning stale deploy → ${nextPhase}: ${d.tenantId}:${d.userId}:${d.projectId}:${d.feature} (was ${d.phase}, packages=[${summary}])`,
        { component: 'DeployService' }
      );
      try {
        // Mark every package's phase to match the aggregate so callers
        // observing per-package state see consistent values.
        const nextPackages = (d.packages || []).map(p => ({ ...p, phase: nextPhase }));
        await this.stateStore.updateDeploy(d.tenantId, d.userId, d.projectId, d.feature, {
          phase: nextPhase,
          packages: nextPackages,
          ...(errorMsg ? { error: errorMsg } : {}),
        });
        // NOTE: per-package ports were allocated by a previous pod process;
        // this pod's PortManager has no record of them, so release() is a no-op.
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
   * Periodically evict idle deploys: stop all static-server processes but
   * keep meta.json + Redis entry (with phase='hibernated'). Next URL access
   * will auto-rehydrate via ensureRunning().
   */
  startIdleEviction(): void {
    if (this.idleCheckInterval) {
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
            // Stop ALL handles in parallel and release every package's port.
            await Promise.all(active.handles.map(async (h) => {
              try { await h.stop(); } catch { /* ignore */ }
            }));
            for (const pkg of active.state.packages) {
              this.portManager.release(pkg.port);
            }
            this.activeDeploys.delete(key);
          }
          const hibernatedPackages = (d.packages || []).map(p => ({ ...p, phase: 'hibernated' as DeployPhase }));
          await this.stateStore.updateDeploy(d.tenantId, d.userId, d.projectId, d.feature, {
            phase: 'hibernated',
            packages: hibernatedPackages,
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
        await Promise.all(active.handles.map(h => h.stop().catch(() => {})));
        for (const pkg of active.state.packages) {
          this.portManager.release(pkg.port);
        }
      } catch (err: any) {
        logger.warn(`[Deploy] Cleanup error for ${key}: ${err.message}`, { component: 'DeployService' });
      }
    }
    this.activeDeploys.clear();
  }
}
