/**
 * DeployService
 * 
 * Orchestrates the deploy lifecycle:
 * 1. Detect framework
 * 2. Run production build (with base path injection)
 * 3. Start static server
 * 4. Register deploy state in Redis
 * 5. Broadcast status via SSE
 */

import * as os from 'os';
import { PortManager } from '../networking/PortManager';
import { StateStorePort, DeployState, DeployPhase } from '../../core/ports/stateStore';
import { detectFramework, getBuildOutputDir, runBuild } from './BuildRunner';
import { startStaticServer, StaticServerHandle } from './StaticServer';
import { getRealtimeBroadcastChannel } from '../state/redisConstants';
import { toUrlKey } from '../../periphery/adapters/http/services/PreviewService/utils/serverKeyUtils';
import { logger } from '../../utils/logger';

export interface DeployServiceOptions {
  portManager: PortManager;
  stateStore: StateStorePort;
  workspacesPath?: string;
}

interface ActiveDeploy {
  handle: StaticServerHandle;
  state: DeployState;
}

export class DeployService {
  private portManager: PortManager;
  private stateStore: StateStorePort;
  private activeDeploys = new Map<string, ActiveDeploy>();
  /**
   * Monotonically increasing generation per deploy key.
   * Incremented on every startDeploy/stopDeploy call.
   * executeBuild checks its generation against current — if mismatched,
   * a newer deploy or stop was issued and this build should abort.
   */
  private deployGeneration = new Map<string, number>();

  constructor(options: DeployServiceOptions) {
    this.portManager = options.portManager;
    this.stateStore = options.stateStore;
  }

  private makeKey(tenantId: string, userId: string, projectId: string, feature: string): string {
    return `${tenantId}:${userId}:${projectId}:${feature}`;
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

  private async broadcastStatus(
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
   */
  async startDeploy(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    workspacePath: string
  ): Promise<{ success: boolean; message: string }> {
    const key = this.makeKey(tenantId, userId, projectId, feature);

    // Stop existing deploy if any
    const existing = this.activeDeploys.get(key);
    if (existing) {
      await this.stopDeploy(tenantId, userId, projectId, feature);
    }

    // Bump generation — invalidates any in-flight executeBuild for this key
    const generation = (this.deployGeneration.get(key) ?? 0) + 1;
    this.deployGeneration.set(key, generation);

    const host = this.getPodHost();
    const framework = detectFramework(workspacePath);
    const serverKey = `${tenantId}:${userId}:${projectId}:${feature}`;
    const urlKey = toUrlKey(serverKey);
    const basePath = `/deploy/${urlKey}`;

    // Allocate port
    let port: number;
    try {
      port = await this.portManager.allocate('deploy');
    } catch (err: any) {
      return { success: false, message: `Port allocation failed: ${err.message}` };
    }

    // Register initial state in Redis
    const initialState: Omit<DeployState, 'lastAccessedAt'> = {
      tenantId, userId, projectId, feature,
      phase: 'building',
      port,
      host,
      podId: os.hostname(),
      framework,
      buildOutputDir: getBuildOutputDir(workspacePath, framework),
      basePath,
      startedAt: new Date(),
    };

    try {
      await this.stateStore.registerDeploy(initialState);
    } catch (err: any) {
      this.portManager.release(port);
      return { success: false, message: `Failed to register deploy state: ${err.message}` };
    }

    await this.broadcastStatus(tenantId, userId, projectId, feature, { phase: 'building', framework });

    // Fire-and-forget: build + serve runs in background
    this.executeBuild(tenantId, userId, projectId, feature, workspacePath, port, framework, urlKey, basePath, initialState, generation)
      .catch(err => logger.error(`[Deploy] Unexpected executeBuild error for ${key}: ${err.message}`, { component: 'DeployService' }));

    logger.info(`[Deploy] Build started: ${key} (${framework})`, { component: 'DeployService' });
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
      // Run build
      const buildResult = await runBuild(workspacePath, basePath, (line) => {
        this.broadcastLog(tenantId, userId, projectId, feature, line);
      });

      // Abort if a newer deploy or stop was issued while building
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

      // Start static server
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

    // Bump generation — any in-flight executeBuild() with an older generation will abort
    this.deployGeneration.set(key, (this.deployGeneration.get(key) ?? 0) + 1);

    const active = this.activeDeploys.get(key);
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
    await this.broadcastStatus(tenantId, userId, projectId, feature, { phase: 'stopped' });

    logger.info(`[Deploy] Stopped: ${key}`, { component: 'DeployService' });
    return { success: true, message: 'Deploy stopped' };
  }

  /**
   * Get deploy status.
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
    const state = await this.stateStore.getDeploy(tenantId, userId, projectId, feature);
    if (!state) {
      return { phase: 'idle' };
    }

    return {
      phase: state.phase,
      url: state.url,
      port: state.port,
      framework: state.framework,
      error: state.error,
    };
  }

  /**
   * Clean up stale deploys left in Redis from a previous process lifecycle.
   * On restart, the in-memory activeDeploys Map and StaticServer processes are
   * gone, but Redis may still hold phase:'running' entries with this pod's ID.
   * This removes them so requests get a clear 404 instead of a perpetual 502.
   */
  async cleanupStaleDeploys(): Promise<void> {
    const currentPodId = os.hostname();
    const allDeploys = await this.stateStore.listDeploys();

    const staleDeploys = allDeploys.filter(
      d => d.podId === currentPodId &&
        (d.phase === 'running' || d.phase === 'deploying' || d.phase === 'building')
    );

    for (const deploy of staleDeploys) {
      logger.warn(
        `[Deploy] Cleaning stale deploy: ${deploy.tenantId}:${deploy.userId}:${deploy.projectId}:${deploy.feature} (was ${deploy.phase})`,
        { component: 'DeployService' }
      );
      await this.stateStore.unregisterDeploy(
        deploy.tenantId, deploy.userId, deploy.projectId, deploy.feature
      );
      this.portManager.release(deploy.port);
    }

    if (staleDeploys.length > 0) {
      logger.warn(
        `[Deploy] Cleaned ${staleDeploys.length} stale deploy(s) from previous process`,
        { component: 'DeployService' }
      );
    }
  }

  /**
   * Cleanup all active deploys (shutdown).
   */
  async cleanup(): Promise<void> {
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
