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

import { ChildProcess } from 'child_process';
import * as os from 'os';
import { PortManager } from '../../../../../infrastructure/networking/PortManager';
import { PreviewState } from '../../../../../core/ports/portRegistry';
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
import { DevProcessControl, OwnedProcessRecord } from '../../../../../core/process/DevProcessControl';
import { PreviewLocalLayer } from './PreviewLocalLayer';

export { summarizePreviewSpawnOutcome } from './PreviewStartLayer';

// Idle timeout configuration
const IDLE_CHECK_INTERVAL_MS = 60 * 1000; // Check every minute

// Grace window before an orphaned local instance (live handles, no Redis
// record) is reaped by the idle check — protects the forceRestart
// unregister→register window from a racing idle tick.
const ORPHAN_REAP_MIN_AGE_MS = 2 * 60 * 1000;

export class PreviewService extends PreviewLocalLayer {
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
   * Check for idle instances and terminate them.
   *
   * Iterates the POD-LOCAL instance set (`previewServers.keys()`) — not the
   * Redis registry — so an orphaned local instance whose shared record was
   * REPLACE-stolen and later deleted by another pod is still visited and
   * reaped instead of leaking until pod restart. `lastAccessedAt` on the
   * shared record is touched by WHICHEVER pod serves traffic, so a preview
   * only counts as idle when it is idle globally.
   */
  protected async checkIdleInstances(): Promise<void> {
    const now = Date.now();
    let checkedCount = 0;
    let terminatedCount = 0;

    const registry = this.stateStore ?? this.portRegistry;
    if (!registry) {
      logger.debug('[IdleCheck] No stateStore or portRegistry configured, skipping', {
        component: 'PreviewService'
      });
      return;
    }

    try {
      const localKeys = Array.from(this.previewServers.keys());
      if (localKeys.length === 0) return;

      const previews = await registry.listPreviews();
      const byKey = new Map(previews.map(p => [
        createServerKey(p.tenantId, p.userId, p.projectId, p.feature), p,
      ]));

      for (const serverKey of localKeys) {
        const { tenantId, userId, projectId, feature } = parseServerKey(serverKey);
        const preview = byKey.get(serverKey);
        checkedCount++;

        if (!preview) {
          // Orphaned local instance: the shared record is gone (stopped /
          // unregistered elsewhere). Reap locally — but give a fresh spawn a
          // grace window so a racing forceRestart's unregister→register gap
          // can't kill a healthy instance mid-start.
          const spawnedAt = this.spawnTimestamps.get(serverKey) ?? 0;
          if (now - spawnedAt < ORPHAN_REAP_MIN_AGE_MS) continue;
          logger.warn(`[IdleCheck] Reaping orphaned local preview (no registry record): ${serverKey}`, {
            component: 'PreviewService'
          });
          try {
            await this.stopPreview(tenantId, userId, projectId, feature, { skipFanout: true });
            terminatedCount++;
          } catch (error: any) {
            logger.warn(`[IdleCheck] Failed to reap orphaned preview ${serverKey}: ${error.message}`, {
              component: 'PreviewService'
            });
          }
          continue;
        }

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
            // Global idleness (shared lastAccessedAt) → fan out so every
            // pod's instance of this preview reaps together.
            await this.stopPreview(tenantId, userId, projectId, feature);
            terminatedCount++;
          } catch (error: any) {
            logger.warn(`[IdleCheck] Failed to terminate idle preview ${serverKey}: ${error.message}`, {
              component: 'PreviewService'
            });
          }
        }
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
   * Cleanup every preview server attached to a single project (all features).
   *
   * Cross-process delete cascade calls this through the Redis pub/sub
   * `ant:lifecycle:cleanup:request` channel — see PreviewServer subscriber.
   */

  async cleanupProject(
    organizationId: string,
    userId: string,
    projectId: string,
  ): Promise<void> {
    const targetPrefix = `${organizationId}:${userId}:${projectId}:`;
    const serverKeys = Array.from(this.previewServers.keys()).filter((k) => k.startsWith(targetPrefix));
    logger.info(`[PreviewService] cleanupProject — ${serverKeys.length} server(s)`, { component: 'PreviewService' }, { organizationId, userId, projectId });
    for (const serverKey of serverKeys) {
      const { tenantId, userId: keyUserId, projectId: keyProjectId, feature } = parseServerKey(serverKey);
      try {
        await this.stopPreview(tenantId, keyUserId, keyProjectId, feature);
      } catch (err) {
        logger.warn(`[PreviewService] cleanupProject stop failed (continuing)`, { component: 'PreviewService' }, { serverKey, err });
      }
    }
  }

  /**
   * Cleanup the preview server for a single feature.
   *
   * Idempotent — no-op if no preview is running for that feature.
   */
  async cleanupFeature(
    organizationId: string,
    userId: string,
    projectId: string,
    featureName: string,
  ): Promise<void> {
    try {
      await this.stopPreview(organizationId, userId, projectId, featureName);
    } catch (err) {
      logger.warn(`[PreviewService] cleanupFeature stop failed (continuing)`, { component: 'PreviewService' }, { organizationId, userId, projectId, featureName, err });
    }
  }

  // ==========================================
  // Owned-identity reaping (cross-pod-safe cleanup SSOT)
  // ==========================================

  /**
   * Build the ANT-owned process records for a serverKey from the persisted
   * Redis preview state. `killOwned` itself filters to this pod (podId ===
   * os.hostname()), so cross-pod records are simply skipped — passing them
   * is harmless. `preloaded` lets callers reuse a state they already fetched.
   */

  async stopPreviewIfOwned(
    organizationId: string,
    userId: string,
    projectId: string,
    feature: string,
  ): Promise<void> {
    const serverKey = createServerKey(organizationId, userId, projectId, feature);
    if (!this.previewServers.has(serverKey)) return; // not owned here
    try {
      // skipFanout — this call IS the fan-out receipt; re-publishing would
      // loop. suppressStoppedBroadcast — the INITIATOR owns the FE-facing
      // 'stopped' signal; a late receipt must not clobber a restart's
      // 'installing' phase with a stray 'stopped'.
      await this.stopPreview(organizationId, userId, projectId, feature, {
        skipFanout: true,
        suppressStoppedBroadcast: true,
      });
    } catch (err) {
      logger.warn(`[PreviewService] stopPreviewIfOwned failed (continuing)`, { component: 'PreviewService' }, { serverKey, err });
    }
  }

  /**
   * Reconcile previews this pod owned before a Node-process restart inside a
   * living container: the detached dev-server groups survive (still holding
   * their ports) but the live `ChildProcess` handles are gone. List the Redis
   * previews indexed under this hostname, reap each by persisted pgid, release
   * its port claims, and unregister. Called once from PreviewServer boot.
   *
   * A full CONTAINER restart destroys the PID namespace, so persisted numbers
   * resolve to nothing → `kill(-pgid)` is a harmless ESRCH no-op (the dev
   * servers already died with the container). The TTL'd Redis claim is the
   * backstop for that case.
   */
  async reconcileOwnedPreviews(): Promise<void> {
    if (!this.portRegistry) return;
    const host = os.hostname();
    let previews: PreviewState[] = [];
    try {
      previews = await this.portRegistry.listPreviewsByPod(host);
    } catch (err: any) {
      logger.warn(`[PreviewService] reconcileOwnedPreviews list failed: ${err?.message ?? err}`, { component: 'PreviewService' });
      return;
    }
    if (previews.length === 0) return;

    logger.warn(`[PreviewService] Reconciling ${previews.length} owned preview(s) from a prior process on ${host}`, { component: 'PreviewService' });

    for (const state of previews) {
      // Stale PREVIEW_BY_POD index entry: `registerPreview` sadd's the new
      // owner's index but never srem's the previous owner's, so after a
      // rehydrate REPLACE this pod's index can point at a record now owned
      // by ANOTHER pod. Releasing its ports / unregistering it here would
      // tear down that pod's healthy preview — skip it.
      if (state.podId && state.podId !== host) {
        logger.debug(`[PreviewService] reconcile skip (record owned by ${state.podId}): ${state.projectId}/${state.feature}`, { component: 'PreviewService' });
        continue;
      }
      const records: OwnedProcessRecord[] = [];
      for (const pkg of state.packages || []) {
        if (typeof pkg.pid === 'number' && pkg.pid > 0) {
          records.push({ pid: pkg.pid, pgid: pkg.pgid, podId: pkg.podId || host });
        }
      }
      if (records.length > 0) {
        await this.dev.killOwned(records, { graceMs: 2_000 }).catch(() => { /* best-effort */ });
      }

      // Release every port claim this preview held.
      if (this.portManager) {
        const ports = new Set<number>();
        if (state.port) ports.add(state.port);
        if (state.backendPort) ports.add(state.backendPort);
        for (const pkg of state.packages || []) {
          if (pkg.port) ports.add(pkg.port);
        }
        for (const p of ports) {
          try { this.portManager.release(p); } catch { /* best-effort */ }
        }
      }

      try {
        await this.portRegistry.unregisterPreview(state.tenantId, state.userId, state.projectId, state.feature);
      } catch { /* best-effort */ }
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
      const { tenantId, userId, projectId, feature } = parseServerKey(serverKey);

      // skipFanout — pod shutdown reaps ONLY its own instances; other pods'
      // instances of the same previews keep serving.
      const cleanupPromise = this.stopPreview(tenantId, userId, projectId, feature, { skipFanout: true })
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
