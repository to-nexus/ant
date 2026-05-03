import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  DevProcessControl,
  isPortConflictOutput,
} from '../../src/core/process/DevProcessControl';

/**
 * DevProcessControl is the SSOT used by PreviewService start/stop and the
 * Code Job learn cleanup. These tests pin its observable contract:
 *
 *   1. killTree actually kills detached descendants (the real-world bug
 *      that motivated the module — `npm run dev → next dev` shell chains
 *      where the grandchild jumps into its own process group).
 *   2. detect() finds processes by Next dev lock, port, and ps cwd match,
 *      and dedupes by PID.
 *   3. waitForCleanState polls until the file/port disappear (or times out).
 *   4. forceCleanup leaves no survivors.
 *   5. isPortConflictOutput matches Next/Vite/Node port-conflict messages
 *      but rejects unrelated runtime errors (so spawn-retry can't loop on
 *      a genuine compile failure).
 *
 * POSIX-only — Windows lacks pgrep/lsof and uses a separate path.
 */

const isPosix = process.platform !== 'win32';
const skip = !isPosix;

describe('DevProcessControl', () => {
  if (skip) {
    it.skip('windows: skipped — pgrep/lsof unavailable', () => { /* skipped */ });
    return;
  }

  let tmpDir: string;
  let dev: DevProcessControl;
  const orphans: ChildProcess[] = [];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dpc-test-'));
    dev = new DevProcessControl();
  });

  afterEach(() => {
    for (const p of orphans) {
      try { p.kill('SIGKILL'); } catch { /* ignore */ }
    }
    orphans.length = 0;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('killTree', () => {
    it('kills the parent and all descendants (detached process group)', async () => {
      // Parent shell that detaches a grandchild via `setsid` (own process group).
      // We use a node script as the grandchild so it stays alive long enough
      // to verify both PIDs.
      const grandchildScript = `setInterval(() => {}, 60000);`;
      const parent = spawn(
        'sh',
        ['-c', `node -e ${JSON.stringify(grandchildScript)} & echo $! ; wait`],
        { detached: true, stdio: ['ignore', 'pipe', 'ignore'] },
      );
      orphans.push(parent);

      const grandchildPid = await new Promise<number>((resolve, reject) => {
        let buf = '';
        parent.stdout!.on('data', chunk => {
          buf += chunk.toString();
          const line = buf.split('\n')[0];
          const n = parseInt(line.trim(), 10);
          if (!isNaN(n) && n > 0) resolve(n);
        });
        setTimeout(() => reject(new Error('grandchild PID not announced in 3s')), 3_000);
      });

      // Sanity: both alive before kill.
      expect(dev.isAlive(parent.pid!)).toBe(true);
      expect(dev.isAlive(grandchildPid)).toBe(true);

      await dev.killTree(parent, { graceMs: 1_500 });

      // Both must be dead. The descendant test is the one that flagged
      // the original bug — a SIGTERM to just `parent` left the grandchild.
      expect(dev.isAlive(parent.pid!)).toBe(false);
      expect(dev.isAlive(grandchildPid)).toBe(false);
    }, 15_000);

    it('escalates to SIGKILL when SIGTERM is ignored', async () => {
      // Process that traps SIGTERM and refuses to exit.
      const stubborn = spawn(
        'sh',
        ['-c', `trap '' TERM; sleep 30`],
        { detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      orphans.push(stubborn);
      // Give shell a moment to install the trap.
      await new Promise(r => setTimeout(r, 200));
      expect(dev.isAlive(stubborn.pid!)).toBe(true);

      const start = Date.now();
      await dev.killTree(stubborn, { graceMs: 800 });
      const elapsed = Date.now() - start;

      // Killed despite SIGTERM trap.
      expect(dev.isAlive(stubborn.pid!)).toBe(false);
      // And we waited for the grace period before escalating (proves we
      // didn't just bypass straight to SIGKILL — a regression that would
      // hide graceful-shutdown bugs in real dev servers).
      expect(elapsed).toBeGreaterThanOrEqual(800);
    }, 10_000);

    it('is a no-op for an already-dead PID', async () => {
      const p = spawn('node', ['-e', 'process.exit(0)'], { stdio: 'ignore' });
      await new Promise<void>(r => p.once('exit', () => r()));
      // Should not throw.
      await expect(dev.killTree(p.pid!)).resolves.toBeUndefined();
    });
  });

  describe('detect / cleanupStaleLocks (Next dev lock)', () => {
    it('detects a Next dev lock with a live PID', async () => {
      // Long-living node process simulating a leftover next dev.
      const stand = spawn('node', ['-e', 'setInterval(()=>{}, 60000)'], { stdio: 'ignore' });
      orphans.push(stand);

      const lockDir = path.join(tmpDir, '.next', 'dev');
      fs.mkdirSync(lockDir, { recursive: true });
      fs.writeFileSync(
        path.join(lockDir, 'server.json'),
        JSON.stringify({ pid: stand.pid, port: 3099 }),
      );

      const found = await dev.detect({ cwds: [tmpDir], ports: [] });
      const fromLock = found.find(f => f.source === 'next-lock');
      expect(fromLock?.pid).toBe(stand.pid);
      expect(fromLock?.port).toBe(3099);
    });

    it('cleanupStaleLocks removes the lock and kills the live PID', async () => {
      const stand = spawn('node', ['-e', 'setInterval(()=>{}, 60000)'], { stdio: 'ignore' });
      orphans.push(stand);

      const lockDir = path.join(tmpDir, '.next', 'dev');
      fs.mkdirSync(lockDir, { recursive: true });
      const lockPath = path.join(lockDir, 'server.json');
      fs.writeFileSync(lockPath, JSON.stringify({ pid: stand.pid, port: 3099 }));

      await dev.cleanupStaleLocks(tmpDir);

      expect(fs.existsSync(lockPath)).toBe(false);
      expect(dev.isAlive(stand.pid!)).toBe(false);
    }, 10_000);

    it('cleanupStaleLocks ignores missing lock (idempotent)', async () => {
      await expect(dev.cleanupStaleLocks(tmpDir)).resolves.toBeUndefined();
    });

    it('detect skips Next lock whose PID is already dead', async () => {
      const lockDir = path.join(tmpDir, '.next', 'dev');
      fs.mkdirSync(lockDir, { recursive: true });
      // Use a PID we expect to be dead. PID 1 is alive on POSIX, so use a
      // very high improbable number; if it happens to exist on this host
      // the test simply records it (still passing the "no false positive"
      // contract via isAlive gating).
      fs.writeFileSync(path.join(lockDir, 'server.json'), JSON.stringify({ pid: 999_999_999 }));

      const found = await dev.detect({ cwds: [tmpDir], ports: [] });
      expect(found.some(f => f.source === 'next-lock')).toBe(false);
    });
  });

  describe('detect (port)', () => {
    it('detects a process listening on a port', async () => {
      // Listen in a CHILD process — DPC excludes our own PID/PPID from
      // detect results (PGID safety net), so a server owned by the test
      // process itself would be filtered out and the test would tell us
      // nothing about the port-detection path. The child gets its own
      // PID + PGID so it surfaces normally.
      const child = spawn('node', ['-e', `
        const net = require('net');
        const s = net.createServer();
        s.listen(0, '127.0.0.1', () => {
          const addr = s.address();
          process.stdout.write(String(addr.port) + '\\n');
        });
      `], { stdio: ['ignore', 'pipe', 'ignore'] });
      orphans.push(child);

      const port: number = await new Promise((resolve, reject) => {
        let buf = '';
        child.stdout!.on('data', chunk => {
          buf += chunk.toString();
          const line = buf.split('\n')[0].trim();
          const n = parseInt(line, 10);
          if (!isNaN(n) && n > 0) resolve(n);
        });
        setTimeout(() => reject(new Error('child port not announced in 3s')), 3_000);
      });

      const found = await dev.detect({ cwds: [], ports: [port] });
      const portMatch = found.find(f => f.source === 'port' && f.port === port);
      expect(portMatch).toBeDefined();
      expect(portMatch!.pid).toBe(child.pid);
    }, 10_000);
  });

  describe('waitForCleanState', () => {
    it('returns true when the lock file disappears in time', async () => {
      const lockDir = path.join(tmpDir, '.next', 'dev');
      fs.mkdirSync(lockDir, { recursive: true });
      const lockPath = path.join(lockDir, 'server.json');
      fs.writeFileSync(lockPath, JSON.stringify({ pid: 999_999_999 }));

      // Remove lock asynchronously; wait should succeed.
      setTimeout(() => fs.unlinkSync(lockPath), 200);
      const ok = await dev.waitForCleanState({
        cwds: [tmpDir],
        ports: [],
        timeoutMs: 2_000,
        intervalMs: 50,
      });
      expect(ok).toBe(true);
    });

    it('returns false when timeout expires', async () => {
      const lockDir = path.join(tmpDir, '.next', 'dev');
      fs.mkdirSync(lockDir, { recursive: true });
      fs.writeFileSync(path.join(lockDir, 'server.json'), JSON.stringify({ pid: 999_999_999 }));

      const ok = await dev.waitForCleanState({
        cwds: [tmpDir],
        ports: [],
        timeoutMs: 300,
        intervalMs: 50,
      });
      expect(ok).toBe(false);
    });
  });

  describe('forceCleanup', () => {
    it('kills all detected PIDs and reports survivors', async () => {
      const a = spawn('node', ['-e', 'setInterval(()=>{}, 60000)'], { stdio: 'ignore' });
      const b = spawn('node', ['-e', 'setInterval(()=>{}, 60000)'], { stdio: 'ignore' });
      orphans.push(a, b);

      const result = await dev.forceCleanup([
        { source: 'process-tree', pid: a.pid! },
        { source: 'process-tree', pid: b.pid! },
      ]);

      expect(result.killed.sort()).toEqual([a.pid!, b.pid!].sort());
      expect(result.survived).toEqual([]);
      expect(dev.isAlive(a.pid!)).toBe(false);
      expect(dev.isAlive(b.pid!)).toBe(false);
    }, 10_000);

    it('dedupes by PID across multiple detection sources', async () => {
      const stand = spawn('node', ['-e', 'setInterval(()=>{}, 60000)'], { stdio: 'ignore' });
      orphans.push(stand);

      const result = await dev.forceCleanup([
        { source: 'next-lock', pid: stand.pid!, cwd: tmpDir },
        { source: 'process-tree', pid: stand.pid! },
        { source: 'port', pid: stand.pid!, port: 9999 },
      ]);

      expect(result.killed).toEqual([stand.pid!]);
      expect(dev.isAlive(stand.pid!)).toBe(false);
    });
  });
});

describe('isPortConflictOutput', () => {
  it('matches Next.js "Another next dev server is already running"', () => {
    expect(isPortConflictOutput(
      '⨯ Another next dev server is already running.\n- Local: http://localhost:3099',
    )).toBe(true);
  });

  it('matches EADDRINUSE', () => {
    expect(isPortConflictOutput('Error: listen EADDRINUSE: address already in use :::3000')).toBe(true);
  });

  it('matches Vite "Port 5173 is already in use"', () => {
    expect(isPortConflictOutput('Error: Port 5173 is already in use')).toBe(true);
  });

  it('does NOT match unrelated compile errors', () => {
    // This is the critical guard — without it the spawn-retry path would
    // loop on a real bug (e.g. SyntaxError) and burn the user's time.
    expect(isPortConflictOutput('SyntaxError: Unexpected token <')).toBe(false);
    expect(isPortConflictOutput('Module not found: Cannot resolve "react"')).toBe(false);
    expect(isPortConflictOutput('')).toBe(false);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PGID safety — process-group kill is allowed ONLY for owned ChildProcess
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * In-the-wild bug this regression-tests:
 *
 *   `process.kill(-pid, signal)` interprets `pid` as a PGID. We can only
 *   guarantee `pid === pgid` for processes we ourselves spawned with
 *   `detached:true`. For raw PIDs returned by `detect()` (ps aux scan,
 *   `lsof -i :PORT -t`, Next dev lock files), the PGID may belong to an
 *   unrelated process group — including the preview server's own group.
 *
 *   Real incident: DPC.killTree(895) → `kill(-895, SIGKILL)` → 895 was
 *   the preview server's PGID → preview server itself died with SIGKILL,
 *   leaving the UI in a permanent "isPreviewLoading" stuck state.
 *
 * These tests pin the contract that:
 *   1. number-overload (`killTree(rawPid)`) NEVER sends signals to a
 *      negative PID. Only single-PID kills.
 *   2. ChildProcess-overload still uses negative-PID for the spawn-time
 *      group leader (where PID === PGID is guaranteed by Node's spawn).
 *   3. detect() never surfaces our own process.pid (or ppid) — second
 *      defense line so even a future regression in (1) can't accidentally
 *      target the preview server itself.
 */
describe('DevProcessControl — PGID safety', () => {
  if (skip) {
    it.skip('windows: skipped — kill semantics differ', () => { /* skipped */ });
    return;
  }

  function captureSignals(dev: DevProcessControl): Array<{ pid: number; sig: NodeJS.Signals }> {
    const sent: Array<{ pid: number; sig: NodeJS.Signals }> = [];
    vi.spyOn(dev as any, 'sendSignal').mockImplementation(
      ((pid: number, sig: NodeJS.Signals) => { sent.push({ pid, sig }); }) as any,
    );
    return sent;
  }

  it('killTree(rawPid) NEVER targets a negative PID (no group kill on unowned PIDs)', async () => {
    const dev = new DevProcessControl();
    const sent = captureSignals(dev);

    // High improbable PID so we don't accidentally kill anything real if
    // the spy ever breaks. skipDescendants prevents pgrep noise.
    await dev.killTree(999_999_999, { graceMs: 50, skipDescendants: true });

    // The whole point: NO negative-PID signals. If this fails, raw PID
    // group-kill has been reintroduced — the exact regression that took
    // out the preview server in production.
    const negatives = sent.filter(e => e.pid < 0);
    expect(negatives).toEqual([]);
    // We should still have sent at least one positive-PID kill (SIGTERM).
    expect(sent.some(e => e.pid === 999_999_999 && e.sig === 'SIGTERM')).toBe(true);
  });

  it('killTree(ChildProcess) DOES use negative-PID group kill (PID === PGID guaranteed by detached:true)', async () => {
    const dev = new DevProcessControl();
    const sent = captureSignals(dev);

    // Fake ChildProcess — only `pid` and `kill()` are touched.
    const fakeChild = { pid: 888_888_888, kill: () => true } as any;
    await dev.killTree(fakeChild, { graceMs: 50, skipDescendants: true });

    // ChildProcess path keeps -pid for PGID kill (this is the SAFE path
    // because we created the group leader ourselves).
    expect(sent.some(e => e.pid === -888_888_888 && e.sig === 'SIGTERM')).toBe(true);
    // And also the direct PID for the leader itself.
    expect(sent.some(e => e.pid === 888_888_888 && e.sig === 'SIGTERM')).toBe(true);
  });

  it('detect excludes process.pid (preview server itself) from results', async () => {
    const dev = new DevProcessControl();

    // ps aux will list our own node test process under whatever cwd we
    // pass — process.cwd() is guaranteed to match. Without the
    // self-exclusion guard, detect would return our own PID and the
    // forceCleanup chain would target it.
    const found = await dev.detect({ cwds: [process.cwd()], ports: [] });
    expect(found.every(f => f.pid !== process.pid)).toBe(true);
    if (typeof process.ppid === 'number' && process.ppid > 0) {
      expect(found.every(f => f.pid !== process.ppid)).toBe(true);
    }
  });
});
