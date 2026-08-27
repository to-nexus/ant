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
  constructor(public url: string) { FakeEventSource.instances.push(this); }
  addEventListener() {}
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

});
