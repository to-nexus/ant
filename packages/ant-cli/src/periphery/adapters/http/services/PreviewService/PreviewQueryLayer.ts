/**
 * Status/log read path plus the owned-record helpers the stop/start layers consume.
 *
 * One layer of the PreviewService inheritance chain (see PreviewServiceCore —
 * tests construct the service and reach protected members/prototype methods
 * directly, so methods stay on the prototype chain, verbatim).
 */

import { Response } from 'express';
import * as path from 'path';
import { LogEntry } from '../../../../../core/ports/http';
import { PortManager } from '../../../../../infrastructure/networking/PortManager';
import { PreviewState, PreviewPhase, ServiceConnection } from '../../../../../core/ports/portRegistry';
import type { ProjectProfile } from '@ant/shared';
import { PreviewIssue } from './types';
import { createServerKey } from './utils/serverKeyUtils';
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
import { REDIS_KEYS } from '../../../../../core/constants/redis';
import type { CleanupRequestPayload } from '../ProjectService/previewCleanup';
import { randomUUID } from 'crypto';
import { PreviewServiceCore } from './PreviewServiceCore';

export class PreviewQueryLayer extends PreviewServiceCore {
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
    projectProfile?: ProjectProfile;
    connections?: ServiceConnection[];
    restartRequired?: boolean;
    setupReasoning?: string;
    setupReason?: string;
    suggestedFix?: string;
  }> {
    const serverKey = createServerKey(tenantId, userId, projectId, feature);
    
    // 1. Read from Redis (source of truth)
    if (this.portRegistry) {
      try {
        const redisState = await this.portRegistry.getPreview(tenantId, userId, projectId, feature);
        if (redisState) {
          // Supplement with local process count (only available on owning pod)
          const processes = this.previewServers.get(serverKey);
          const aliveProcesses = processes?.filter(p => !p.killed && p.exitCode === null) || [];
          
          // No PREVIEW_CONFIG fallback here: `resolveProjectFacts` at the HTTP
          // boundary owns provenance ranking across fresh / runtime / cached, so
          // reading the cache again on every /status would be a redundant round
          // trip that also bypasses the rank rule.
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
            projectProfile: redisState.projectProfile,
            connections: redisState.connections,
            restartRequired: redisState.restartRequired,
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
    const serverKey = createServerKey(tenantId, userId, projectId, feature);
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
    const serverKey = createServerKey(tenantId, userId, projectId, feature);
    
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

  protected async ownedRecordsFor(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    preloaded?: PreviewState | null,
  ): Promise<OwnedProcessRecord[]> {
    let state = preloaded ?? null;
    if (!state && this.portRegistry) {
      try {
        state = await this.portRegistry.getPreview(tenantId, userId, projectId, feature);
      } catch { /* best-effort */ }
    }
    const records: OwnedProcessRecord[] = [];
    const seen = new Set<number>();
    const collect = (pkgs: ReadonlyArray<{ pid?: number; pgid?: number; podId?: string }> | undefined) => {
      for (const pkg of pkgs || []) {
        if (typeof pkg.pid === 'number' && pkg.pid > 0 && pkg.podId && !seen.has(pkg.pid)) {
          seen.add(pkg.pid);
          records.push({ pid: pkg.pid, pgid: pkg.pgid, podId: pkg.podId });
        }
      }
    };
    collect(state?.packages);
    // Merge the pod-local spawn facts: after a rehydrate REPLACE the Redis
    // record carries another pod's pids — ours are only recorded here.
    const serverKey = createServerKey(tenantId, userId, projectId, feature);
    collect(this.localPreviews.get(serverKey)?.packages);
    return records;
  }

  /**
   * Fan out a single-serverKey stop on the shared lifecycle channel so the
   * OWNING pod (the one holding the live handles) reaps via `stopPreviewIfOwned`.
   * Fire-and-forget (no ack wait) — see `CleanupScope` `'preview-stop'`.
   */
  protected async publishPreviewStop(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
  ): Promise<void> {
    if (!this.stateStore) return;
    const payload: CleanupRequestPayload = {
      requestId: randomUUID(),
      scope: 'preview-stop',
      organizationId: tenantId,
      userId,
      projectId,
      featureName: feature,
    };
    try {
      await this.stateStore.publish(REDIS_KEYS.LIFECYCLE.CLEANUP_REQUEST, payload);
    } catch (err: any) {
      logger.warn(`[PreviewService] publishPreviewStop failed (best-effort): ${err?.message ?? err}`, { component: 'PreviewService' });
    }
  }

  /**
   * Stop a preview ONLY if this pod owns the live process handles. Invoked by
   * the `preview-stop` cleanup-request subscriber on every pod; the no-op on
   * non-owning pods is what makes the broadcast safe — only the owner reaps.
   */
}
