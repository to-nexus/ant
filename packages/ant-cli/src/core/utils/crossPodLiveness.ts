/**
 * Cross-pod liveness gate for multi-replica proxy services.
 *
 * In K8s, services like `ant-preview` and `ant-deploy` store {host, port, podId}
 * in Redis when spawning a child process in their own pod. A browser request may
 * land on a *different* pod replica (LB round-robin / no sticky session), which
 * must proxy cross-pod by IP:port. If the owning pod has rolled/crashed, that
 * Redis record is stale — it still says "running" but points at a dead IP.
 *
 * This module owns the "probe before trusting a cross-pod claim" decision, which
 * must not be duplicated across services.
 */

import * as net from 'net';

/**
 * Fast TCP liveness probe for a host:port. Never throws — any failure resolves
 * false. Used to validate cross-pod records before proxying to them.
 */
async function probeTcpReachable(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<boolean> {
  if (!host || !port) return false;

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

/**
 * Decide whether a Redis record naming a {host, port} should be trusted.
 *
 * Caller supplies `isLocallyOwned` using its own authoritative local-tracking
 * signal (e.g. DeployService: activeDeploys handle + podId match; PreviewService:
 * previewServers map presence). This function does not re-derive ownership; it
 * only owns the "cross-pod probe" decision.
 *
 * @param target The {host, port} from the Redis record
 * @param isLocallyOwned Whether this pod owns the target (skips probe)
 * @param timeoutMs TCP connect timeout (default 1000ms)
 * @returns 'local-owned' if owned by this pod; 'reachable' if cross-pod probe
 *          succeeds; 'unreachable' if cross-pod probe fails
 */
export async function resolveCrossPodLiveness(
  target: { host: string; port: number },
  isLocallyOwned: boolean,
  timeoutMs = 1000,
): Promise<'local-owned' | 'reachable' | 'unreachable'> {
  if (isLocallyOwned) return 'local-owned';
  return (await probeTcpReachable(target.host, target.port, timeoutMs))
    ? 'reachable'
    : 'unreachable';
}
