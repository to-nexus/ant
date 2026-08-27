/**
 * Bridge WebSocket admission caps (M-NEW-022 / M-NEW-025).
 *
 * An accepted upgrade holds an FD + heap client record + listeners until it
 * closes. Without a cap an unauthenticated peer accumulates them (M-NEW-025)
 * and an authenticated user's many connections multiply the Redis response
 * fan-out (M-NEW-022). These pod-local caps refuse the over-cap upgrade before
 * it is accepted, and release the reservation when the socket closes.
 *
 * Real `ws` clients against the handler wired to an http server's upgrade event.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import { WebSocket } from 'ws';

import { BridgeWebSocketHandler } from '../../src/infrastructure/realtime/BridgeWebSocketHandler';
import { BridgeSessionManager } from '../../src/infrastructure/realtime/BridgeSessionManager';

// Minimal stateStore stub — admission never touches Redis.
const stubStore = {
  setKeyWithTTL: async () => {},
  reserveSlot: async () => true,
  publish: async () => {},
  subscribe: async () => () => {},
  getKey: async () => null,
  deleteKey: async () => {},
};

let server: http.Server;
let handler: BridgeWebSocketHandler;
let url: string;

beforeEach(async () => {
  handler = new BridgeWebSocketHandler({
    stateStore: stubStore as any,
    caps: { maxPerIp: 2, maxDetectedGlobal: 3, maxPerUser: 2 },
  });
  server = http.createServer();
  server.on('upgrade', (req, socket, head) => handler.handleUpgrade(req, socket, head as Buffer));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `ws://127.0.0.1:${(server.address() as { port: number }).port}/bridge/ws`;
});

afterEach(async () => {
  await handler.close().catch(() => {});
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Open a ws and resolve 'open' | 'rejected' when the handshake settles. */
function connect(): Promise<{ result: 'open' | 'rejected'; ws: WebSocket }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve({ result: 'open', ws }));
    ws.once('unexpected-response', () => resolve({ result: 'rejected', ws }));
    ws.once('error', () => resolve({ result: 'rejected', ws }));
  });
}

describe('BridgeWebSocketHandler admission (M-NEW-022/025)', () => {
  it('refuses the over-cap upgrade from one IP and frees the slot on close', async () => {
    const a = await connect();
    const b = await connect();
    expect(a.result).toBe('open');
    expect(b.result).toBe('open');

    // Third from the same IP exceeds maxPerIp=2.
    const c = await connect();
    expect(c.result).toBe('rejected');

    // Closing one frees a slot; a new connection is admitted again.
    a.ws.close();
    await new Promise((r) => setTimeout(r, 50));
    const d = await connect();
    expect(d.result).toBe('open');

    b.ws.close();
    d.ws.close();
  });
});

/**
 * Bridge session tenant scoping.
 *
 * Two holes that together let any unauthenticated peer own "Ant Desktop is
 * running" for every tenant on a deployment: `handleRegister` accepted a
 * client-supplied `msg.userId` on a connection that had proved nothing, and the
 * probe record lives under one global, unscoped Redis key that `getStatus`
 * returned to whoever asked. The key stays global on purpose (there is no
 * correlation value tying an anonymous desktop to a browser session) — so the
 * probe fallback is confined to local mode, a single-developer trust boundary.
 */
describe('bridge session tenant scoping', () => {
  it('an unauthenticated register cannot claim an identity', async () => {
    const writes: Array<{ key: string; value: any }> = [];
    const capturing = {
      ...stubStore,
      setKeyWithTTL: async (key: string, value: string) => {
        writes.push({ key, value: JSON.parse(value) });
      },
    };
    const h = new BridgeWebSocketHandler({ stateStore: capturing as any });
    const srv = http.createServer();
    srv.on('upgrade', (req, socket, head) => h.handleUpgrade(req, socket, head as Buffer));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as { port: number }).port;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/bridge/ws`);
    await new Promise<void>((r) => ws.once('open', () => r()));
    // No Authorization header was sent, so this peer proved nothing — yet it
    // asserts a userId in the payload.
    ws.send(JSON.stringify({
      type: 'bridge.register',
      userId: 'victim-user',
      machineId: 'attacker-laptop',
      capabilities: [],
      figmaDesktopReachable: true,
    }));
    await new Promise((r) => setTimeout(r, 100));

    expect(writes.length).toBeGreaterThan(0);
    for (const w of writes) {
      expect(w.value.userId).toBe('anonymous');
      expect(w.key).not.toContain('victim-user');
    }

    ws.close();
    await h.close().catch(() => {});
    await new Promise<void>((r) => srv.close(() => r()));
  });

  const probeStore = (probe: unknown) => ({
    getKey: async (k: string) => (k === 'ant:bridge:probe' ? JSON.stringify(probe) : null),
    setKeyWithTTL: async () => {},
    deleteKey: async () => {},
  });

  const freshProbe = () => ({
    userId: 'anonymous',
    machineId: 'someone-elses-laptop',
    capabilities: [],
    connectedAt: Date.now(),
    lastPingAt: Date.now(),
    status: 'detected' as const,
    figmaDesktopReachable: true,
  });

  const rows: Array<[string, string, boolean]> = [
    ['cloud', 'cloud', false],
    ['local', 'local', true],
  ];

  it.each(rows)('%s mode: another peer\'s probe is visible = %s', async (_label, mode, visible) => {
    vi.stubEnv('ANT_SERVER_MODE', mode);
    vi.resetModules();
    const { BridgeSessionManager: Fresh } = await import(
      '../../src/infrastructure/realtime/BridgeSessionManager'
    );
    const mgr = new Fresh(probeStore(freshProbe()));
    const status = await mgr.getStatus('some-other-user');
    expect(status.detected).toBe(visible);
    expect(status.connected).toBe(false);
    vi.unstubAllEnvs();
  });

  it('an authenticated session is still reported in cloud mode', async () => {
    vi.stubEnv('ANT_SERVER_MODE', 'cloud');
    const store = {
      getKey: async (k: string) =>
        k === 'ant:bridge:session:u1'
          ? JSON.stringify({
              userId: 'u1',
              machineId: 'm1',
              capabilities: [],
              connectedAt: Date.now(),
              lastPingAt: Date.now(),
              status: 'connected',
              figmaDesktopReachable: true,
            })
          : null,
      setKeyWithTTL: async () => {},
      deleteKey: async () => {},
    };
    const status = await new BridgeSessionManager(store).getStatus('u1');
    expect(status.connected).toBe(true);
    expect(status.detected).toBe(true);
    vi.unstubAllEnvs();
  });
});
