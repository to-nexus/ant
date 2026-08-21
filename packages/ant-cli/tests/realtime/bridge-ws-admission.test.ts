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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { WebSocket } from 'ws';

import { BridgeWebSocketHandler } from '../../src/infrastructure/realtime/BridgeWebSocketHandler';

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
