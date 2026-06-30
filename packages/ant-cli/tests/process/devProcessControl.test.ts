import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  DevProcessControl,
  isPortConflictOutput,
  type OwnedProcessRecord,
} from '../../src/core/process/DevProcessControl';

/**
 * DevProcessControl is the SSOT used by PreviewService start/stop/reconcile
 * and the Code Job learn cleanup. Cleanup acts ONLY on process identities ANT
 * provably spawned — a live `ChildProcess` handle (`killTree`) or a persisted
 * `(pid, pgid, podId)` record scoped to this pod (`killOwned`). There is NO OS
 * process-table / port scan anymore. These tests pin that contract:
 *
 *   1. killTree actually kills detached descendants (the bug that motivated
 *      the module — `npm run dev → next dev` shell chains where the grandchild
 *      jumps into its own process group).
 *   2. killOwned reaps an owned group by persisted pgid, acts ONLY on this
 *      pod's records, and only ever sends group (negative-PID) signals.
 *   3. cleanupStaleLocks removes Next dev locks (filesystem hygiene).
 *   4. isPortConflictOutput matches Next/Vite/Node port-conflict messages
 *      but rejects unrelated runtime errors.
 *
 * POSIX-only — Windows lacks pgrep and uses a separate kill path.
 */

const isPosix = process.platform !== 'win32';
const skip = !isPosix;

describe('DevProcessControl', () => {
  if (skip) {
    it.skip('windows: skipped — pgrep unavailable', () => { /* skipped */ });
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

      expect(dev.isAlive(parent.pid!)).toBe(true);
      expect(dev.isAlive(grandchildPid)).toBe(true);

      await dev.killTree(parent, { graceMs: 1_500 });

      expect(dev.isAlive(parent.pid!)).toBe(false);
      expect(dev.isAlive(grandchildPid)).toBe(false);
    }, 15_000);

    it('escalates to SIGKILL when SIGTERM is ignored', async () => {
      const stubborn = spawn(
        'sh',
        ['-c', `trap '' TERM; sleep 30`],
        { detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      orphans.push(stubborn);
      await new Promise(r => setTimeout(r, 200));
      expect(dev.isAlive(stubborn.pid!)).toBe(true);

      const start = Date.now();
      await dev.killTree(stubborn, { graceMs: 800 });
      const elapsed = Date.now() - start;

      expect(dev.isAlive(stubborn.pid!)).toBe(false);
      expect(elapsed).toBeGreaterThanOrEqual(800);
    }, 10_000);

    it('is a no-op for an already-dead PID', async () => {
      const p = spawn('node', ['-e', 'process.exit(0)'], { stdio: 'ignore' });
      await new Promise<void>(r => p.once('exit', () => r()));
      await expect(dev.killTree(p.pid!)).resolves.toBeUndefined();
    });
  });

  describe('killOwned', () => {
    it('reaps an owned detached group by persisted pgid (this pod)', async () => {
      // Detached parent → its own process group; the backgrounded node child
      // shares that group. A `kill(-pgid)` must reach both.
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
          const n = parseInt(buf.split('\n')[0].trim(), 10);
          if (!isNaN(n) && n > 0) resolve(n);
        });
        setTimeout(() => reject(new Error('grandchild PID not announced in 3s')), 3_000);
      });

      // pgid === pid for a detached leader (Node spawn contract).
      const record: OwnedProcessRecord = { pid: parent.pid!, pgid: parent.pid!, podId: os.hostname() };
      const result = await dev.killOwned([record], { graceMs: 1_500 });

      expect(result.killed).toContain(parent.pid!);
      expect(result.survived).toEqual([]);
      expect(dev.isAlive(parent.pid!)).toBe(false);
      expect(dev.isAlive(grandchildPid)).toBe(false);
    }, 15_000);

    it('NEVER signals a record owned by another pod', async () => {
      const stand = spawn('node', ['-e', 'setInterval(()=>{}, 60000)'], { stdio: 'ignore' });
      orphans.push(stand);

      const sent: number[] = [];
      vi.spyOn(dev as any, 'sendSignal').mockImplementation(((pid: number) => { sent.push(pid); }) as any);

      const result = await dev.killOwned(
        [{ pid: stand.pid!, pgid: stand.pid!, podId: 'some-other-pod-hostname' }],
        { graceMs: 50 },
      );

      // No signals at all — the other pod owns and reaps it.
      expect(sent).toEqual([]);
      expect(result).toEqual({ killed: [], survived: [] });
      expect(dev.isAlive(stand.pid!)).toBe(true);
    });

    it('only ever sends group (negative-PID) signals — never a bare PID', async () => {
      const sent: Array<{ pid: number; sig: NodeJS.Signals }> = [];
      vi.spyOn(dev as any, 'sendSignal').mockImplementation(
        ((pid: number, sig: NodeJS.Signals) => { sent.push({ pid, sig }); }) as any,
      );

      // Improbable pid so nothing real is touched even if the spy breaks.
      await dev.killOwned(
        [{ pid: 999_999_999, pgid: 999_999_999, podId: os.hostname() }],
        { graceMs: 50 },
      );

      expect(sent.length).toBeGreaterThan(0);
      expect(sent.every(e => e.pid < 0)).toBe(true);
      expect(sent.some(e => e.pid === -999_999_999 && e.sig === 'SIGTERM')).toBe(true);
    });

    it('is a no-op for an empty record set', async () => {
      const result = await dev.killOwned([], { graceMs: 50 });
      expect(result).toEqual({ killed: [], survived: [] });
    });
  });

  describe('cleanupStaleLocks (Next dev lock)', () => {
    it('removes the lock and kills the live PID (legacy server.json)', async () => {
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

    it('ignores a missing lock (idempotent)', async () => {
      await expect(dev.cleanupStaleLocks(tmpDir)).resolves.toBeUndefined();
    });

    it('removes the Next 16 `.next/dev/lock` and kills its PID', async () => {
      const stand = spawn('node', ['-e', 'setInterval(()=>{}, 60000)'], { stdio: 'ignore' });
      orphans.push(stand);

      const lockDir = path.join(tmpDir, '.next', 'dev');
      fs.mkdirSync(lockDir, { recursive: true });
      const lockPath = path.join(lockDir, 'lock');
      fs.writeFileSync(lockPath, JSON.stringify({ pid: stand.pid, port: 30000 }));

      await dev.cleanupStaleLocks(tmpDir);

      expect(fs.existsSync(lockPath)).toBe(false);
      expect(dev.isAlive(stand.pid!)).toBe(false);
    }, 10_000);
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
    expect(isPortConflictOutput('SyntaxError: Unexpected token <')).toBe(false);
    expect(isPortConflictOutput('Module not found: Cannot resolve "react"')).toBe(false);
    expect(isPortConflictOutput('')).toBe(false);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PGID safety — process-group kill is allowed ONLY for owned identities
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * `process.kill(-pid, signal)` interprets `pid` as a PGID. We only guarantee
 * `pid === pgid` for processes WE spawned with `detached:true`. These tests
 * pin that:
 *   1. killTree(rawPid) NEVER sends a negative-PID signal (a raw pid's PGID
 *      may belong to an unrelated group — the regression that once SIGKILLed
 *      the preview server itself).
 *   2. killTree(ChildProcess) DOES use negative-PID for the group leader we
 *      created (PID === PGID guaranteed by detached:true).
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

    await dev.killTree(999_999_999, { graceMs: 50, skipDescendants: true });

    const negatives = sent.filter(e => e.pid < 0);
    expect(negatives).toEqual([]);
    expect(sent.some(e => e.pid === 999_999_999 && e.sig === 'SIGTERM')).toBe(true);
  });

  it('killTree(ChildProcess) DOES use negative-PID group kill (PID === PGID guaranteed by detached:true)', async () => {
    const dev = new DevProcessControl();
    const sent = captureSignals(dev);

    const fakeChild = { pid: 888_888_888, kill: () => true } as any;
    await dev.killTree(fakeChild, { graceMs: 50, skipDescendants: true });

    expect(sent.some(e => e.pid === -888_888_888 && e.sig === 'SIGTERM')).toBe(true);
    expect(sent.some(e => e.pid === 888_888_888 && e.sig === 'SIGTERM')).toBe(true);
  });
});
