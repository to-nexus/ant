/**
 * IDE readiness probes — shared between Docker and K8s orchestrators.
 *
 * Extracted from IDEService.ts so K8s entry points can reuse the same
 * polling shape (TCP socket + HTTP <500 status). Replaces ad-hoc loops
 * that previously diverged between local and cloud paths.
 */

import * as net from 'net';

const TCP_POLL_INTERVAL_MS = 300;
const TCP_CONNECT_TIMEOUT_MS = 800;
const HTTP_POLL_INTERVAL_MS = 300;
const HTTP_REQUEST_TIMEOUT_MS = 1000;

export async function waitForTcpReady(
  host: string,
  port: number,
  timeoutMs: number = 30_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host, port });
      const done = (result: boolean) => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(result);
      };
      socket.setTimeout(TCP_CONNECT_TIMEOUT_MS);
      socket.once('connect', () => done(true));
      socket.once('timeout', () => done(false));
      socket.once('error', () => done(false));
    });
    if (ok) return;
    await new Promise(r => setTimeout(r, TCP_POLL_INTERVAL_MS));
  }
  throw new Error(`TCP port not ready in ${timeoutMs}ms (host=${host}, port=${port})`);
}

/**
 * Poll an HTTP endpoint until it returns any status < 500 (200/302/401 etc).
 * Used to confirm the server process is alive and routing — not just that
 * the TCP socket accepted a connection.
 */
export async function waitForHttpReady(
  host: string,
  port: number,
  path: string = '/',
  timeoutMs: number = 15_000,
): Promise<void> {
  const start = Date.now();
  const url = `http://${host}:${port}${path}`;
  while (Date.now() - start < timeoutMs) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), HTTP_REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, { method: 'GET', signal: controller.signal });
      if (res.status > 0 && res.status < 500) return;
    } catch {
      // ignore until ready
    } finally {
      clearTimeout(t);
    }
    await new Promise(r => setTimeout(r, HTTP_POLL_INTERVAL_MS));
  }
  throw new Error(`HTTP endpoint not ready in ${timeoutMs}ms (url=${url})`);
}
