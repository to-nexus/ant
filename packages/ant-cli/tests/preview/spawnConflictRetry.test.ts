import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import type { ChildProcess } from 'child_process';
import { PreviewService } from '../../src/periphery/adapters/http/services/PreviewService/PreviewService';
import type { PackageInfo } from '../../src/periphery/adapters/http/services/PreviewService/types';

/**
 * Tests the regression that motivated this PR:
 *
 *   When `next dev` exits early with "Another next dev server is already
 *   running", the previous startPreview behaviour reported it as a hard
 *   failure to the user. With `spawnWithConflictRetry` the orchestrator
 *   now detects the port-conflict signature, runs DevProcessControl
 *   cleanup (killTree + Next lock + waitForCleanState), and retries spawn
 *   ONCE. Other failure modes must NOT trigger retry — that would mask
 *   real bugs (compile errors, missing deps, etc.) by burning the user's
 *   time looping on them.
 *
 * We test the private method directly because the lifecycle policy
 * (settling window, retry budget, conflict pattern matching) is the
 * SSOT for this behaviour and shouldn't be reachable only through a
 * full PreviewService.startPreview integration test.
 */

interface FakeChild extends EventEmitter {
  pid?: number;
  killed: boolean;
  exitCode: number | null;
  kill: (signal?: NodeJS.Signals) => boolean;
  stdout: Readable;
  stderr: Readable;
  spawnargs: string[];
}

function makeFakeChild(pid: number): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.pid = pid;
  child.killed = false;
  child.exitCode = null;
  child.stdout = new Readable({ read() { /* noop */ } });
  child.stderr = new Readable({ read() { /* noop */ } });
  child.spawnargs = ['node'];
  child.kill = (_signal?: NodeJS.Signals) => { child.killed = true; return true; };
  return child;
}

function buildPkg(): PackageInfo {
  return {
    name: 'apps/hub',
    path: '/tmp/fake/apps/hub',
    type: 'frontend',
    packageJson: { scripts: { dev: 'next dev' } },
    projectProfile: { language: 'typescript' },
  };
}

interface RetryHarness {
  svc: PreviewService;
  dev: {
    detect: ReturnType<typeof vi.fn>;
    forceCleanup: ReturnType<typeof vi.fn>;
    cleanupStaleLocks: ReturnType<typeof vi.fn>;
    waitForCleanState: ReturnType<typeof vi.fn>;
  };
  spawner: {
    spawn: ReturnType<typeof vi.fn>;
    killAndWait: ReturnType<typeof vi.fn>;
  };
  spawnCalls: number;
  promoteExitCalls: number;
}

/**
 * Build a harness around PreviewService with stubbed processSpawner and
 * DevProcessControl so we control the spawn/exit timeline precisely.
 *
 * `spawnPlan` is a list of "what should happen" per spawn attempt.
 *   { exit: { ms, code, stderr } }  → child fires exit after ms with that stderr/code
 *   { healthy: true }                → child stays alive past settling window
 */
function buildHarness(spawnPlan: Array<{
  exit?: { afterMs: number; code: number | null; stderr?: string };
  healthy?: boolean;
}>): RetryHarness {
  const svc = new PreviewService();
  const dev = {
    detect: vi.fn(async () => [{ source: 'process-tree' as const, pid: 99_999 }]),
    forceCleanup: vi.fn(async () => ({ killed: [99_999], survived: [] })),
    cleanupStaleLocks: vi.fn(async () => undefined),
    waitForCleanState: vi.fn(async () => true),
  };
  const harness: RetryHarness = {
    svc,
    dev,
    spawner: {} as any,
    spawnCalls: 0,
    promoteExitCalls: 0,
  };

  const spawner = {
    spawn: vi.fn((_pkg: PackageInfo, _port: number, options: any) => {
      const idx = harness.spawnCalls++;
      const plan = spawnPlan[idx];
      const child = makeFakeChild(70_000 + idx);

      if (plan?.exit) {
        setTimeout(() => {
          if (plan.exit!.stderr) options.onLog('stderr', plan.exit!.stderr);
          options.onExit(plan.exit!.code, null, child.pid);
        }, plan.exit.afterMs);
      } else if (plan?.healthy) {
        // Stay alive — never call onExit until later (after settling promote).
        // We track "post-settling" exits in promoteExitCalls so tests can
        // confirm the second-attempt child was actually returned.
        setTimeout(() => {
          // No-op — child is "alive". Test will explicitly assert on the
          // returned reference being this child.
        }, 0);
      }

      return child as unknown as ChildProcess;
    }),
    killAndWait: vi.fn(async () => undefined),
  };
  harness.spawner = spawner as any;

  (svc as any).processSpawner = spawner;
  (svc as any).dev = dev;

  return harness;
}

const RUN_OPTS = (harness: RetryHarness) => ({
  serverKey: 'org:user:proj:feature',
  packageUrlKey: 'org-user-proj-feature',
  projectRoot: '/tmp/fake',
  connections: [],
  packageSource: 'apps/hub',
  baseLog: vi.fn(),
  baseExit: vi.fn(() => { harness.promoteExitCalls += 1; }),
  baseError: vi.fn(),
});

describe('PreviewService.spawnWithConflictRetry', () => {
  it('does NOT retry on a generic compile error — surfaces exit + stderr tail to caller', async () => {
    const harness = buildHarness([
      { exit: { afterMs: 30, code: 1, stderr: 'SyntaxError: Unexpected token <\n  at next.config.js:5\n' } },
      // No second plan — if we wrongly retried, spawnPlan[1] would be undefined
      // and the child would never exit, hanging the test until timeout.
    ]);
    const opts = RUN_OPTS(harness);

    const result = await (harness.svc as any).spawnWithConflictRetry(buildPkg(), 3099, opts);

    // Only one spawn attempt — we forwarded the exit to baseExit instead.
    expect(harness.spawnCalls).toBe(1);
    expect(opts.baseExit).toHaveBeenCalledTimes(1);
    expect(opts.baseExit).toHaveBeenCalledWith(1, null, (result as FakeChild).pid);
    expect(harness.dev.detect).not.toHaveBeenCalled();

    // Stderr tail must be surfaced to the log feed so the user sees WHY
    // the package crashed. Without this, the dead frontend produced
    // nothing but an "exited with code N" header — the apps/hub silent
    // crash that motivated this test.
    const stderrCalls = (opts.baseLog as any).mock.calls
      .filter(([type]: [string]) => type === 'stderr')
      .map(([, msg]: [string, string]) => msg)
      .join('\n');
    expect(stderrCalls).toMatch(/crashed within \d+ms of spawn/);
    expect(stderrCalls).toContain('SyntaxError: Unexpected token <');
    expect(stderrCalls).toContain('next.config.js:5');
  });

  it('does NOT retry a SECOND time even if conflict persists (1-shot guarantee)', async () => {
    // Both attempts surface the same conflict — this is the safety guard
    // against burning the user's time on a stuck conflict (e.g. the killed
    // PID re-spawned itself, or a different process is squatting the port).
    const harness = buildHarness([
      { exit: { afterMs: 30, code: 1, stderr: 'Another next dev server is already running' } },
      { exit: { afterMs: 30, code: 1, stderr: 'Another next dev server is already running' } },
    ]);
    const opts = RUN_OPTS(harness);

    const result = await (harness.svc as any).spawnWithConflictRetry(buildPkg(), 3099, opts);

    // Exactly two attempts, no third.
    expect(harness.spawnCalls).toBe(2);
    expect(opts.baseExit).toHaveBeenCalledTimes(1);
    expect(opts.baseExit).toHaveBeenCalledWith(1, null, (result as FakeChild).pid);
    // Second attempt's exit went to baseExit (not absorbed).
  }, 15_000);
});
