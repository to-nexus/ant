/**
 * Local-first resolution — pod-local spawn facts, readiness waits, ensureRunning
 * and rehydrate coalescing.
 *
 * One layer of the PreviewService inheritance chain (see PreviewServiceCore —
 * tests construct the service and reach protected members/prototype methods
 * directly, so methods stay on the prototype chain, verbatim).
 */

import * as path from 'path';
import * as os from 'os';
import { PortManager } from '../../../../../infrastructure/networking/PortManager';
import { PreviewState } from '../../../../../core/ports/portRegistry';
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
import { DevProcessControl } from '../../../../../core/process/DevProcessControl';
import { resolveCrossPodLiveness } from '../../../../../core/utils/crossPodLiveness';
import { PreviewStartLayer } from './PreviewStartLayer';
// How long ensureRunning waits for the dev server's health check before
// returning a not-yet-ready record. Vite/Next cold start on EFS is 10-30s;
// the proxy's per-attempt upstream deadline (45s) + transport retry absorb
// the tail beyond this bound.
const ENSURE_READY_TIMEOUT_MS = 30_000;

export class PreviewLocalLayer extends PreviewStartLayer {
  getLocalPreview(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
  ): PreviewState | null {
    const serverKey = createServerKey(tenantId, userId, projectId, feature);
    if (!this.previewServers.has(serverKey)) return null;
    return this.localPreviews.get(serverKey) ?? null;
  }

  /** Bounded wait on the in-flight health check (no-op when none pending). */
  protected async awaitReadiness(serverKey: string, timeoutMs: number): Promise<void> {
    const readiness = this.pendingReadiness.get(serverKey);
    if (!readiness) return;
    await Promise.race([
      readiness,
      new Promise<void>((resolve) => {
        const t = setTimeout(resolve, timeoutMs);
        (t as any).unref?.();
      }),
    ]);
  }

  /**
   * Ensure a dev server for this feature is serving from THIS pod, rehydrating
   * from the shared EFS workspace when necessary. The preview twin of
   * `DeployService.ensureRunning` (local-first self-heal):
   *
   *   1. Local fast path — this pod holds live handles: serve the local spawn
   *      facts regardless of who owns the shared Redis record (the record may
   *      have been REPLACE'd by another pod's rehydrate).
   *   2. Cross-pod trust gate — another pod's `running` record is trusted ONLY
   *      if its dev-server port passes the TCP liveness probe. A record that
   *      fails the probe is NEVER returned (returning it verbatim was the
   *      stale-record 502: the proxy burned its transport retries against a
   *      network-blocked cross-pod target).
   *   3. Rehydrate locally — in-process coalesced; takes a POD-scoped start
   *      lock (each pod legitimately needs its own instance when pod-to-pod
   *      networking is blocked) and awaits the health check (bounded) so the
   *      triggering request lands on a listening dev server.
   *
   * Rehydrate reuses `startPreview(forceRestart=false)` — its `installIfNeeded`
   * is a filesystem-only no-op when `node_modules` already exist on EFS.
   */
  async ensureRunning(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    localPath: string,
  ): Promise<PreviewState | null> {
    const serverKey = createServerKey(tenantId, userId, projectId, feature);
    const selfPod = os.hostname();

    // 1. Local fast path — no Redis podId requirement: live local handles win.
    const local = this.getLocalPreview(tenantId, userId, projectId, feature);
    if (local) {
      if (!local.ready) {
        await this.awaitReadiness(serverKey, ENSURE_READY_TIMEOUT_MS);
      }
      const current = this.portRegistry
        ? await this.portRegistry.getPreview(tenantId, userId, projectId, feature)
        : null;
      if (current?.podId === selfPod) return current; // shared record is ours (fresher phase/ready)
      return this.getLocalPreview(tenantId, userId, projectId, feature) ?? current;
    }

    // 2. Cross-pod trust gate (deploy parity, DeployService.ensureRunning).
    const current = this.portRegistry
      ? await this.portRegistry.getPreview(tenantId, userId, projectId, feature)
      : null;
    if (current?.running && current.podId && current.podId !== selfPod) {
      const probePort = current.port || current.packages?.[0]?.port;
      if (probePort) {
        const liveness = await resolveCrossPodLiveness({ host: current.host, port: probePort }, false);
        if (liveness === 'reachable') return current;
      }
    }

    // 3. In-process coalescing: concurrent requests share one rehydrate.
    const inflight = this.rehydrateLocks.get(serverKey);
    if (inflight) return inflight;
    const promise = this.rehydrateLocal(tenantId, userId, projectId, feature, localPath, serverKey, selfPod)
      .finally(() => this.rehydrateLocks.delete(serverKey));
    this.rehydrateLocks.set(serverKey, promise);
    return promise;
  }

  protected async rehydrateLocal(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    localPath: string,
    serverKey: string,
    selfPod: string,
  ): Promise<PreviewState | null> {
    try {
      await this.startPreview(tenantId, userId, projectId, feature, localPath, undefined, false, { lockScope: 'pod' });
    } catch (err: any) {
      logger.warn(
        `[Preview] ensureRunning rehydrate failed for ${serverKey}: ${err?.message ?? err}`,
        { component: 'PreviewService' },
      );
    }
    // Wait (bounded) for the dev server to actually listen; on timeout the
    // local record is still returned (ready:false) — the proxy's transport
    // retry + single self-heal retry absorb the remaining cold-start tail.
    await this.awaitReadiness(serverKey, ENSURE_READY_TIMEOUT_MS);

    const localState = this.getLocalPreview(tenantId, userId, projectId, feature);
    if (localState) return localState;

    // No local instance came up (start failed / lock contention). NEVER hand
    // back a cross-pod record that fails the liveness probe — that is the
    // stale-record 502 regression.
    const state = this.portRegistry
      ? await this.portRegistry.getPreview(tenantId, userId, projectId, feature)
      : null;
    if (!state) return null;
    if (state.podId && state.podId !== selfPod) {
      const probePort = state.port || state.packages?.[0]?.port;
      const liveness = probePort
        ? await resolveCrossPodLiveness({ host: state.host, port: probePort }, false)
        : 'unreachable';
      if (liveness !== 'reachable') return null;
    }
    return state;
  }

  /**
   * Start preview server for a project feature
   *
   * @param forceRestart - If true, stops existing server before starting a new one
   * @param opts.lockScope - `'global'` (default): one start per serverKey across
   *   ALL pods — protects the first-start npm-install race on the shared EFS
   *   path. `'pod'`: lock key is suffixed with this pod's hostname — used by
   *   the rehydrate path, where each pod legitimately needs its own instance
   *   (pod-to-pod networking may be blocked) and cross-pod exclusion would
   *   make `ensureRunning` hand back an unreachable cross-pod record.
   */
}
