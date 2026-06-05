import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

import * as readiness from '../../src/infrastructure/ide/readiness';
import { handleLongRunningCommand } from '../../src/agents/common/tool/handlers/runCommand';
import { createNoopChatStatusReporter } from '../../src/agents/common/tool/chatStatusAdapter';
import type { ToolExecutionContext } from '../../src/agents/common/tool/types';

// Mock child_process.spawn so the wrapper drives a controllable EventEmitter
// instead of a real process. The same emitter is returned to the caller, so
// tests can push 'data' / 'exit' events to simulate any scenario.
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

class MockChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  pid = 12345;
  exitCode: number | null = null;
  killed = false;
  kill(_signal?: string): boolean {
    this.killed = true;
    return true;
  }
}

function makeCtx(): ToolExecutionContext {
  return {
    fileSystem: {} as any,
    chatStatus: createNoopChatStatusReporter(),
    workingDir: '/tmp',
  };
}

async function freshSpawnMock(child: MockChild) {
  const mod = await import('node:child_process');
  (mod.spawn as unknown as ReturnType<typeof vi.fn>).mockReset();
  (mod.spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(child);
  const mod2 = await import('child_process');
  (mod2.spawn as unknown as ReturnType<typeof vi.fn>).mockReset();
  (mod2.spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(child);
}

/**
 * The wrapper does `await import('child_process')` before attaching event
 * listeners. Poll until the spawn mock is invoked AND the child has its
 * 'data' / 'exit' listeners attached, so the test can drive events safely.
 */
async function flushSpawn(child: MockChild) {
  const mod = await import('child_process');
  const spawnFn = mod.spawn as unknown as ReturnType<typeof vi.fn>;
  for (let i = 0; i < 50; i++) {
    if (spawnFn.mock.calls.length > 0 && child.stdout.listenerCount('data') > 0) return;
    await Promise.resolve();
  }
  throw new Error('flushSpawn: spawn was not invoked or listeners not attached after 50 ticks');
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('handleLongRunningCommand fact report', () => {
  it('healthy server: probe 200 + still-running child → success, fact report has http_probe: 200 and no editorial prefix', async () => {
    const child = new MockChild();
    await freshSpawnMock(child);

    const probeSpy = vi.spyOn(readiness, 'probeHttp').mockResolvedValue({ ok: true, status: 200 });

    const ctx = makeCtx();
    const promise = handleLongRunningCommand(ctx, 'pnpm dev', '/tmp', undefined, false);
    // Flush the dynamic `await import('child_process')` so the listeners attach
    // before we drive events through them.
    await flushSpawn(child);

    // Simulate a Next.js startup line so the port match resolves to 30000.
    child.stdout.emit('data', Buffer.from('▲ Next.js\n- Local: http://localhost:30000\n✓ Ready in 1019ms\n'));

    // Advance through STARTUP_VERIFICATION_TIMEOUT (5_000ms) so the wrapper
    // enters the probe branch and ultimately finalizes.
    await vi.advanceTimersByTimeAsync(5_000);
    // probeHttp is async; let microtasks settle.
    await vi.runAllTimersAsync();

    const r = await promise;

    expect(probeSpy).toHaveBeenCalledWith('localhost', 30000, '/', expect.any(Number));
    expect(r.success).toBe(true);
    expect(r.httpProbe).toEqual({ ok: true, status: 200 });
    expect(r.exitCode).toBe(null);
    expect(r.output).toContain('command: pnpm dev');
    expect(r.output).toContain('http_probe: 200');
    expect(r.output).toMatch(/exit: (killed-after-verification|null)/);
    expect(r.output).toContain('Local: http://localhost:30000');
    // No editorial verdict prefix.
    expect(r.output).not.toMatch(/^✅/);
    expect(r.output).not.toContain('SERVER STARTED SUCCESSFULLY');
    expect(r.output).not.toContain('Server started successfully.');
  });

  it('compile-error server: probe returns 500 → success=false, fact report shows http_probe: failed, embedded ⨯ line preserved verbatim', async () => {
    const child = new MockChild();
    await freshSpawnMock(child);

    vi.spyOn(readiness, 'probeHttp').mockResolvedValue({
      ok: false,
      status: 500,
      error: 'HTTP 500',
    });

    const ctx = makeCtx();
    const promise = handleLongRunningCommand(ctx, 'pnpm dev', '/tmp', undefined, false);

    await flushSpawn(child);
    child.stdout.emit('data', Buffer.from('- Local: http://localhost:30000\n✓ Ready in 1019ms\n'));
    child.stdout.emit('data', Buffer.from('⨯ The file "./src/proxy.ts" must export a function\n'));

    await vi.advanceTimersByTimeAsync(5_000);
    await vi.runAllTimersAsync();

    const r = await promise;

    expect(r.success).toBe(false);
    expect(r.httpProbe).toEqual({ ok: false, status: 500, error: 'HTTP 500' });
    expect(r.output).toContain('http_probe: failed: HTTP 500');
    // Framework error glyph preserved verbatim — the LLM reads this directly.
    expect(r.output).toContain('⨯ The file "./src/proxy.ts" must export a function');
    expect(r.output).not.toContain('SERVER STARTED BUT PAGE RENDER FAILED');
  });

  it('crashed-on-startup: child exits with code 1 before probe → success=false, exit: 1 in fact report, no probe attempted', async () => {
    const child = new MockChild();
    await freshSpawnMock(child);

    const probeSpy = vi.spyOn(readiness, 'probeHttp').mockResolvedValue({ ok: true, status: 200 });

    const ctx = makeCtx();
    const promise = handleLongRunningCommand(ctx, 'pnpm dev', '/tmp', undefined, false);

    await flushSpawn(child);
    child.stdout.emit('data', Buffer.from('Starting up...\n'));
    child.stderr.emit('data', Buffer.from('Error: Port 30001 already in use\n'));
    // Exit BEFORE the startup timeout fires.
    child.exitCode = 1;
    await vi.advanceTimersByTimeAsync(100);
    child.emit('exit', 1, null);

    await vi.runAllTimersAsync();

    const r = await promise;

    expect(probeSpy).not.toHaveBeenCalled();
    expect(r.success).toBe(false);
    expect(r.exitCode).toBe(1);
    expect(r.httpProbe).toBeUndefined();
    expect(r.output).toContain('exit: 1');
    expect(r.output).toContain('http_probe: skipped');
    expect(r.output).toContain('Error: Port 30001 already in use');
  });

  it('keep_running server left alive: label is still-running (not killed-after-verification) + server_pid/server_url surfaced + serverPort returned', async () => {
    const child = new MockChild();
    await freshSpawnMock(child);

    vi.spyOn(readiness, 'probeHttp').mockResolvedValue({ ok: true, status: 404 });

    const ctx = makeCtx();
    // keepRunning = true → the child is NOT killed after the probe window.
    const promise = handleLongRunningCommand(ctx, 'pnpm dev', '/tmp', undefined, true);

    await flushSpawn(child);
    child.stdout.emit('data', Buffer.from('- Local: http://localhost:30000\n✓ Ready\n'));

    await vi.advanceTimersByTimeAsync(5_000);
    await vi.runAllTimersAsync();

    const r = await promise;

    // 404 < 500 → probeOk → success → server kept alive + tracked.
    expect(r.success).toBe(true);
    expect(r.serverPid).toBe(12345);
    expect(r.serverPort).toBe(30000);
    expect(child.killed).toBe(false);
    // The proximate-cause fix: a live server must NOT be labeled "killed".
    expect(r.output).toContain('exit: still-running (keep_running)');
    expect(r.output).not.toContain('killed-after-verification');
    expect(r.output).toContain('server_pid: 12345');
    expect(r.output).toContain('server_url: http://localhost:30000');
  });

  it('clean-exit zero (e.g. one-shot build): success=true even without probe', async () => {
    const child = new MockChild();
    await freshSpawnMock(child);

    const probeSpy = vi.spyOn(readiness, 'probeHttp');

    const ctx = makeCtx();
    const promise = handleLongRunningCommand(ctx, 'pnpm build', '/tmp', undefined, false);

    await flushSpawn(child);
    child.stdout.emit('data', Buffer.from('Building...\nBuild complete.\n'));
    child.exitCode = 0;
    await vi.advanceTimersByTimeAsync(100);
    child.emit('exit', 0, null);

    await vi.runAllTimersAsync();

    const r = await promise;

    expect(probeSpy).not.toHaveBeenCalled();
    expect(r.success).toBe(true);
    expect(r.exitCode).toBe(0);
    expect(r.output).toContain('exit: 0');
    expect(r.output).toContain('http_probe: skipped');
  });
});
