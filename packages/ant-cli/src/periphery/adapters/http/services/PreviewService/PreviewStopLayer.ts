/**
 * stopPreview — the one stop authority (kill legs, port release, broadcasts).
 *
 * One layer of the PreviewService inheritance chain (see PreviewServiceCore —
 * tests construct the service and reach protected members/prototype methods
 * directly, so methods stay on the prototype chain, verbatim).
 */

import * as os from 'os';
import { PortManager } from '../../../../../infrastructure/networking/PortManager';
import { PreviewState, ServiceConnection } from '../../../../../core/ports/portRegistry';
import { createServerKey, parseServerKey } from './utils/serverKeyUtils';
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
import { DevProcessControl } from '../../../../../core/process/DevProcessControl';
import { PreviewExitLayer } from './PreviewExitLayer';

export class PreviewStopLayer extends PreviewExitLayer {
  async stopPreview(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    opts?: { suppressStoppedBroadcast?: boolean; skipFanout?: boolean },
  ): Promise<{ success: boolean; message?: string; error?: string }> {
    const serverKey = createServerKey(tenantId, userId, projectId, feature);
    
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

    // Cross-pod stop is fanned out AFTER local teardown (see below): every
    // pod with live handles reaps via `stopPreviewIfOwned`, which no-ops on
    // pods without handles — including this one, since by publish time our
    // `previewServers` entry is already deleted (self-receipt loop guard).

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
      const { projectId: pId, feature: feat } = parseServerKey(serverKey);
      const infraProjectName = `ant-${pId}-${feat}`.replace(/[^a-zA-Z0-9_-]/g, '-');
      const logCallback = (type: 'stdout' | 'stderr', msg: string) => this.appendLog(serverKey, type, msg);
      await this.infrastructureManager.stopInfrastructure(localPath, logCallback, infraProjectName);
    }
    
    // Kill local processes via DevProcessControl.killTree (descendant aware
    // + SIGKILL escalation), then reap any owned-but-handle-less survivors.
    let stoppedCount = 0;
    const cwdsToClean: string[] = [];
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

    // Safety net: reap any process WE recorded for this serverKey that the
    // live-handle killAndWait above didn't cover (e.g. after a Node restart
    // the handles are gone but the detached group survives). Identity-scoped
    // via persisted pgid — `killOwned` acts ONLY on records whose podId is
    // this host, so it can never reach another project or another pod's
    // process. Then clear stale framework dev locks for filesystem hygiene.
    const ownedRecords = await this.ownedRecordsFor(tenantId, userId, projectId, feature, redisState);
    if (ownedRecords.length > 0) {
      await this.dev.killOwned(ownedRecords, { graceMs: 3_000 });
    }
    for (const cwd of cwdsToClean) {
      await this.dev.cleanupStaleLocks(cwd);
    }
    
    // Read connections from Redis BEFORE unregister (so we can include them in broadcast)
    let resetConnections: ServiceConnection[] = [];
    let currentState: PreviewState | null = null;
    if (this.portRegistry) {
      try {
        currentState = redisState || await this.portRegistry.getPreview(tenantId, userId, projectId, feature);
        if (currentState?.connections?.length) {
          resetConnections = currentState.connections.map(c => ({ ...c, status: 'stopped' as const }));
        }
        // Release ALL ports (entry + every package port). Merge the pod-local
        // spawn facts: after a rehydrate REPLACE the Redis record carries the
        // LAST rehydrator's ports, and this pod's own claims exist only in
        // `localPreviews` — without the merge they leak until TTL.
        if (this.portManager) {
          const portsToRelease = new Set<number>();
          const collect = (s: { port?: number | null; backendPort?: number; packages?: ReadonlyArray<{ port?: number }> } | null | undefined) => {
            if (!s) return;
            if (s.port) portsToRelease.add(s.port);
            if (s.backendPort) portsToRelease.add(s.backendPort);
            for (const pkg of s.packages || []) {
              if (pkg.port) portsToRelease.add(pkg.port);
            }
          };
          collect(currentState);
          collect(this.localPreviews.get(serverKey));
          for (const p of portsToRelease) {
            this.portManager.release(p);
          }
        }
      } catch { /* best-effort */ }
    }

    // Unregister from PortRegistry (Redis). A LOCAL-ONLY stop (skipFanout:
    // fan-out receipt, orphan reap, shutdown) must NOT delete a record owned
    // by another pod — e.g. a forceRestart fan-out receipt racing the
    // restarting pod's freshly re-registered record, or a pod shutdown while
    // the record's owner keeps serving.
    if (this.portRegistry) {
      const ownsRecord = !currentState?.podId || currentState.podId === os.hostname();
      if (!opts?.skipFanout || ownsRecord) {
        await this.portRegistry.unregisterPreview(tenantId, userId, projectId, feature);
      }
    }

    // Cleanup local state (process handles, paths — logs preserved until next start)
    this.previewServers.delete(serverKey);
    this.previewServerPaths.delete(serverKey);
    this.localPreviews.delete(serverKey);

    // Fan the stop out to the OTHER pods (each reaps its own instance via
    // `stopPreviewIfOwned`). Published after local teardown so this pod's own
    // receipt no-ops on the already-empty `previewServers`.
    if (!opts?.skipFanout) {
      await this.publishPreviewStop(tenantId, userId, projectId, feature);
    }

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
}
