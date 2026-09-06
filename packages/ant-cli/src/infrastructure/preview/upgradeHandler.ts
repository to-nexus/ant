/**
 * Content-listener WebSocket upgrade handler — subdomain deploy/preview WS,
 * path-mode deploy WS, and the preview HMR tunnel, all terminating in
 * openRawTunnel. Registered from PreviewServer.start() on the CONTENT
 * listener only (H-NEW-001).
 */

import * as net from 'net';
import type { IncomingMessage } from 'http';
import {
  isSubdomainRouting,
  getDeployBaseDomain,
  getPreviewBaseDomain,
  refusesSharedOriginPrivateAdmission,
} from '../../core/config/previewRouting';
import { extractLabelFromHost } from '../../periphery/adapters/http/services/PreviewService/utils/previewLabel';
import { createJwtServiceFromEnv, JwtService } from '../auth/JwtService';
import {
  extractForwardingContext,
  parseCookieHeader,
  type PlatformCredentialFilter,
} from '../../periphery/adapters/http/middleware/proxyForwarding';
import { assertProxyOwnership } from '../../periphery/adapters/http/middleware/proxyOwnership';
import { isUrlKey, parseUrlKey } from '../../periphery/adapters/http/services/PreviewService/utils/serverKeyUtils';
import { resolveDeployTarget } from '../../periphery/adapters/http/middleware/deployRouting';
import {
  resolvePreviewTarget,
  resolvePreviewLabel,
  resolveOwnerForward,
  selfPodId,
  PREVIEW_PEER_FORWARD_HEADER,
} from '../../periphery/adapters/http/middleware/previewRouting';
import { resolveCrossPodLiveness } from '../../core/utils/crossPodLiveness';
import { logger } from '../../utils/logger';
import { openRawTunnel, WS_HANDSHAKE_TIMEOUT_MS } from './wsTunnel';
import type { PreviewServerCtx } from './controlRoutes/context';

export function createContentUpgradeHandler(ctx: PreviewServerCtx) {
  return async (req: IncomingMessage, socket: net.Socket, head: Buffer): Promise<void> => {
    // Every non-peer tunnel below terminates at a user-authored dev server,
    // so the caller's platform session must not travel with the handshake.
    // Same policy object the HTTP proxy uses.
    const upgradeJwtService = createJwtServiceFromEnv();
    const platformCredentials: PlatformCredentialFilter = {
      cookieName: JwtService.cookieName,
      isPlatformToken: upgradeJwtService
        ? (token: string) => {
            try { upgradeJwtService.verify(token); return true; } catch { return false; }
          }
        : undefined,
    };
    try {
      const urlPath = req.url || '/';
      const segments = urlPath.split('/').filter(Boolean);
      const firstSegment = segments[0] || '';

      // Subdomain / custom-domain deploy WS (deploy-only): in subdomain mode
      // the app is served at its own host root, so the WS Upgrade arrives at
      // a bare path with the deploy identified by Host. Resolve via the deploy
      // DNS label (platform subdomain) or the custom-domain registry (user
      // host, forwarded as X-Forwarded-Host by Caddy) and tunnel verbatim.
      if (isSubdomainRouting()) {
        // SSOT with the HTTP proxies: X-Forwarded-Host first, then Host.
        const hostHeader = extractForwardingContext(req).externalHost;
        const label = extractLabelFromHost(hostHeader, getDeployBaseDomain());
        let coords = label ? await ctx.deployService.resolveDeployLabel(label) : null;
        if (!coords) coords = await ctx.deployService.resolveCustomDomain(hostHeader || '');
        if (coords) {
          // Owner/visibility check BEFORE ensureRunning (M-029): no private
          // rehydration or tunnel for an unauthorized caller; public keeps
          // its lazy start.
          if (!(await ctx.authorizeDeployUpgrade(req, coords))) { socket.destroy(); return; }
          const state = await ctx.deployService.ensureRunning(
            coords.tenantId, coords.userId, coords.projectId, coords.feature,
          );
          if (!state) { socket.destroy(); return; }
          const target = resolveDeployTarget(state, coords.serviceName, '');
          if (!target) { socket.destroy(); return; }
          // Root-served: forward the path verbatim (no basePath prefix).
          openRawTunnel(req, socket, head, target.targetHost, target.targetPort, urlPath, WS_HANDSHAKE_TIMEOUT_MS, false, platformCredentials);
          return;
        }

        // Preview subdomain WS: the app is served at its own host root, so
        // the HMR Upgrade arrives at a bare path (no urlKey). Resolve the
        // Host label via the preview base domain and tunnel per-package
        // through the SAME resolvePreviewLabel + resolvePreviewTarget SSOTs
        // as the HTTP proxy — symmetric with the deploy branch above.
        const previewLabel = extractLabelFromHost(hostHeader, getPreviewBaseDomain());
        // O(1) index ONLY (M-NEW-020), same as the HTTP proxy: this label is
        // attacker-controlled on an unauthenticated upgrade, so a miss ends
        // here rather than enumerating the registry.
        const indexedPreview = previewLabel
          ? await ctx.stateStore.getPreviewByLabel(previewLabel)
          : null;
        const pMatch = indexedPreview ? resolvePreviewLabel([indexedPreview], previewLabel!) : null;
        if (pMatch) {
          // Cloud mode requires a valid owner session (upgrade bypasses Express middleware).
          const isCloudMode = ctx.mode === 'cloud' || process.env.ANT_SERVER_MODE === 'cloud';
          if (isCloudMode) {
            const jwtService = createJwtServiceFromEnv();
            if (jwtService) {
              const token = parseCookieHeader(req.headers.cookie)[JwtService.cookieName];
              if (!token) { socket.destroy(); return; }
              try {
                if (!assertProxyOwnership(jwtService.verify(token), { tenantId: pMatch.tenantId, userId: pMatch.userId })) {
                  socket.destroy(); return;
                }
              } catch { socket.destroy(); return; }
            }
          }
          // Resolve the target directly from the already-matched label
          // record (host/port/packages/serviceName). The HMR socket must
          // NOT be gated on a cross-pod liveness probe: in a multi-replica
          // deployment this upgrade can land on a non-owner pod, and a
          // probe miss would both kill HMR and corrupt the (healthy)
          // preview to 'stopped'. A genuinely dead target fails fast via
          // openRawTunnel's own handshake timeout — forgiving + bounded,
          // matching the HTTP path and deploy's non-destructive posture.
          // LOCAL-FIRST (mirrors the HTTP proxy): when THIS pod already
          // runs the dev server, tunnel to the pod-local spawn facts and
          // skip owner-forward — the shared record may point at another
          // pod after a rehydrate REPLACE, but the local instance is the
          // correct (and only reachable) target.
          const wsLocal = ctx.previewService.getLocalPreview(
            pMatch.tenantId, pMatch.userId, pMatch.projectId, pMatch.feature,
          );
          if (wsLocal) {
            const localKey = `${pMatch.tenantId}:${pMatch.userId}:${pMatch.projectId}:${pMatch.feature}`;
            const t = resolvePreviewTarget({ host: wsLocal.host, packages: wsLocal.packages }, pMatch.serviceName, localKey);
            openRawTunnel(req, socket, head, t?.targetHost ?? wsLocal.host, t?.targetPort ?? wsLocal.port, urlPath, WS_HANDSHAKE_TIMEOUT_MS, false, platformCredentials);
            return;
          }
          // Cross-pod owner-forwarding (mirrors the HTTP proxy): when this
          // HMR upgrade lands on a non-owner replica, tunnel it to the owner
          // pod's ant-preview service port (Host preserved via peerForward)
          // instead of the owner's dev port (unreachable cross-pod). Ownership
          // is decided by podId (os.hostname), never POD_IP. owner-is-self /
          // stale-podId / already-forwarded → serve here directly.
          const ownerForward = resolveOwnerForward(
            pMatch.podId,
            pMatch.host,
            req.headers[PREVIEW_PEER_FORWARD_HEADER] === '1',
          );
          if (ownerForward) {
            // Fast path: probe the owner service port (1s). Reachable →
            // forward the HMR socket there (Host preserved).
            const liveness = await resolveCrossPodLiveness(
              { host: ownerForward.forwardHost, port: ownerForward.forwardPort },
              false,
            );
            if (liveness === 'reachable') {
              openRawTunnel(req, socket, head, ownerForward.forwardHost, ownerForward.forwardPort, urlPath, WS_HANDSHAKE_TIMEOUT_MS, true);
              return;
            }
            // Owner unreachable cross-pod → rehydrate the dev server on THIS
            // pod and tunnel the HMR socket locally (mirrors the HTTP proxy).
            logger.warn(
              `[PreviewServer] WS owner pod ${ownerForward.forwardHost}:${ownerForward.forwardPort} unreachable — rehydrating locally: ` +
              `owner=${pMatch.podId} self=${selfPodId()}`,
              { component: 'PreviewServer' },
            );
            const fresh = await ctx.previewService.ensureRunning(
              pMatch.tenantId, pMatch.userId, pMatch.projectId, pMatch.feature,
              ctx.resolveWorkspacePath({ organizationId: pMatch.tenantId, userId: pMatch.userId }, pMatch.projectId, pMatch.feature),
            );
            if (!fresh) { socket.destroy(); return; }
            const localKey = `${pMatch.tenantId}:${pMatch.userId}:${pMatch.projectId}:${pMatch.feature}`;
            const localTarget = resolvePreviewTarget({ host: fresh.host, packages: fresh.packages }, pMatch.serviceName, localKey);
            openRawTunnel(req, socket, head, localTarget?.targetHost ?? fresh.host, localTarget?.targetPort ?? fresh.port, urlPath, WS_HANDSHAKE_TIMEOUT_MS, false, platformCredentials);
            return;
          }
          const internalKey = `${pMatch.tenantId}:${pMatch.userId}:${pMatch.projectId}:${pMatch.feature}`;
          const target = resolvePreviewTarget({ host: pMatch.host, packages: pMatch.packages }, pMatch.serviceName, internalKey);
          const targetHost = target?.targetHost ?? pMatch.host;
          const targetPort = target?.targetPort ?? pMatch.port;
          // Root-served: forward the path verbatim (no basePath prefix).
          openRawTunnel(req, socket, head, targetHost, targetPort, urlPath, WS_HANDSHAKE_TIMEOUT_MS, false, platformCredentials);
          return;
        }
        // No deploy/preview Host match → fall through (path-mode WS, if any).
      }

      // Deploy path: `/deploy/<urlKey>/...` — public artifact serving, no JWT
      // (matches the HTTP-side mount at `app.use('/deploy/', ...)`). Routes
      // the Upgrade to the per-package static server via resolveDeployTarget.
      if (firstSegment === 'deploy') {
        const urlKey = segments[1];
        if (!urlKey || !isUrlKey(urlKey)) { socket.destroy(); return; }
        const parsed = parseUrlKey(urlKey);
        if (!parsed) { socket.destroy(); return; }

        // Owner/visibility check BEFORE ensureRunning (M-029): an
        // unauthorized caller must not trigger a private deploy's
        // rehydration or tunnel. Public deploys keep their lazy start.
        if (!(await ctx.authorizeDeployUpgrade(req, parsed))) { socket.destroy(); return; }

        const state = await ctx.deployService.ensureRunning(
          parsed.tenantId,
          parsed.userId,
          parsed.projectId,
          parsed.feature,
        );
        if (!state) { socket.destroy(); return; }

        const target = resolveDeployTarget(state, parsed.serviceName, urlKey);
        if (!target) { socket.destroy(); return; }

        logger.debug(
          `[PreviewServer] WS upgrade (deploy): ${urlPath} → ${target.targetHost}:${target.targetPort}`,
          { component: 'PreviewServer' },
        );

        // Static server's basePath is `/deploy/<urlKey>`, so the inbound
        // path already lines up with the upstream — forward as-is.
        openRawTunnel(req, socket, head, target.targetHost, target.targetPort, urlPath, WS_HANDSHAKE_TIMEOUT_MS, false, platformCredentials);
        return;
      }

      // Preview path: cloud mode requires JWT (upgrade bypasses Express middleware).
      const isCloudMode = ctx.mode === 'cloud' || process.env.ANT_SERVER_MODE === 'cloud';
      let previewPayload: { org: string; sub: string } | undefined;
      if (isCloudMode) {
        const jwtService = createJwtServiceFromEnv();
        if (jwtService) {
          // A preview is owner-only. In cloud path-mode it shares the content
          // origin with public deploys, so a browser same-origin WS upgrade
          // from attacker public content carries the victim's ambient cookie
          // and would pass the owner check as the victim (M-029). Refuse
          // ambient/browser admission on the shared path-mode origin; private
          // serving requires subdomain mode. Non-ambient/local unaffected.
          if (refusesSharedOriginPrivateAdmission(req.headers)) { socket.destroy(); return; }
          const token = parseCookieHeader(req.headers.cookie)[JwtService.cookieName];
          if (!token) { socket.destroy(); return; }
          try { previewPayload = jwtService.verify(token); } catch { socket.destroy(); return; }
        }
      }

      // Check if first segment is a URL-safe serverKey (contains double-dashes)
      if (!isUrlKey(firstSegment)) {
        socket.destroy();
        return;
      }

      // Parse the FULL segment (keeps the optional 5th serviceName) so the
      // HMR socket is routed per-package — matching the HTTP proxy. The
      // Redis lookup key itself stays 4-part.
      const parsed = parseUrlKey(firstSegment);
      if (!parsed) {
        socket.destroy();
        return;
      }

      const { tenantId, userId, projectId, feature, serviceName } = parsed;

      // Owner-only gate (symmetric with the HTTP proxy): a valid session
      // for another owner must not tunnel into this preview's HMR/runtime.
      if (previewPayload && !assertProxyOwnership(previewPayload, { tenantId, userId })) {
        socket.destroy();
        return;
      }
      // Resolve the target from the preview record (phase-agnostic). The
      // HMR socket must NOT be gated on a cross-pod liveness probe — a
      // probe miss on a non-owner replica would kill HMR and corrupt a
      // healthy preview to 'stopped'. A dead target fails fast via
      // openRawTunnel's handshake timeout (forgiving + bounded).
      // Local-first: this pod's own instance wins over the shared record.
      const mapping = ctx.previewService.getLocalPreview(tenantId, userId, projectId, feature)
        ?? await ctx.stateStore.getPreview(
          tenantId,
          userId,
          projectId,
          feature,
        );
      if (!mapping) {
        socket.destroy();
        return;
      }

      // Per-package routing by slug (5-part urlKey); 4-part or unmatched
      // slug falls back to the entry frontend. Without this, a non-entry
      // frontend's HMR socket tunnels to the entry dev server, whose
      // basePath does not match the requested prefix → the upgrade is
      // rejected and HMR fails.
      const target = resolvePreviewTarget(mapping, serviceName, firstSegment);
      const targetHost = target?.targetHost ?? (mapping.host || 'localhost');
      const targetPort = target?.targetPort ?? mapping.port;

      // Frontend keeps the urlKey prefix (its basePath equals the urlKey),
      // and the HMR socket is always a frontend `_next/webpack-hmr` socket.
      const targetPath = urlPath;

      logger.debug(`[PreviewServer] WS upgrade: ${urlPath} → ${targetHost}:${targetPort}${targetPath}`, {
        component: 'PreviewServer'
      });

      openRawTunnel(req, socket, head, targetHost, targetPort, targetPath, WS_HANDSHAKE_TIMEOUT_MS, false, platformCredentials);
    } catch (error: any) {
      logger.warn(`[PreviewServer] WS upgrade failed: ${error.message}`, { component: 'PreviewServer' });
      socket.destroy();
    }
  };
}
