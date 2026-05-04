/**
 * DevProcessControl — SSOT for dev-server process cleanup.
 *
 * Purpose
 * -------
 * Multiple call sites have to defend against zombie dev servers:
 *   • PreviewService.startPreview pre-flight   — cleanup before spawn
 *   • PreviewService.startPreview retry        — recover from port conflict
 *   • PreviewService.stopPreview               — kill children + clear locks
 *   • PreviewService.forceRestart              — wait until ports/locks clear
 *   • Code Job learn node (run_command leak)   — task-end teardown
 *
 * Without a SSOT, each site reimplements its own variant of process-tree
 * kill, lock cleanup, and port checks. We had exactly that — and at least
 * three of those variants were buggy or missing entirely. This module
 * consolidates them so future runtime additions (Bun, alternate Vite
 * lock formats, etc.) only require changes here.
 *
 * Design rules
 * ------------
 *   1. `detect` (read-only) and `forceCleanup` (write) are SEPARATE so
 *      callers can decide whether to log/confirm before killing.
 *   2. Per-runtime heuristics (Next dev lock, Vite lock) live in private
 *      helpers; callers never branch on framework.
 *   3. `killTree` always tries process-group SIGTERM + descendant SIGTERM,
 *      polls `kill(pid,0)`, then escalates to SIGKILL. Single source of
 *      escalation logic.
 *   4. macOS/Linux only. Windows is a no-op for the helpers that depend
 *      on `pgrep`/`lsof` (callers already gate on platform separately).
 */

import { execFileSync } from 'child_process';
import type { ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../utils/logger';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type DetectionSource = 'next-lock' | 'port' | 'process-tree';

export interface DetectedDevServer {
  source: DetectionSource;
  pid: number;
  /** Set when `source === 'port'` or when reachable via lock file metadata. */
  port?: number;
  /** Working directory hint (lock-file dir for next-lock, ps cwd match for process-tree). */
  cwd?: string;
  /** Best-effort command line snippet for diagnostics. */
  command?: string;
}

export interface DetectOptions {
  /** Working directories to scan for stale lock files and matching ps lines. */
  cwds: string[];
  /** Ports to check for lingering listeners. */
  ports?: number[];
}

export interface KillTreeOptions {
  /** Time to wait for graceful exit before SIGKILL escalation. Default 4000ms. */
  graceMs?: number;
  /** Skip descendant collection — useful when caller has already done it. */
  skipDescendants?: boolean;
}

export interface ForceCleanupResult {
  killed: number[];
  survived: number[];
}

export interface WaitForCleanStateOptions {
  cwds: string[];
  ports: number[];
  /** Total polling budget. Default 5000ms. */
  timeoutMs?: number;
  /** Polling interval. Default 100ms. */
  intervalMs?: number;
}

/** Optional log sink so callers can surface cleanup actions in their own UX. */
export type CleanupLogger = (level: 'info' | 'warn', message: string) => void;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Module
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const LOG = { component: 'DevProcessControl' } as const;

export class DevProcessControl {
  private readonly onLog?: CleanupLogger;

  constructor(opts?: { onLog?: CleanupLogger }) {
    this.onLog = opts?.onLog;
  }

  // ─── kill primitives ────────────────────────────────────────────────

  /**
   * Best-effort process-tree kill.
   *
   * Strategy:
   *   1. Collect descendants via `pgrep -P <pid>` (recursive, depth/visited capped).
   *   2. Send SIGTERM to the root pid AND each descendant pid (single-PID kills).
   *      For an OWNED `ChildProcess` (we spawned it with `detached:true`,
   *      so PID === PGID is guaranteed by Node's spawn contract), we ALSO
   *      send a process-group SIGTERM via `kill(-pid)` to reach the shell
   *      and any grandchild that re-detached into the same group leader.
   *   3. Poll `kill(pid,0)` every 100ms for `graceMs` to wait for graceful exit.
   *   4. SIGKILL anything still alive — same dual-channel rule.
   *
   * IMPORTANT — group-kill safety contract:
   *   `process.kill(-pid, signal)` interprets `pid` as a PGID. We can only
   *   guarantee `pid === pgid` for processes we spawned ourselves with
   *   `detached:true`. For raw PIDs returned by `detect()` (ps aux scan,
   *   port lookup, lock-file PIDs) the PGID may belong to an unrelated
   *   process group — including the preview server's own group. Sending
   *   `kill(-pid)` to such a PID has caused the preview server itself to
   *   be SIGKILLed in the wild (see `restart_freeze_diagnosis` plan §1).
   *   The number-overload path therefore NEVER uses negative-PID kills.
   *
   * Accepts either a `ChildProcess` (use its pid, group kill allowed) or a
   * raw pid number (single-PID kill only). Returns when all targets are
   * confirmed dead OR after escalation completes.
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
   * Collect descendant PIDs via `pgrep -P <pid>` BFS.
   * Caps at depth 6 and 256 visited PIDs to avoid runaway loops on weird
   * process trees (zombies, forking watchers). Returns empty on platforms
   * without `pgrep`.
   */
  collectDescendants(pid: number): number[] {
    const collected: number[] = [];
    const visited = new Set<number>([pid]);
    const queue: Array<{ pid: number; depth: number }> = [{ pid, depth: 0 }];

    while (queue.length > 0) {
      const { pid: current, depth } = queue.shift()!;
      if (depth >= 6) continue;
      if (collected.length + queue.length >= 256) break;

      let children: number[] = [];
      try {
        const out = execFileSync('pgrep', ['-P', String(current)], {
          encoding: 'utf-8',
          timeout: 1500,
          stdio: ['pipe', 'pipe', 'ignore'],
        }).trim();
        if (out) {
          children = out.split('\n')
            .map(s => parseInt(s.trim(), 10))
            .filter(n => !isNaN(n) && !visited.has(n));
        }
      } catch {
        // pgrep absent or no children — both yield empty list.
      }

      for (const child of children) {
        visited.add(child);
        collected.push(child);
        queue.push({ pid: child, depth: depth + 1 });
      }
    }
    return collected;
  }

  // ─── lock cleanup ───────────────────────────────────────────────────

  /**
   * Inspect and clean up stale framework dev lock files under `cwd`.
   * Currently handles:
   *   • Next.js: `.next/dev/server.json` (PID + port reference)
   *
   * If the recorded PID is alive, that process is killed via `killTree`
   * before the lock is removed. If the PID is already dead, the lock is
   * simply unlinked. Idempotent — safe to call when no lock exists.
   */
  async cleanupStaleLocks(cwd: string): Promise<void> {
    await this.cleanupNextDevLock(cwd);
  }

  private async cleanupNextDevLock(cwd: string): Promise<void> {
    const lockPath = path.join(cwd, '.next', 'dev', 'server.json');
    let lockStat: fs.Stats;
    try {
      lockStat = fs.statSync(lockPath);
      if (!lockStat.isFile()) return;
    } catch {
      return; // no lock file
    }

    let lockedPid: number | undefined;
    let lockedPort: number | undefined;
    try {
      const raw = fs.readFileSync(lockPath, 'utf-8');
      const data = JSON.parse(raw);
      if (typeof data?.pid === 'number') lockedPid = data.pid;
      if (typeof data?.port === 'number') lockedPort = data.port;
    } catch {
      // Corrupt lock — still safe to remove
    }

    if (lockedPid != null && this.isAlive(lockedPid)) {
      this.log('warn', `Stale Next dev lock at ${lockPath} → killing PID ${lockedPid}` +
        (lockedPort ? ` (port ${lockedPort})` : ''));
      await this.killTree(lockedPid);
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

  // ─── detection ──────────────────────────────────────────────────────

  /**
   * Detect any lingering dev-server processes for the given working
   * directories and ports. Combines three independent signals:
   *   1. `next-lock`     — `.next/dev/server.json` with a live PID
   *   2. `port`          — listener lookup (lsof/ss/netstat/procfs fallback)
   *   3. `process-tree`  — `ps aux` lines containing one of the cwds
   *                        AND matching a runtime token (node/next/vite/npm/pnpm).
   *
   * Duplicate PIDs across sources are deduped — first source wins for
   * the reported `source` field. Order: next-lock > port > process-tree
   * (most specific first).
   */
  async detect(opts: DetectOptions): Promise<DetectedDevServer[]> {
    const cwds = (opts.cwds || []).filter(Boolean);
    const ports = opts.ports || [];
    // Pre-seed `seen` with our own PID + parent PID so detect can NEVER
    // surface them. If they did surface, the SSOT cleanup chain
    // (forceCleanup → killTree → kill(pid)) would target the preview
    // server itself. Combined with the group-kill safety in killTree, this
    // is the second defense line: even if a future change reintroduces
    // negative-PID kill on raw PIDs, our own PID just isn't in the
    // candidate set anymore. Non-POSIX `process.ppid` may be undefined.
    const seen = new Set<number>([process.pid]);
    if (typeof process.ppid === 'number' && process.ppid > 0) {
      seen.add(process.ppid);
    }
    const out: DetectedDevServer[] = [];

    // 1. Next dev locks
    for (const cwd of cwds) {
      const fromLock = this.readNextLock(cwd);
      if (fromLock && !seen.has(fromLock.pid) && this.isAlive(fromLock.pid)) {
        seen.add(fromLock.pid);
        out.push(fromLock);
      }
    }

    // 2. Port listeners
    for (const port of ports) {
      const pids = this.pidsOnPort(port);
      for (const pid of pids) {
        if (seen.has(pid)) continue;
        seen.add(pid);
        out.push({ source: 'port', pid, port });
      }
    }

    // 3. Process-tree match against any cwd
    if (cwds.length > 0) {
      const orphans = this.findProcessesByCwd(cwds);
      for (const o of orphans) {
        if (seen.has(o.pid)) continue;
        seen.add(o.pid);
        out.push(o);
      }
    }

    return out;
  }

  private readNextLock(cwd: string): DetectedDevServer | undefined {
    const lockPath = path.join(cwd, '.next', 'dev', 'server.json');
    try {
      const raw = fs.readFileSync(lockPath, 'utf-8');
      const data = JSON.parse(raw);
      if (typeof data?.pid === 'number') {
        return {
          source: 'next-lock',
          pid: data.pid,
          port: typeof data.port === 'number' ? data.port : undefined,
          cwd,
          command: 'next dev',
        };
      }
    } catch { /* missing or unparseable */ }
    return undefined;
  }

  private pidsOnPort(port: number): number[] {
    const fromLsof = this.pidsOnPortFromLsof(port);
    if (fromLsof.length > 0) return fromLsof;

    const fromSs = this.pidsOnPortFromSs(port);
    if (fromSs.length > 0) return fromSs;

    const fromNetstat = this.pidsOnPortFromNetstat(port);
    if (fromNetstat.length > 0) return fromNetstat;

    return this.pidsOnPortFromProcfs(port);
  }

  private pidsOnPortFromLsof(port: number): number[] {
    try {
      const out = execFileSync('lsof', ['-i', `:${port}`, '-t'], {
        encoding: 'utf-8',
        timeout: 3000,
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();
      if (!out) return [];
      return this.parsePidLines(out);
    } catch {
      return [];
    }
  }

  private pidsOnPortFromSs(port: number): number[] {
    try {
      const out = execFileSync('ss', ['-ltnp'], {
        encoding: 'utf-8',
        timeout: 3000,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      if (!out) return [];

      const pids = new Set<number>();
      for (const line of out.split('\n')) {
        if (!line.includes(`:${port}`)) continue;
        const matches = line.matchAll(/pid=(\d+)/g);
        for (const match of matches) {
          const pid = parseInt(match[1], 10);
          if (!isNaN(pid)) pids.add(pid);
        }
      }
      return Array.from(pids);
    } catch {
      return [];
    }
  }

  private pidsOnPortFromNetstat(port: number): number[] {
    try {
      const out = execFileSync('netstat', ['-lntp'], {
        encoding: 'utf-8',
        timeout: 3000,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      if (!out) return [];

      const pids = new Set<number>();
      for (const line of out.split('\n')) {
        if (!line.includes(`:${port}`)) continue;
        const m = line.match(/\s(\d+)\/[^\s]+\s*$/);
        if (!m) continue;
        const pid = parseInt(m[1], 10);
        if (!isNaN(pid)) pids.add(pid);
      }
      return Array.from(pids);
    } catch {
      return [];
    }
  }

  private parsePidLines(text: string): number[] {
    return Array.from(
      new Set(
        text
          .split('\n')
          .map(s => parseInt(s.trim(), 10))
          .filter(n => !isNaN(n)),
      ),
    );
  }

  private pidsOnPortFromProcfs(port: number): number[] {
    if (process.platform !== 'linux') return [];

    const socketInodes = this.socketInodesListeningOnPort(port);
    if (socketInodes.size === 0) return [];

    const pids = new Set<number>();
    let procEntries: string[] = [];
    try {
      procEntries = fs.readdirSync('/proc');
    } catch {
      return [];
    }

    for (const entry of procEntries) {
      if (!/^\d+$/.test(entry)) continue;
      const pid = parseInt(entry, 10);
      if (!pid || isNaN(pid)) continue;

      const fdDir = `/proc/${entry}/fd`;
      let fds: string[] = [];
      try {
        fds = fs.readdirSync(fdDir);
      } catch {
        continue;
      }

      let matched = false;
      for (const fd of fds) {
        try {
          const link = fs.readlinkSync(path.join(fdDir, fd));
          const m = link.match(/^socket:\[(\d+)\]$/);
          if (!m) continue;
          if (!socketInodes.has(m[1])) continue;
          pids.add(pid);
          matched = true;
          break;
        } catch {
          // Per-fd permission/race errors are expected under /proc.
        }
      }

      if (matched) continue;
    }

    return Array.from(pids);
  }

  private socketInodesListeningOnPort(port: number): Set<string> {
    const inodes = new Set<string>();
    const targetHexPort = port.toString(16).toUpperCase().padStart(4, '0');
    const parseFile = (procFile: string) => {
      let text = '';
      try {
        text = fs.readFileSync(procFile, 'utf-8');
      } catch {
        return;
      }

      for (const line of text.split('\n').slice(1)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const cols = trimmed.split(/\s+/);
        if (cols.length < 10) continue;

        const localAddr = cols[1] ?? '';
        const state = cols[3] ?? '';
        const inode = cols[9] ?? '';
        const localPortHex = localAddr.split(':')[1]?.toUpperCase();

        // TCP LISTEN state is 0A.
        if (state !== '0A') continue;
        if (localPortHex !== targetHexPort) continue;
        if (!inode) continue;
        inodes.add(inode);
      }
    };

    parseFile('/proc/net/tcp');
    parseFile('/proc/net/tcp6');
    return inodes;
  }

  private findProcessesByCwd(cwds: string[]): DetectedDevServer[] {
    let psOutput = '';
    try {
      psOutput = execFileSync('ps', ['aux'], {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
    } catch {
      return [];
    }

    const runtimePattern = /node|next|vite|npm|pnpm|yarn/;
    const found: DetectedDevServer[] = [];
    for (const line of psOutput.split('\n')) {
      if (!runtimePattern.test(line)) continue;
      const matchedCwd = cwds.find(c => c && line.includes(c));
      if (!matchedCwd) continue;

      const parts = line.trim().split(/\s+/);
      if (parts.length < 11) continue;
      const pid = parseInt(parts[1], 10);
      if (isNaN(pid)) continue;

      found.push({
        source: 'process-tree',
        pid,
        cwd: matchedCwd,
        command: parts.slice(10).join(' ').slice(0, 200),
      });
    }
    return found;
  }

  // ─── cleanup ────────────────────────────────────────────────────────

  /**
   * Kill every detected server (de-duped by PID), then verify each one is
   * actually dead. Returns split list so callers can decide what to do
   * about survivors (rare — usually means a permission issue).
   */
  async forceCleanup(servers: DetectedDevServer[]): Promise<ForceCleanupResult> {
    const uniquePids = Array.from(new Set(servers.map(s => s.pid)));
    if (uniquePids.length === 0) return { killed: [], survived: [] };

    this.log('info', `Cleaning up ${uniquePids.length} stale dev process(es): ` +
      uniquePids.join(', '));

    // Also clean Next dev locks for any cwd we know about — defensive even
    // when the recorded PID was already dead (so we leave a clean slate).
    const cwds = Array.from(new Set(servers.map(s => s.cwd).filter((c): c is string => !!c)));
    for (const cwd of cwds) {
      await this.cleanupStaleLocks(cwd);
    }

    for (const pid of uniquePids) {
      try {
        await this.killTree(pid);
      } catch (err: any) {
        logger.debug(`killTree(${pid}) error: ${err.message}`, LOG);
      }
    }

    const survived: number[] = [];
    const killed: number[] = [];
    for (const pid of uniquePids) {
      if (this.isAlive(pid)) survived.push(pid);
      else killed.push(pid);
    }

    if (survived.length > 0) {
      this.log('warn', `forceCleanup: ${survived.length} process(es) still alive after escalation: ` +
        survived.join(', '));
    }

    return { killed, survived };
  }

  /**
   * Block until all `cwds` have no Next dev lock AND all `ports` are
   * unbound, OR until `timeoutMs` elapses. Returns `true` on clean state,
   * `false` on timeout.
   */
  async waitForCleanState(opts: WaitForCleanStateOptions): Promise<boolean> {
    const timeoutMs = opts.timeoutMs ?? 5000;
    const intervalMs = opts.intervalMs ?? 100;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const lockClean = opts.cwds.every(cwd => this.readNextLock(cwd) === undefined);
      const portClean = opts.ports.every(p => this.pidsOnPort(p).length === 0);
      if (lockClean && portClean) return true;
      await sleep(intervalMs);
    }
    return false;
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
 * a fresh spawn after cleanup is worth trying.
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
