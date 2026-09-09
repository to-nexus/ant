/**
 * Unified-SSE retry lifecycle.
 *
 * `onerror` schedules its own reconnect (the browser gives up on a non-200 and
 * never retries), and that callback closes over the (project, feature, job)
 * that failed. So the timer has to be cancellable: a teardown that leaves it
 * pending re-opens the OLD identity up to 30 s later.
 *
 * That is not hypothetical — it is what would undo the cross-tenant self-heal.
 * After an org switch the stream 404s in a loop; clearing the stale selection
 * calls `disconnectAll()`, and if a scheduled retry survived it would reconnect
 * to the dead cross-org feature and flip `connectionStatus` back to
 * 'disconnected'.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.stubGlobal('window', { location: { origin: 'http://localhost:4200' }, addEventListener: vi.fn() });
vi.stubGlobal('document', { addEventListener: vi.fn(), visibilityState: 'visible' });

vi.mock('@/infrastructure/http/api', () => ({
  REALTIME_BASE: () => 'http://localhost:4101/realtime',
  API_BASE: () => 'http://localhost:4100/api',
}));

const authProbe = vi.fn().mockResolvedValue({ kind: 'user' });
vi.mock('@ant/auth-client', () => ({
  fetchAuthMeDetailed: (...a: unknown[]) => authProbe(...a),
}));
vi.mock('@/infrastructure/auth/authBridge', () => ({
  getAuthBroadcaster: () => ({ post: vi.fn(), subscribe: vi.fn(() => vi.fn()) }),
  markSessionExpired: vi.fn(),
  isSessionExpired: () => false,
}));

/** Minimal EventSource that never opens and can be driven into `onerror`. */
class FakeEventSource {
  static CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = FakeEventSource.CLOSED;
  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  listeners: Record<string, () => void> = {};
  constructor(public url: string) { FakeEventSource.instances.push(this); }
  addEventListener(type: string, cb: () => void) { this.listeners[type] = cb; }
  close() { this.closed = true; }
}
vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);

async function freshManager() {
  vi.resetModules();
  FakeEventSource.instances = [];
  const mod = await import('../../src/infrastructure/sse/SSEManager');
  return mod.sseManager as any;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('unified SSE self-scheduled retry', () => {
  it('disconnect() cancels a pending retry — no reconnect to the torn-down identity', async () => {
    const m = await freshManager();
    m.connect('old-org-proj', 'feat', 'code');
    expect(FakeEventSource.instances).toHaveLength(1);

    // The 404 path: readyState is CLOSED, so the manager schedules its own retry.
    FakeEventSource.instances[0].onerror!();

    // The app moves on (e.g. session restore clears the cross-tenant selection).
    m.disconnectAll();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('without a teardown the retry still fires — cancellation is scoped, not blanket', async () => {
    const m = await freshManager();
    m.connect('proj', 'feat', 'code');
    FakeEventSource.instances[0].onerror!();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeEventSource.instances.length).toBeGreaterThan(1);
  });

  /**
   * Backoff must be monotonic in `attempts`. It used to be two expressions
   * chosen by an `exhausted` branch with different exponent offsets, so the 5th
   * attempt dropped from 8s back to 1s — the client got more impatient exactly
   * when the server was refusing it (a 429 `connection_limit` is a non-200, so
   * every one of these retries is client-scheduled).
   */
  it('backoff grows monotonically across the exhaustion boundary', async () => {
    const m = await freshManager();
    m.connect('proj', 'feat', 'code');

    // Attempts 1..4 — 1s, 2s, 4s, 8s.
    for (const delay of [1_000, 2_000, 4_000, 8_000]) {
      const before = FakeEventSource.instances.length;
      FakeEventSource.instances[before - 1].onerror!();
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(FakeEventSource.instances).toHaveLength(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(FakeEventSource.instances).toHaveLength(before + 1);
    }

    // Attempt 5 crosses into `exhausted`. The old formula reconnected at 1s here.
    const before = FakeEventSource.instances.length;
    FakeEventSource.instances[before - 1].onerror!();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(FakeEventSource.instances).toHaveLength(before);

    await vi.advanceTimersByTimeAsync(8_000);
    expect(FakeEventSource.instances).toHaveLength(before + 1);
  });
});

/**
 * A workflow stream carries exactly one job's events, so the job ending is what
 * ends the stream. Leaving it open held a server-side SSE slot from a
 * per-account budget of 10 that feature streams share — one leaked slot per
 * completed job, and universal makes a job per turn. The store's completion path
 * cannot own this: it flips `isRunning` with a raw `set()` and never reaches
 * `setRunning(false)`, where the only other `disconnectWorkflow` call lives.
 */
describe('workflow SSE lifetime', () => {
  it('closes the stream when the job ends', async () => {
    const m = await freshManager();
    m.connectWorkflow('job-1');
    expect(FakeEventSource.instances).toHaveLength(1);

    FakeEventSource.instances[0].listeners.end!();

    expect(FakeEventSource.instances[0].closed).toBe(true);
    expect(m.isWorkflowConnected('job-1')).toBe(false);
  });

  it('does not accumulate one stream per completed job', async () => {
    const m = await freshManager();
    for (let i = 0; i < 12; i++) {
      m.connectWorkflow(`job-${i}`);
      FakeEventSource.instances[FakeEventSource.instances.length - 1].listeners.end!();
    }

    const open = FakeEventSource.instances.filter(es => !es.closed);
    expect(open).toHaveLength(0);
  });
});
