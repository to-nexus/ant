/**
 * Process-exit handling, early-exit diagnostics and the all-dead cleanup.
 *
 * One layer of the PreviewService inheritance chain (see PreviewServiceCore —
 * tests construct the service and reach protected members/prototype methods
 * directly, so methods stay on the prototype chain, verbatim).
 */

import * as path from 'path';
import * as os from 'os';
import { PortManager } from '../../../../../infrastructure/networking/PortManager';
import { ServiceConnection } from '../../../../../core/ports/portRegistry';
import { parseServerKey } from './utils/serverKeyUtils';
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
import { DevProcessControl } from '../../../../../core/process/DevProcessControl';
import { PreviewQueryLayer } from './PreviewQueryLayer';

export class PreviewExitLayer extends PreviewQueryLayer {
  protected handleProcessExit(
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
  protected async runEarlyExitDiagnostics(serverKey: string): Promise<void> {
    const logs = this.logManager.getLogs(serverKey);
    const recentLogText = logs.slice(-100).map(l => l.message).join('\n');
    
    // Get connections from Redis
    const { tenantId, userId, projectId, feature } = parseServerKey(serverKey);
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
  protected handleProcessError(serverKey: string, pkgName: string, error: Error): void {
    this.appendLog(serverKey, 'stderr', `❌ ${pkgName} error: ${error.message}`);
    
    // Check if all processes are dead — if so, full cleanup
    this.cleanupIfAllDead(serverKey);
  }
  
  /**
   * Check if all processes for a serverKey have exited.
   * If so, clean up all state maps, release ports, unregister from Redis,
   * and broadcast stopped status.
   */
  protected async cleanupIfAllDead(serverKey: string): Promise<void> {
    const processes = this.previewServers.get(serverKey);
    if (!processes) return;
    
    const alive = processes.filter(p => !p.killed && p.exitCode === null);
    
    if (alive.length > 0) {
      // Some processes still running — just broadcast updated status
      const { tenantId, userId, projectId, feature } = parseServerKey(serverKey);
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
      const { tenantId: t, userId: u, projectId: p, feature: f } = parseServerKey(serverKey);

      // Stop infrastructure services before clearing paths
      const localPath = this.previewServerPaths.get(serverKey);
      if (localPath) {
        const infraProjectName = `ant-${p}-${f}`.replace(/[^a-zA-Z0-9_-]/g, '-');
        const logCb = (type: 'stdout' | 'stderr', msg: string) => this.appendLog(serverKey, type, msg);
        await this.infrastructureManager.stopInfrastructure(localPath, logCb, infraProjectName);
      }

      // Release ALL ports this pod spawned — from the pod-local spawn facts,
      // NOT the Redis record: after a rehydrate REPLACE the record carries
      // another pod's ports, and releasing those would corrupt that pod's
      // healthy claims while leaking our own.
      const localFacts = this.localPreviews.get(serverKey);
      // Only touch the shared Redis record when it is OURS — a pod-B crash
      // must not clobber pod-A's healthy record with error/stopped state.
      const redisState = this.portRegistry ? await this.portRegistry.getPreview(t, u, p, f).catch(() => null) : null;
      const recordIsOurs = redisState?.podId === os.hostname();
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
        collect(localFacts);
        if (recordIsOurs) collect(redisState);
        for (const port of portsToRelease) {
          try { this.portManager.release(port); } catch { /* best-effort */ }
        }
      }

      // Clear local state (process handles, paths)
      this.previewServers.delete(serverKey);
      this.previewServerPaths.delete(serverKey);
      this.localPreviews.delete(serverKey);

      if (recordIsOurs) {
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
      } else {
        logger.warn(
          `[Preview] Local processes died for ${serverKey} but the shared record is owned by ${redisState?.podId ?? '(none)'} — cleaned local state only`,
          { component: 'PreviewService' },
        );
      }
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
   *
   * `opts.skipFanout` (default `false`) — when `false`, the stop is broadcast
   * on the `preview-stop` pub/sub channel AFTER local teardown so every OTHER
   * pod reaps its own instance of this preview (under blocked pod-to-pod
   * networking, rehydrates leave one instance per traffic-receiving pod).
   * Set `true` for LOCAL-failure or local-only paths where other pods'
   * instances must survive: `stopPreviewIfOwned` (re-broadcast loop guard),
   * health-check failure, orphan reap, and process shutdown `cleanup()`.
   */
}

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
export function extractDiagnosticTail(stderrBuf: string): string {
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
