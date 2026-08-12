/**
 * DevProcessControl — SSOT for dev-server process cleanup.
 *
 * Purpose
 * -------
 * Multiple call sites have to tear down dev servers:
 *   • PreviewService.startPreview / stopPreview / reconciler  — owned-identity reap
 *   • PreviewService spawn-conflict retry                     — Next-lock cleanup
 *   • Code Job learn node / runCommand (run_command leak)     — task-end teardown
 *
 * Cleanup acts ONLY on process identities ANT provably spawned — either a
 * live `ChildProcess` handle (`killTree`) or a persisted `(pid, pgid, podId)`
 * record scoped to this pod (`killOwned`). There is NO OS process-table /
 * port scan: a bare port number is only pod-local, so treating it as a global
 * process identity is exactly what let cross-pod cleanup kill the wrong
 * project. `process.kill` is the only OS interaction and is identical on
 * Mac/Linux/Windows.
 *
 * Design rules
 * ------------
 *   1. `killTree` (live handle) and `killOwned` (persisted records) are the
 *      only kill entry points. Both target groups we created ourselves.
 *   2. Per-runtime lock heuristics (Next dev lock) live in private helpers;
 *      callers never branch on framework.
 *   3. Escalation is a single source of truth: group SIGTERM → poll → SIGKILL.
 */

import { execFileSync } from 'child_process';
import type { ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { logger } from '../../utils/logger';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface KillTreeOptions {
  /** Time to wait for graceful exit before SIGKILL escalation. Default 4000ms. */
  graceMs?: number;
  /** Skip descendant collection — useful when caller has already done it. */
  skipDescendants?: boolean;
}

/**
 * A process this pod provably spawned, identified by persisted leader pid +
 * group id. `pgid === pid` by the `detached:true` spawn contract.
 */
export interface OwnedProcessRecord {
  pid: number;
  /** Process-group id. Defaults to `pid` when absent (stale record). */
  pgid?: number;
  /** Hostname of the pod that spawned it. `killOwned` acts only when this === os.hostname(). */
  podId: string;
}

export interface KillOwnedOptions {
  /** Time to wait for graceful exit before SIGKILL escalation. Default 4000ms. */
  graceMs?: number;
}

export interface ForceCleanupResult {
  killed: number[];
  survived: number[];
}

/** Optional log sink so callers can surface cleanup actions in their own UX. */
export type CleanupLogger = (level: 'info' | 'warn', message: string) => void;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Module
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const LOG = { component: 'DevProcessControl' } as const;

/**
 * Next dev-lock file candidates, relative to a package cwd, newest format first.
 * Next 16 writes `.next/dev/lock` (JSON: { pid, port, hostname, appUrl, ... });
 * older internal builds used `.next/dev/server.json`. The lock is a DEFENSIVE
 * filesystem-hygiene channel only — process reaping authority is the owned
 * identity (`killOwned` / `killTree`) — so we tolerate either filename rather
 * than tracking Next's internal format precisely.
 */
const NEXT_DEV_LOCK_RELPATHS = [
  ['.next', 'dev', 'lock'],
  ['.next', 'dev', 'server.json'],
] as const;

export class DevProcessControl {
  private readonly onLog?: CleanupLogger;

  constructor(opts?: { onLog?: CleanupLogger }) {
    this.onLog = opts?.onLog;
  }

  // ─── kill primitives ────────────────────────────────────────────────

  /**
   * Best-effort process-tree kill of a LIVE `ChildProcess` handle (or a raw
   * pid we own, e.g. a learn-node server we spawned ourselves).
   *
   * Strategy:
   *   1. Collect descendants via `pgrep -P <pid>` / procfs BFS.
   *   2. SIGTERM the root pid AND each descendant. For an OWNED `ChildProcess`
   *      (spawned `detached:true`, so PID === PGID by Node's contract) ALSO
   *      send a process-group SIGTERM via `kill(-pid)` to reach the shell and
   *      any grandchild that re-detached into the same group leader.
   *   3. Poll `kill(pid,0)` for `graceMs`.
   *   4. SIGKILL anything still alive — same dual-channel rule.
   *
   * IMPORTANT — group-kill safety contract:
   *   `process.kill(-pid, signal)` interprets `pid` as a PGID. We only ever
   *   guarantee `pid === pgid` for processes WE spawned with `detached:true`.
   *   The number-overload path therefore NEVER uses negative-PID kills (a raw
   *   pid's PGID may belong to an unrelated group — including the preview
   *   server's own — which once SIGKILLed the preview server itself).
   */
  async killTree(target: ChildProcess | number, opts: KillTreeOptions = {}): Promise<void> {
    const isOwnedChild = typeof target !== 'number';
    const pid = isOwnedChild ? (target as ChildProcess).pid : (target as number);
    if (pid == null || pid <= 0) return;

    const graceMs = opts.graceMs ?? 4000;
    const descendants = opts.skipDescendants ? [] : this.collectDescendants(pid);
    const allPids = [pid, ...descendants];

    // Phase 1: SIGTERM. Root + descendants always single-PID. Process-group
    // kill is only added for OWNED children where PGID safety is guaranteed.
    this.sendSignal(pid, 'SIGTERM');
    for (const d of descendants) {
      this.sendSignal(d, 'SIGTERM');
    }
    if (isOwnedChild) {
      this.sendSignal(-pid, 'SIGTERM');
      try { (target as ChildProcess).kill('SIGTERM'); } catch { /* ignore */ }
    }

    // Phase 2: poll for graceful exit
    const exited = await this.waitForExit(allPids, graceMs);
    const survivors = allPids.filter(p => !exited.has(p));

    if (survivors.length === 0) return;

    // Phase 3: SIGKILL — same dual-channel rule.
    for (const s of survivors) {
      this.sendSignal(s, 'SIGKILL');
    }
    if (isOwnedChild) {
      this.sendSignal(-pid, 'SIGKILL');
      try { (target as ChildProcess).kill('SIGKILL'); } catch { /* ignore */ }
    }

    // Best-effort second wait so callers can rely on dead-state on return.
    await this.waitForExit(survivors, 1000);
  }

  /**
   * Kill processes identified by PERSISTED owned-identity records — the
   * cross-pod-safe teardown used when the live `ChildProcess` handles are
   * gone (a different pod handles the stop, or this pod's Node process
   * restarted while the detached group survived).
   *
   * Acts ONLY on records whose `podId === os.hostname()`. Other-pod records
   * are skipped (the owning pod reaps via its local handles; see the
   * `ant:lifecycle:cleanup:request` broadcast). For each owned record it sends
   * `kill(-pgid, SIGTERM)` UNCONDITIONALLY (treating `ESRCH` as already-clean),
   * polls the leader pid, then escalates to `SIGKILL`. The group is signalled
   * even when the leader pid reports `ESRCH`, because after a Node restart the
   * leader shell may have exited while the re-parented dev server still holds
   * the port within the same group. Because `kill(-pgid)` only ever targets a
   * group WE created and recorded under this serverKey, it can never reach
   * another project's process.
   */
  async killOwned(records: OwnedProcessRecord[], opts: KillOwnedOptions = {}): Promise<ForceCleanupResult> {
    const host = os.hostname();
    const mine = records.filter(r => r.podId === host && typeof r.pid === 'number' && r.pid > 0);
    if (mine.length === 0) return { killed: [], survived: [] };

    const graceMs = opts.graceMs ?? 4000;
    const groupOf = (r: OwnedProcessRecord) => (r.pgid && r.pgid > 0 ? r.pgid : r.pid);

    this.log('info', `Reaping ${mine.length} owned process group(s): ` +
      mine.map(r => groupOf(r)).join(', '));

    // Phase 1: group SIGTERM (persisted pgid).
    for (const r of mine) {
      this.sendSignal(-groupOf(r), 'SIGTERM');
    }

    // Phase 2: poll the leader pids for exit.
    const pids = mine.map(r => r.pid);
    const exited = await this.waitForExit(pids, graceMs);
    const survivors = mine.filter(r => !exited.has(r.pid));

    // Phase 3: group SIGKILL escalation.
    if (survivors.length > 0) {
      for (const r of survivors) {
        this.sendSignal(-groupOf(r), 'SIGKILL');
      }
      await this.waitForExit(survivors.map(r => r.pid), 1000);
    }

    const killed: number[] = [];
    const survived: number[] = [];
    for (const r of mine) {
      if (this.isAlive(r.pid)) survived.push(r.pid);
      else killed.push(r.pid);
    }
    if (survived.length > 0) {
      this.log('warn', `killOwned: ${survived.length} process(es) still alive after escalation: ` +
        survived.join(', '));
    }
    return { killed, survived };
  }

  /**
   * Collect descendant PIDs via `pgrep -P <pid>` BFS.
   * Caps at depth 6 and 256 visited PIDs to avoid runaway loops on weird
   * process trees (zombies, forking watchers). Returns empty on platforms
   * without `pgrep`.
   */
  collectDescendants(pid: number): number[] {
    const collected: number[] = [];
    const visited = new Set<number>([pid]);
    const queue: Array<{ pid: number; depth: number }> = [{ pid, depth: 0 }];

    // On Linux, derive the child map from /proc PPIDs — no `pgrep` dependency
    // (containers frequently lack it). Elsewhere, fall back to `pgrep -P`.
    const procfsMap = process.platform === 'linux' ? this.buildProcfsChildrenMap() : null;

    while (queue.length > 0) {
      const { pid: current, depth } = queue.shift()!;
      if (depth >= 6) continue;
      if (collected.length + queue.length >= 256) break;

      const children = (procfsMap ? procfsMap.get(current) ?? [] : this.childrenViaPgrep(current))
        .filter(n => !visited.has(n));

      for (const child of children) {
        visited.add(child);
        collected.push(child);
        queue.push({ pid: child, depth: depth + 1 });
      }
    }
    return collected;
  }

  private childrenViaPgrep(pid: number): number[] {
    try {
      const out = execFileSync('pgrep', ['-P', String(pid)], {
        encoding: 'utf-8',
        timeout: 1500,
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();
      if (!out) return [];
      return out.split('\n').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    } catch {
      return []; // pgrep absent or no children
    }
  }

  /** Build a PPID→children[] map from `/proc/<pid>/stat` (Linux only). */
  private buildProcfsChildrenMap(): Map<number, number[]> {
    const map = new Map<number, number[]>();
    let entries: string[] = [];
    try {
      entries = fs.readdirSync('/proc');
    } catch {
      return map;
    }
    for (const entry of entries) {
      if (!/^\d+$/.test(entry)) continue;
      const pid = parseInt(entry, 10);
      if (!pid || isNaN(pid)) continue;
      let ppid: number | undefined;
      try {
        // stat format: "pid (comm) state ppid ..." — comm may contain spaces/
        // parens, so parse the fields AFTER the last ')'.
        const stat = fs.readFileSync(`/proc/${entry}/stat`, 'utf-8');
        const after = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/);
        ppid = parseInt(after[1], 10); // [0]=state, [1]=ppid
      } catch {
        continue;
      }
      if (ppid == null || isNaN(ppid)) continue;
      const arr = map.get(ppid);
      if (arr) arr.push(pid);
      else map.set(ppid, [pid]);
    }
    return map;
  }

  // ─── lock cleanup ───────────────────────────────────────────────────

  /**
   * Inspect and clean up stale framework dev lock files under `cwd`.
   * Currently handles:
   *   • Next.js: `.next/dev/lock` (Next 16) / `.next/dev/server.json` (older)
   *
   * The lock file is removed; the PID recorded inside it is NOT signalled.
   * That file lives in the user's workspace and is user-writable, so its PID
   * is a hygiene hint, not an authority to kill — termination authority is the
   * persisted `(pid, pgid, podId)` record consumed by `killOwned()`, which
   * every caller here already runs first. Idempotent — safe to call when no
   * lock exists.
   */
  async cleanupStaleLocks(cwd: string): Promise<void> {
    await this.cleanupNextDevLock(cwd);
  }

  private async cleanupNextDevLock(cwd: string): Promise<void> {
    for (const rel of NEXT_DEV_LOCK_RELPATHS) {
      const lockPath = path.join(cwd, ...rel);
      try {
        if (!fs.statSync(lockPath).isFile()) continue;
      } catch {
        continue; // this candidate absent
      }

      const parsed = this.parseLockPids(lockPath);
      if (parsed.pid != null && this.isAlive(parsed.pid)) {
        // Reported, never signalled — see the method doc: the PID comes from a
        // user-writable file, so it identifies nothing we own.
        this.log('warn', `Stale Next dev lock at ${lockPath} names live PID ${parsed.pid}` +
          (parsed.port ? ` (port ${parsed.port})` : '') +
          ' — removing the lock only; owned processes are stopped via killOwned()');
      }

      try {
        fs.unlinkSync(lockPath);
        logger.debug(`Removed stale Next dev lock: ${lockPath}`, LOG);
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          logger.debug(`Failed to remove ${lockPath}: ${err.message}`, LOG);
        }
      }
    }
  }

  /** Extract pid/port from a Next dev lock file (JSON). Tolerant of corruption. */
  private parseLockPids(lockPath: string): { pid?: number; port?: number } {
    try {
      const data = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
      return {
        pid: typeof data?.pid === 'number' ? data.pid : undefined,
        port: typeof data?.port === 'number' ? data.port : undefined,
      };
    } catch {
      return {}; // missing or corrupt — caller still removes the file
    }
  }

  // ─── helpers ────────────────────────────────────────────────────────

  /** True if a PID is currently alive (kill 0 doesn't actually signal). */
  isAlive(pid: number): boolean {
    if (pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (err: any) {
      return err.code !== 'ESRCH';
    }
  }

  private sendSignal(targetPid: number, signal: NodeJS.Signals): void {
    try {
      process.kill(targetPid, signal);
    } catch (err: any) {
      // ESRCH = already dead (success), EPERM = no permission (log and move on)
      if (err.code !== 'ESRCH') {
        logger.debug(`signal ${signal} → ${targetPid} failed: ${err.message}`, LOG);
      }
    }
  }

  private async waitForExit(pids: number[], timeoutMs: number): Promise<Set<number>> {
    const exited = new Set<number>();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const pid of pids) {
        if (!exited.has(pid) && !this.isAlive(pid)) exited.add(pid);
      }
      if (exited.size === pids.length) return exited;
      await sleep(100);
    }
    return exited;
  }

  private log(level: 'info' | 'warn', message: string): void {
    if (level === 'info') logger.info(message, LOG);
    else logger.warn(message, LOG);
    this.onLog?.(level, message);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Conflict detection — used by spawn retry path.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Recognise dev-server "port already in use / another instance" errors
 * across runtimes. Used by PreviewService spawn-retry to decide whether
 * a fresh spawn on a freshly-allocated port is worth trying.
 *
 * Patterns are intentionally narrow — generic compile errors must not
 * trigger retry, otherwise we mask bugs by re-running them.
 */
const CONFLICT_PATTERNS: RegExp[] = [
  /Another\s+next\s+dev\s+server\s+is\s+already\s+running/i,  // Next.js 14+
  /EADDRINUSE/,                                                // Node net layer
  /Port\s+\d+\s+is\s+already\s+in\s+use/i,                    // Vite/Webpack
  /listen\s+EADDRINUSE/i,                                      // Node detail
  /address\s+already\s+in\s+use/i,                            // generic
];

export function isPortConflictOutput(text: string): boolean {
  if (!text) return false;
  return CONFLICT_PATTERNS.some(p => p.test(text));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Singleton (most callers want the same instance)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

let defaultInstance: DevProcessControl | undefined;

export function getDefaultDevProcessControl(): DevProcessControl {
  if (!defaultInstance) defaultInstance = new DevProcessControl();
  return defaultInstance;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
