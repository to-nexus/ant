/**
 * Validation-failure surfacing and the one-shot port-conflict spawn retry.
 *
 * One layer of the PreviewService inheritance chain (see PreviewServiceCore —
 * tests construct the service and reach protected members/prototype methods
 * directly, so methods stay on the prototype chain, verbatim).
 */

import { ChildProcess } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import { PortManager } from '../../../../../infrastructure/networking/PortManager';
import { ServiceConnection } from '../../../../../core/ports/portRegistry';
import { PreviewIssue, PreviewIssueReasoning, PackageInfo, ValidationResult } from './types';
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
import { DevProcessControl, isPortConflictOutput } from '../../../../../core/process/DevProcessControl';
import { PreviewStopLayer } from './PreviewStopLayer';
import { extractDiagnosticTail } from './PreviewExitLayer';

export class PreviewSpawnLayer extends PreviewStopLayer {
  protected async handleValidationFailure(
    serverKey: string,
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    processes: ChildProcess[],
    orderedPackages: PackageInfo[],
    entryPath: string,
    validation: ValidationResult
  ) {
    logger.info(`Frontend setup validation failed - stopping server`, { component: 'PreviewService' });

    // Tree-kill (descendants + lock cleanup) every spawned child. Same
    // SSOT as stopPreview / startPreview catch — DPC handles the
    // SIGKILL escalation if anything refuses to exit.
    await Promise.all(
      processes.map(proc =>
        this.processSpawner.killAndWait(proc, { graceMs: 2_000 })
          .catch(() => { /* best-effort */ }),
      ),
    );
    for (const pkg of orderedPackages) {
      await this.dev.cleanupStaleLocks(pkg.path).catch(() => { /* best-effort */ });
    }

    // Stop infrastructure services before clearing paths
    const localPath = this.previewServerPaths.get(serverKey);
    if (localPath) {
      const infraProjectName = `ant-${projectId}-${feature}`.replace(/[^a-zA-Z0-9_-]/g, '-');
      const logCb = (type: 'stdout' | 'stderr', msg: string) => this.appendLog(serverKey, type, msg);
      await this.infrastructureManager.stopInfrastructure(localPath, logCb, infraProjectName);
    }
    
    // Release every allocated package port — must happen BEFORE
    // `previewServers.delete` so the late `handleProcessExit` → `cleanupIfAllDead`
    // chain (which short-circuits on missing process map) cannot be the
    // last hope for port release. Multi-frontend projects leak N ports
    // here without this; single-frontend always leaked exactly 1.
    if (this.portManager) {
      const portsToRelease = new Set<number>();
      for (const pkg of orderedPackages) {
        if (typeof pkg.port === 'number') portsToRelease.add(pkg.port);
      }
      for (const p of portsToRelease) {
        this.portManager.release(p);
      }
    }
    
    // Clean up local state (process handles, paths)
    this.previewServers.delete(serverKey);
    this.previewServerPaths.delete(serverKey);
    this.localPreviews.delete(serverKey);

    // Build issues stack
    const issues: PreviewIssue[] = [];
    issues.push(this.issueDetector.createFatalIssue(
      (validation.reasoning || 'unknown') as PreviewIssueReasoning,
      validation.reason || 'Preview server setup validation failed',
      validation.suggestedFix
    ));
    
    try {
      const hasBackend = orderedPackages.some(p => p.type === 'backend');
      const apiIssue = hasBackend ? await this.issueDetector.detectApiBaseIssue(entryPath) : null;
      if (apiIssue) issues.push(apiIssue);
    } catch {
      // Best-effort only
    }
    
    const combinedSuggestedFix = this.issueDetector.combineIssueFixes(issues);
    
    // Write issues + validation info to Redis, then update phase to error
    if (this.portRegistry) {
      try {
        await this.portRegistry.updatePreview(tenantId, userId, projectId, feature, {
          issues: issues as any,
          setupReasoning: validation.reasoning || 'unknown',
          setupReason: validation.reason,
          suggestedFix: combinedSuggestedFix,
        });
      } catch { /* best-effort */ }
    }
    
    // Update Redis state to error (don't unregister — let UI see the error reason)
    await this.updatePhase(serverKey, 'error', {
      running: false, ready: false,
      error: validation.reason || 'Preview server setup validation failed'
    });
    
    return {
      success: false,
      error: 'Preview server setup validation failed',
      setupReasoning: validation.reasoning || 'unknown',
      setupReason: validation.reason,
      suggestedFix: combinedSuggestedFix,
      serverKey,
      issues,
    };
  }

  /**
   * Spawn a package's dev server, watching for an early port-conflict exit.
   *
   * Why a wrapper instead of a flag on `ProcessSpawner.spawn`?
   * Lifecycle policy (settling window, retry budget, conflict patterns)
   * lives in the orchestrator (PreviewService), not the spawner. The
   * spawner stays purely about "how do I exec this command for this
   * package profile". Multi-call sites that don't want retry just call
   * `processSpawner.spawn` directly.
   *
   * Behaviour:
   *   1. Spawn child via `processSpawner.spawn`.
   *   2. Race the child's first close event against a 6s settling window.
   *   3. If the child survives the window → install caller's lifecycle
   *      handlers (onLog/onExit/onError) and return.
   *   4. If the child exits inside the window AND its accumulated stderr
   *      matches a port-conflict pattern (`isPortConflictOutput`) AND
   *      retry budget remains → clear the Next lock, RELEASE the conflicted
   *      port + ALLOCATE a fresh one, then 1 more spawn attempt.
   *   5. Anything else → forward the captured exit to the caller's
   *      `baseExit` so normal error reporting / cleanupIfAllDead runs.
   *
   * Hard cap: ONE retry per package. After that we fall through with the
   * second child (whose exit will be handled by the normal pipeline).
   * This is intentional — repeated retries on real config errors would
   * mask bugs and burn the user's lock budget.
   */
  protected async spawnWithConflictRetry(
    pkg: PackageInfo,
    port: number,
    opts: {
      serverKey: string;
      packageUrlKey?: string;
      projectRoot: string;
      connections: ServiceConnection[];
      packageSource: string;
      baseLog: (type: 'stdout' | 'stderr', msg: string) => void;
      baseExit: (code: number | null, signal: NodeJS.Signals | null, exitedPid?: number) => void;
      baseError: (error: Error) => void;
    },
  ): Promise<ChildProcess> {
    const SETTLING_MS = 6_000;
    const MAX_ATTEMPTS = 2;  // 1 initial + 1 retry

    // Mutable across attempts: a genuine port conflict reallocates a FRESH
    // port (release + allocate) rather than hunting-and-killing whatever holds
    // the old one. With NX allocation the conflict means a non-ANT process (or
    // a TTL-expired-then-reclaimed race) holds it — killing it would be
    // cross-project-unsafe, so we sidestep to a new port instead.
    let currentPort = port;
    let attempt = 0;
    while (attempt < MAX_ATTEMPTS) {
      attempt += 1;

      // Per-attempt buffer + settling barrier. The wrapper intercepts
      // onLog/onExit until either the settling window elapses or the
      // child closes; once "promoted" we forward to the caller's handlers.
      let stderrBuf = '';
      let promoted = false;
      let earlyExit:
        | { code: number | null; signal: NodeJS.Signals | null; pid?: number }
        | undefined;
      let resolveSettled!: () => void;
      const settledP = new Promise<void>(r => { resolveSettled = r; });

      const child = this.processSpawner.spawn(pkg, currentPort, {
        serverKey: opts.serverKey,
        packageUrlKey: opts.packageUrlKey,
        projectRoot: opts.projectRoot,
        connections: opts.connections,
        packageSource: opts.packageSource,
        onLog: (type, msg) => {
          if (!promoted && type === 'stderr') stderrBuf += msg;
          opts.baseLog(type, msg);
        },
        onExit: (code, signal, exitedPid) => {
          if (promoted) {
            opts.baseExit(code, signal, exitedPid);
            return;
          }
          earlyExit = { code, signal, pid: exitedPid };
          resolveSettled();
        },
        onError: (error) => {
          // Errors during settling window: surface to caller AND end the
          // window so we don't hang. We don't retry on `error` events
          // (those are spawn-time failures like ENOENT, not port conflicts).
          if (!promoted) resolveSettled();
          opts.baseError(error);
        },
      });

      const winner = await Promise.race([
        settledP.then(() => 'exited' as const),
        new Promise<'survived'>(r => setTimeout(() => r('survived'), SETTLING_MS)),
      ]);

      if (winner === 'survived' || !earlyExit) {
        // Healthy enough — promote so subsequent stderr / exit go to caller.
        promoted = true;
        return child;
      }

      // Child died inside settling window. Decide retry.
      const isConflict = isPortConflictOutput(stderrBuf);
      const canRetry = isConflict && attempt < MAX_ATTEMPTS;

      if (!canRetry) {
        // Surface the last few stderr lines so the user can see WHY the
        // package died. Without this, multi-package monorepos silently
        // ran with one frontend dead (handleProcessExit logs only the
        // "exited with code N" header and the actual error scrolls past
        // unseen). The user-visible "Open" button on the dead package
        // would then return ECONNREFUSED with no diagnostic trail —
        // exactly the apps/hub failure the restart_freeze_diagnosis
        // plan §3 traced. We cap to the last ~10 non-empty lines to
        // avoid flooding the log feed with stack traces.
        const tail = extractDiagnosticTail(stderrBuf);
        if (tail.length > 0) {
          opts.baseLog('stderr',
            `❌ ${pkg.name} crashed within ${SETTLING_MS}ms of spawn (code ${earlyExit.code ?? 'null'}). Recent stderr:\n${tail}`);
        }
        // Forward the captured exit to the caller exactly as if we never
        // intercepted it, then return the (already-dead) child for bookkeeping.
        promoted = true;
        opts.baseExit(earlyExit.code, earlyExit.signal, earlyExit.pid);
        return child;
      }

      // Conflict + retry budget available → release this port and reallocate a
      // FRESH one, then retry. We do NOT hunt-and-kill whatever holds the old
      // port: a Redis-NX-allocated port we just received should be unclaimed,
      // so a conflict means an unowned squatter — killing it is cross-project
      // -unsafe. Sidestepping to a new port is both safe and version-agnostic.
      try {
        await this.dev.cleanupStaleLocks(pkg.path);
        if (this.portManager) {
          this.portManager.release(currentPort);
          const fresh = await this.portManager.allocate('dev-server', {
            podId: os.hostname(),
            serverKey: opts.serverKey,
          });
          currentPort = fresh;
          pkg.port = fresh;  // propagate to caller (Redis registration / spawned record)
          opts.baseLog('stdout',
            `↻ Port conflict on ${pkg.name} — reallocated to port ${fresh} and retrying once...`);
        } else {
          opts.baseLog('stdout',
            `↻ Port conflict on ${pkg.name} (port ${currentPort}) — retrying once...`);
        }
      } catch (cleanupErr: any) {
        opts.baseLog('stderr',
          `⚠️  Conflict reallocation encountered an error (continuing retry): ${cleanupErr?.message || cleanupErr}`);
      }
      // Loop continues → next spawn attempt (on the fresh port).
    }

    // Defensive — loop always either returns or continues; we never reach here.
    throw new Error(`spawnWithConflictRetry: exhausted attempts for ${pkg.name}`);
  }

  /**
   * Handle process exit
   * 
   * When a process exits unexpectedly (not via stopPreview), we need to:
   * 1. Log the exit
   * 2. Check if ALL processes for this serverKey are dead
   * 3. If so, clean up all state (maps, Redis, ports)
   */
}
