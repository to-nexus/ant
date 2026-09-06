/**
 * Raw WebSocket/HMR tunnel plumbing for the preview/deploy upgrade branches —
 * header rewriting (credential-stripped, loopback-normalized), peer-forward
 * replay, and the bounded-handshake TCP tunnel. Extracted from
 * PreviewServer.ts; that module re-exports these for compatibility.
 */

import * as net from 'net';
import type { IncomingMessage } from 'http';
import {
  filterPlatformCookie,
  isPlatformAuthorization,
  type PlatformCredentialFilter,
} from '../../periphery/adapters/http/middleware/proxyForwarding';
import { PREVIEW_PEER_FORWARD_HEADER } from '../../periphery/adapters/http/middleware/previewRouting';
import { logger } from '../../utils/logger';

/**
 * Trusted dev-server host stamped into the replayed upgrade `Host`/`Origin`.
 * A dev server's cross-origin protection trusts its OWN self-origin hostname,
 * which is the literal `localhost` — Next.js hardcodes `['localhost', '*.localhost', …]`
 * in its dev allowlist, and Vite's default `allowedHosts` likewise trusts it.
 * It does NOT trust the loopback IP `127.0.0.1`: Next 16 returns 403 on
 * `_next/*` dev resources whose Origin is `127.0.0.1` — the exact reason the
 * earlier `127.0.0.1` rewrite still failed ("Blocked … from 127.0.0.1"). So we
 * stamp `localhost`, never the IP, and never the upstream's reachable address
 * (a pod IP in cloud — used only for the TCP connect in `openRawTunnel`).
 */
const LOOPBACK_HOST = 'localhost';

/**
 * Upper bound for the WS/HMR tunnel's CONNECT + upgrade-handshake phase.
 * If the upstream TCP connect never completes, or completes but the dev
 * server never finishes the HTTP Upgrade handshake (never sends a byte back
 * post-101), the client socket occupies one of the browser's 6 HTTP/1.1
 * per-origin connection slots indefinitely — starving other module/script
 * requests to the same preview host. 20s is generous for a dev server that's
 * merely busy/cold-starting (WS upgrade doesn't wait on Vite's dependency
 * optimizer the way the first HTTP request does — HMR sockets are opened by
 * client JS after the page's own scripts already loaded) while still finite.
 *
 * This timeout is disabled once the first byte is received from upstream
 * (handshake response observed) — after that, the tunnel is confirmed live and
 * may sit idle indefinitely (e.g., HMR with no file changes).
 *
 * Tunable via ANT_PREVIEW_WS_HANDSHAKE_TIMEOUT_MS env var (parsed once on
 * module load), and overridable per-call for testing.
 */
export const WS_HANDSHAKE_TIMEOUT_MS = (() => {
  const envVal = process.env.ANT_PREVIEW_WS_HANDSHAKE_TIMEOUT_MS;
  return envVal ? Number(envVal) || 20_000 : 20_000;
})();

/**
 * Rewrite an inbound upgrade request's raw header pairs for replay to the
 * upstream. `Host` and `Origin` are normalized to the dev server's trusted
 * self-origin (`localhost`) so it sees a same-origin handshake — otherwise
 * cross-origin protection (e.g. Next.js dev-resource block) rejects the HMR
 * socket. Deliberately `localhost` (the trusted name) and NOT the connect host
 * (a pod IP in cloud) nor the loopback IP `127.0.0.1` (which Next 16 does not
 * trust).
 *
 * The upstream is a **user-authored** dev server, so the caller's platform
 * credentials are removed here exactly as the HTTP proxy's `buildCleanHeaders`
 * removes them — the WS branch previously replayed `rawHeaders` verbatim and
 * handed a victim's `ant_session` cookie to a public deploy's backend (H-005).
 * The app's own cookies, non-platform `Authorization`, and every WebSocket
 * handshake header pass through unchanged. Exported for unit coverage.
 */
export function rewriteUpgradeHeaders(
  rawHeaderPairs: readonly string[],
  targetPort: number,
  platform?: PlatformCredentialFilter,
): string[] {
  const rawHeaders: string[] = [];
  for (let i = 0; i < rawHeaderPairs.length; i += 2) {
    const key = rawHeaderPairs[i];
    const value = rawHeaderPairs[i + 1];
    const lower = key.toLowerCase();
    if (lower === 'host') {
      rawHeaders.push(`Host: ${LOOPBACK_HOST}:${targetPort}`);
    } else if (lower === 'origin') {
      rawHeaders.push(`Origin: http://${LOOPBACK_HOST}:${targetPort}`);
    } else if (platform && lower === 'cookie') {
      const kept = filterPlatformCookie(value, platform);
      if (kept !== null) rawHeaders.push(`${key}: ${kept}`);
    } else if (platform && lower === 'authorization') {
      if (!isPlatformAuthorization(value, platform)) rawHeaders.push(`${key}: ${value}`);
    } else {
      rawHeaders.push(`${key}: ${value}`);
    }
  }
  return rawHeaders;
}

/**
 * Replay an upgrade request's headers for a PEER forward to the owning pod's
 * ant-preview service port (NOT a dev server). Unlike `rewriteUpgradeHeaders`,
 * Host/Origin are preserved verbatim so the owner replica resolves the preview by
 * its subdomain Host and applies its own loopback normalization when it tunnels
 * onward. Injects the loop-guard header so the owner never forwards again.
 */
export function buildPeerForwardUpgradeHeaders(rawHeaderPairs: readonly string[]): string[] {
  const rawHeaders: string[] = [];
  for (let i = 0; i < rawHeaderPairs.length; i += 2) {
    const key = rawHeaderPairs[i];
    const value = rawHeaderPairs[i + 1];
    if (key.toLowerCase() === PREVIEW_PEER_FORWARD_HEADER) continue; // dedup — re-added below
    rawHeaders.push(`${key}: ${value}`);
  }
  rawHeaders.push(`${PREVIEW_PEER_FORWARD_HEADER}: 1`);
  return rawHeaders;
}

/**
 * Open a raw TCP tunnel between an inbound WebSocket Upgrade and an upstream
 * dev/static server, replaying the original HTTP request with Host and Origin
 * normalized to loopback. The TCP connect uses `targetHost` (a pod IP in
 * cloud); the replayed headers do not — see `rewriteUpgradeHeaders`. Shared by
 * the preview and deploy upgrade branches.
 *
 * The handshakeTimeoutMs parameter bounds the connect + handshake phase only.
 * Once the first byte is received from upstream (handshake response observed),
 * the timeout is permanently disabled so an idle-but-healthy HMR socket
 * (no file changes for a while) is never killed.
 */
export function openRawTunnel(
  req: IncomingMessage,
  clientSocket: net.Socket,
  head: Buffer,
  targetHost: string,
  targetPort: number,
  targetPath: string,
  handshakeTimeoutMs: number = WS_HANDSHAKE_TIMEOUT_MS,
  peerForward: boolean = false,
  platform?: PlatformCredentialFilter,
): void {
  const proxySocket = net.connect(targetPort, targetHost);

  // Bound the connect + handshake phase only. Cleared on the first byte
  // received from upstream post-connect (handshake response observed) —
  // after that, the tunnel is a confirmed-live pipe and may sit idle
  // indefinitely (e.g. HMR with no file changes).
  proxySocket.setTimeout(handshakeTimeoutMs);
  proxySocket.once('timeout', () => {
    logger.warn(
      `[PreviewServer] WS tunnel handshake timed out after ${handshakeTimeoutMs}ms (${targetHost}:${targetPort}) — destroying stuck sockets`,
      { component: 'PreviewServer' },
    );
    proxySocket.destroy();
    clientSocket.destroy();
  });

  proxySocket.once('connect', () => {
    // Peer forward targets another ant-preview replica, which still has to
    // re-verify ownership — it keeps the credential and strips it on the final
    // hop to the user-authored upstream.
    const rawHeaders = peerForward
      ? buildPeerForwardUpgradeHeaders(req.rawHeaders)
      : rewriteUpgradeHeaders(req.rawHeaders, targetPort, platform);

    const upgradeReq =
      `${req.method} ${targetPath} HTTP/${req.httpVersion}\r\n` +
      rawHeaders.join('\r\n') +
      '\r\n\r\n';

    proxySocket.write(upgradeReq);
    if (head.length > 0) {
      proxySocket.write(head);
    }

    // First byte back = handshake response observed = tunnel confirmed live.
    // Disable the idle timer permanently so a quiet-but-healthy HMR socket
    // (no file changes for a while) is never killed.
    proxySocket.once('data', () => {
      proxySocket.setTimeout(0);
    });

    proxySocket.pipe(clientSocket);
    clientSocket.pipe(proxySocket);
  });

  proxySocket.on('error', (err) => {
    logger.debug(`[PreviewServer] WS proxy error: ${err.message}`, { component: 'PreviewServer' });
    clientSocket.destroy();
  });
  clientSocket.on('error', () => {
    proxySocket.destroy();
  });
  clientSocket.on('close', () => {
    proxySocket.destroy();
  });
}
