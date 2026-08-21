/**
 * PreviewServer
 * 
 * Complete Preview Service for ant-preview deployment.
 * Handles all /preview/* requests according to 10-cloud-architecture.md
 * 
 * Features:
 * - External API: /projects/:id/start, stop, status
 * - Preview Proxy: /:key/* → Dev Server
 * - Redis-based state management (shared across pods)
 * - Dev Server lifecycle management
 * 
 * 별도 호스트: 배포 도메인의 preview sub-host → ant-preview service
 * 
 * @see docs/internals/02-infrastructure.md Section 3.2
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import * as path from 'path';
import { type ProjectProfile } from '@ant/shared';
import * as fs from 'fs';
import * as os from 'os';
import * as net from 'net';
import { IncomingMessage } from 'http';
import { PreviewService } from '../../periphery/adapters/http/services/PreviewService';
import { createPreviewProxyMiddleware } from '../../periphery/adapters/http/middleware/previewProxy';
import { createDeployProxyMiddleware } from '../../periphery/adapters/http/middleware/deployProxy';
import {
  isSubdomainRouting,
  getDeployBaseDomain,
  getPreviewBaseDomain,
  getPreviewRoutingMode,
  getPreviewControlPort,
  getPreviewContentPort,
  assertPreviewOriginSeparation,
} from '../../core/config/previewRouting';
import { resolveRedisUrl } from '../../core/config/redisUrl';
import { extractLabelFromHost } from '../../periphery/adapters/http/services/PreviewService/utils/previewLabel';
import { createCorsMiddleware } from '../../periphery/adapters/http/middleware/corsConfig';
import { createJwtAuthMiddleware } from '../../periphery/adapters/http/middleware/jwtAuth';
import { previewRateLimiter, healthRateLimiter, initializeRateLimiters } from '../../periphery/adapters/http/middleware/rateLimiter';
import { createSameOriginGuard } from '../../periphery/adapters/http/middleware/sameOriginGuard';
import { createJwtServiceFromEnv, JwtService } from '../auth/JwtService';
import {
  extractForwardingContext,
  parseCookieHeader,
  filterPlatformCookie,
  isPlatformAuthorization,
  type PlatformCredentialFilter,
} from '../../periphery/adapters/http/middleware/proxyForwarding';
import { assertProxyOwnership } from '../../periphery/adapters/http/middleware/proxyOwnership';
import { PortManager } from '../networking/PortManager';
import { RedisStateStore } from '../state/RedisStateStore';
import { StateStorePort } from '../../core/ports/stateStore';
import { PortRegistryPort } from '../../core/ports/portRegistry';
import { DeployService } from '../deploy/DeployService';
import { CustomDomainService } from '../deploy/customDomain/CustomDomainService';
import { isBillingEnabled } from '../../core/config/billingCapability';
import { getInfrastructureFactory } from '../adapters/InfrastructureFactory';
import { extractUserContext } from '../../periphery/adapters/http/routes/helpers/userContext';
import { UnifiedWorkspaceResolver, type WorkspaceResolver } from '../../core/config/WorkspacePathResolver';
import { isUrlKey, parseUrlKey } from '../../periphery/adapters/http/services/PreviewService/utils/serverKeyUtils';
import { resolveConnectionForSave } from '../../periphery/adapters/http/services/PreviewService/utils/connectionResolve';
import { resolveConnectionDir } from '../../periphery/adapters/http/services/PreviewService/utils/connectionDir';
import { resolveDeployTarget } from '../../periphery/adapters/http/middleware/deployRouting';
import { resolvePreviewTarget, resolvePreviewLabel, resolveOwnerForward, selfPodId, selfServicePort, PREVIEW_PEER_FORWARD_HEADER } from '../../periphery/adapters/http/middleware/previewRouting';
import { resolveCrossPodLiveness } from '../../core/utils/crossPodLiveness';
import { ProjectProfileDetector, type DetectedProjectFacts } from '../../periphery/adapters/http/services/PreviewService/detectors/ProjectProfileDetector';
import { observedFactsPatch, resolveProjectFacts } from '../../periphery/adapters/http/services/PreviewService/utils/projectFacts';
import { ConnectionDetector } from '../../periphery/adapters/http/services/PreviewService/detectors/ConnectionDetector';
import {
  upsertConnectionAnnotation,
  mirrorConnectionToEnv,
  removeConnectionAnnotation,
  removeEnvKey,
  syncEnvStructureFromExample,
} from '../../periphery/adapters/http/services/PreviewService/detectors/ConnectionDetector/envFileWriter';
import { detectFramework } from '../deploy';
import { toToggleFramework, frameworkTogglePrefix } from '../../core/prompt/builder/serviceVirtualization/connectionModel';
import { InfrastructureManager } from '../../periphery/adapters/http/services/PreviewService/managers/InfrastructureManager';
import { sendErrorResponse } from '../../periphery/adapters/http/routes/helpers/errorResponse';
import { REDIS_KEYS } from '../../core/constants/redis';
import type { CleanupRequestPayload, CleanupAckPayload } from '../../periphery/adapters/http/services/ProjectService/previewCleanup';
import { logger } from '../../utils/logger';

// ============================================
// Configuration
// ============================================

export interface PreviewServerOptions {
  port?: number;
  redisUrl: string;  // Required for distributed state
  workspacesPath?: string;
  mode?: 'local' | 'cloud';
}

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
 * Deployed-build marker for the preview cross-pod routing. Printed in the boot
 * `routing diag` line so a redeploy can be confirmed live from the logs. Bump on
 * material changes to the owner-forwarding path.
 */
const PREVIEW_ROUTING_BUILD = process.env.ANT_BUILD_SHA || 'owner-forward-podId-v2';

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

/**
 * Every preview/deploy operation is feature-scoped — a project has no codebase
 * of its own. Returns the feature name, or sends 400 and returns null.
 *
 * Replaces the old `req.body?.feature || 'main'` defaults, which synthesized a
 * feature that may not exist instead of rejecting an incomplete request.
 */
function requireFeature(req: Request, res: Response): string | null {
  const feature = (req.body?.feature ?? req.query.feature) as string | undefined;
  if (!feature) {
    res.status(400).json({ success: false, error: 'feature is required' });
    return null;
  }
  return feature;
}

// ============================================
// PreviewServer
// ============================================

/**
 * Bind a package-level env file to the workspace root.
 *
 * `resolveConnectionDir` proves the package dir is inside the workspace at check
 * time, but it hands back a *name*. A user-authored preview child sharing this
 * workspace can swap an intermediate component (`apps`) for an external symlink
 * before the write lands, and a name-based write follows it (H-003). Passing the
 * workspace root alongside the relative path makes the writer descend from the
 * root by descriptor, so every ancestor is bound too.
 */
function envTarget(workspaceRoot: string, pkgDir: string, fileName: string): { root: string; rel: string } {
  return { root: workspaceRoot, rel: path.join(path.relative(workspaceRoot, pkgDir), fileName) };
}

export class PreviewServer {
  /**
   * Control plane: `/projects/*` management API, `/health`, `/admin/*`.
   * Cookie-authenticated.
   */
  private app: Express;
  /**
   * User content: the preview and deploy proxies. Serves attacker-authorable
   * documents (a deployed SVG or HTML page, a user's own dev server), so it
   * mounts NO control-plane route — see {@link setupContentRoutes}.
   */
  private contentApp: Express;
  private previewService!: PreviewService;
  private deployService!: DeployService;
  private customDomainService!: CustomDomainService;
  private portManager!: PortManager;
  private stateStore!: StateStorePort & PortRegistryPort;
  private server: any;
  private contentServer: any;
  private options: PreviewServerOptions;
  private workspaceResolver: WorkspaceResolver;
  private cleanupUnsubscribe?: () => void;
  private connectionsRefreshUnsubscribe?: () => void;

  constructor(options: PreviewServerOptions) {
    this.options = options;
    this.workspaceResolver = new UnifiedWorkspaceResolver(
      options.workspacesPath || process.env.ANT_WORKSPACE_BASE_PATH || '/mnt/workspaces',
    );
    this.app = express();
    this.contentApp = express();
  }

  /**
   * Initialize services
   */
  private async initialize(): Promise<void> {
    // Initialize Redis-based state store
    this.stateStore = new RedisStateStore({
      url: this.options.redisUrl
    });
    
    logger.warn('[PreviewServer] Using RedisStateStore for distributed state', {
      component: 'PreviewServer'
    });

    // Initialize port management (Redis-authoritative — globally-unique claims)
    this.portManager = new PortManager(this.stateStore);
    
    // Initialize preview service with Redis
    const workspaceRoot = this.options.workspacesPath || process.env.ANT_WORKSPACE_BASE_PATH;
    this.previewService = new PreviewService(
      this.portManager,
      this.stateStore,  // Redis as PortRegistry
      {
        onStatusChange: (serverKey) => {
          logger.debug(`[PreviewServer] Status changed: ${serverKey}`, {
            component: 'PreviewServer'
          });
        }
      },
      this.stateStore,  // Redis as StateStore for Pub/Sub
      workspaceRoot
    );

    // Initialize deploy service
    this.deployService = new DeployService({
      portManager: this.portManager,
      stateStore: this.stateStore,
      workspacesPath: workspaceRoot,
    });

    // Custom-domain management (deploy-only). Serving/routing lives in the
    // deploy proxy (DeployService.resolveCustomDomain); this owns the
    // register/verify/list/delete management plane.
    this.customDomainService = new CustomDomainService(this.stateStore);

    // Reap previews this pod owned before a Node-process restart (the detached
    // dev-server groups survive a restart inside a living container and still
    // hold their ports). Reaps by persisted pgid + releases the port claims so
    // a fresh start begins from a clean slate. Best-effort — never blocks boot.
    try {
      await this.previewService.reconcileOwnedPreviews();
    } catch (err: any) {
      logger.warn('[PreviewServer] reconcileOwnedPreviews failed (continuing)', { component: 'PreviewServer' }, { err: err?.message ?? String(err) });
    }

    // Register cross-process cleanup subscriber. ProjectService (API) publishes
    // requests on `ant:lifecycle:cleanup:request`; we run the matching cleanup
    // and ack on `ant:lifecycle:cleanup:ack` so the API can confirm before
    // running fs.rm. See `previewCleanup.ts` for the publisher contract.
    this.cleanupUnsubscribe = await this.stateStore.subscribe(
      REDIS_KEYS.LIFECYCLE.CLEANUP_REQUEST,
      async (raw: any) => {
        const msg = raw as Partial<CleanupRequestPayload> | undefined;
        if (!msg || !msg.requestId || !msg.scope || !msg.organizationId || !msg.userId || !msg.projectId) {
          logger.warn('[PreviewServer] Ignored malformed cleanup request', { component: 'PreviewServer' }, { msg });
          return;
        }
        try {
          if (msg.scope === 'project') {
            await this.previewService.cleanupProject(msg.organizationId, msg.userId, msg.projectId);
          } else if (msg.scope === 'feature') {
            if (!msg.featureName) {
              throw new Error('cleanup request scope=feature missing featureName');
            }
            await this.previewService.cleanupFeature(msg.organizationId, msg.userId, msg.projectId, msg.featureName);
          } else if (msg.scope === 'preview-stop') {
            // Single-serverKey stop fanned out so the OWNING pod reaps its
            // live handles. No-op on non-owning pods (the broadcast reaches
            // every pod). See PreviewService.publishPreviewStop.
            if (!msg.featureName) {
              throw new Error('cleanup request scope=preview-stop missing featureName');
            }
            await this.previewService.stopPreviewIfOwned(msg.organizationId, msg.userId, msg.projectId, msg.featureName);
          }
          const ack: CleanupAckPayload = { requestId: msg.requestId, source: 'preview', success: true };
          await this.stateStore.publish(REDIS_KEYS.LIFECYCLE.CLEANUP_ACK, ack);
        } catch (err: any) {
          logger.warn('[PreviewServer] cleanup request failed', { component: 'PreviewServer' }, { requestId: msg.requestId, err });
          const ack: CleanupAckPayload = {
            requestId: msg.requestId,
            source: 'preview',
            success: false,
            error: err?.message ?? String(err),
          };
          await this.stateStore.publish(REDIS_KEYS.LIFECYCLE.CLEANUP_ACK, ack);
        }
      },
    );

    // Register the post-code-job connections-refresh subscriber. finalizeTerminalJob
    // (API) publishes on `ant:lifecycle:connections:refresh` after a code job
    // completes; we re-detect from the FINAL code so the preview panel no longer
    // shows the snapshot cached early in the job. Fire-and-forget (no ack), and
    // best-effort — a failure here never affects job teardown.
    this.connectionsRefreshUnsubscribe = await this.stateStore.subscribe(
      REDIS_KEYS.LIFECYCLE.CONNECTIONS_REFRESH,
      async (raw: any) => {
        const msg = raw as
          | { organizationId?: string; userId?: string; projectId?: string; feature?: string }
          | undefined;
        if (!msg || !msg.organizationId || !msg.userId || !msg.projectId || !msg.feature) {
          logger.warn('[PreviewServer] Ignored malformed connections-refresh request', { component: 'PreviewServer' }, { msg });
          return;
        }
        try {
          const connections = await this.refreshProjectFacts(
            { organizationId: msg.organizationId, userId: msg.userId },
            msg.projectId,
            msg.feature,
          );
          logger.info(
            `[PreviewServer] Connections refreshed post-job: ${connections.length} for ${msg.projectId}/${msg.feature}`,
            { component: 'PreviewServer' },
          );
        } catch (err: any) {
          logger.warn('[PreviewServer] connections-refresh request failed', { component: 'PreviewServer' }, { projectId: msg.projectId, err: err?.message ?? String(err) });
        }
      },
    );

    logger.info('[PreviewServer] Services initialized', {
      component: 'PreviewServer'
    });
  }

  /**
   * Get Pod IP for K8s multi-replica support
   */
  private getPodHost(): string {
    const podIp = process.env.POD_IP;
    if (podIp) {
      return podIp;
    }
    
    try {
      const interfaces = os.networkInterfaces();
      for (const [name, ifaces] of Object.entries(interfaces)) {
        if (!ifaces) continue;
        for (const iface of ifaces) {
          if (iface.internal || iface.family !== 'IPv4') continue;
          if (name === 'eth0' || name.startsWith('en')) {
            return iface.address;
          }
        }
      }
      for (const ifaces of Object.values(interfaces)) {
        if (!ifaces) continue;
        for (const iface of ifaces) {
          if (iface.internal || iface.family !== 'IPv4') continue;
          return iface.address;
        }
      }
    } catch {
      // Ignore
    }
    
    return 'localhost';
  }

  /**
   * Resolve a feature's codebase path.
   *
   * Delegates to the `WorkspaceResolver` SSOT: a project has no codebase of its
   * own (bare anchor + linked worktrees), so `feature` is required, and the
   * resolver owns slugging, the single-segment backstop, and the
   * `repoType:'local'` short-circuit to the user-owned path.
   *
   * This used to fork on `feature !== 'main'` and fall back to a project-level
   * `{project}/codebase` — a layout the bare-anchor model removed. Since clone
   * auto-creates a feature named after the remote HEAD branch (`main` for most
   * repos), that fork pointed the modal case at a nonexistent directory and
   * preview died with a misleading "No recognized project files found".
   */
  private resolveWorkspacePath(
    userContext: { organizationId: string; userId: string },
    projectId: string,
    feature: string
  ): string {
    return this.workspaceResolver.getCodebasePath(userContext, projectId, feature);
  }

  /**
   * Re-detect this project's FACTS — service connections plus the project
   * profile / structureType — from the CURRENT code, and overwrite the derived
   * caches (+ the live PreviewState if running).
   *
   * SINGLE source shared by the `detect-connections` endpoint (Auto Detect
   * button) AND the post-code-job `CONNECTIONS_REFRESH` subscriber, so the
   * post-job panel reflects the FINAL code rather than the snapshot cached early
   * in the job. The channel constant keeps its name (cross-process contract);
   * only this handler's responsibility widened. Best-effort throughout: a
   * missing workspace or detection failure yields [] and leaves the profile
   * untouched.
   */
  private async refreshProjectFacts(
    userContext: { organizationId: string; userId: string },
    projectId: string,
    feature: string,
  ): Promise<import('../../core/ports/portRegistry').ServiceConnection[]> {
    const serverKey = `${userContext.organizationId}:${userContext.userId}:${projectId}:${feature}`;
    const workspacePath = this.resolveWorkspacePath(userContext, projectId, feature);
    if (!fs.existsSync(workspacePath)) {
      return [];
    }

    const facts = await this.detectProjectFacts(userContext, projectId, feature);

    let connections: import('../../core/ports/portRegistry').ServiceConnection[] = [];
    if (facts?.structure) {
      // Reuse the structure the profile detector already produced — one
      // filesystem pass, not two.
      const connectionDetector = new ConnectionDetector();
      connections = connectionDetector.detect(workspacePath, facts.structure, serverKey);
    } else {
      logger.warn(`[PreviewServer] Structure detection yielded nothing, clearing connections for ${serverKey}`, { component: 'PreviewServer' });
    }

    // Structure sync (gen-code backstop): ensure `.env` has a key for every
    // connection declared in `.env.example` (fill-if-absent, values preserved).
    // Fires on the post-code-job CONNECTIONS_REFRESH + the Auto-Detect button, so
    // a connection the code job just declared materializes into the runtime `.env`
    // without clobbering any user-entered value. Deletion is not done here.
    try {
      const sources = new Set(
        connections.map(c => (c.source && c.source !== '*' ? c.source : '')),
      );
      for (const subdir of sources) {
        const pkgDir = resolveConnectionDir(workspacePath, subdir);
        const framework = toToggleFramework(detectFramework(pkgDir));
        syncEnvStructureFromExample(
          envTarget(workspacePath, pkgDir, '.env.example'),
          envTarget(workspacePath, pkgDir, '.env'),
          framework,
        );
      }
    } catch (syncErr: any) {
      logger.warn(`[PreviewServer] Env structure sync failed: ${syncErr.message}`, { component: 'PreviewServer' });
    }

    // Enrich docker connections with live infrastructure status
    const infraManager = new InfrastructureManager();
    const infraProjectName = `ant-${projectId}-${feature}`.replace(/[^a-zA-Z0-9_-]/g, '-');
    const infraStatus = await infraManager.getInfraStatus(workspacePath, infraProjectName);
    if (infraStatus.length > 0) {
      for (const conn of connections) {
        const isDocker = typeof conn.resolution === 'object' && conn.resolution?.type === 'docker';
        if (isDocker) {
          const dockerService = (conn.resolution as { type: 'docker'; service: string }).service || conn.id;
          const svc = infraStatus.find(s =>
            s.name === dockerService || conn.id.includes(s.name) || s.name.includes(conn.id)
          );
          conn.status = svc?.status === 'running' ? 'active'
                      : svc?.status === 'stopped' ? 'stopped'
                      : svc ? 'error' : conn.status;
        }
      }
    }

    // Enrich ant-project connections with target preview status
    for (const conn of connections) {
      const isAntProject = typeof conn.resolution === 'object' && conn.resolution?.type === 'ant-project';
      if (isAntProject) {
        const r = conn.resolution as { type: 'ant-project'; projectId: string; feature: string };
        try {
          const targetState = await this.stateStore.getPreview(
            userContext.organizationId, userContext.userId, r.projectId, r.feature
          );
          conn.status = targetState?.running && targetState?.ready ? 'active'
                      : targetState?.running ? 'starting'
                      : 'stopped';
        } catch { conn.status = 'error'; }
      }
    }

    // `.env.example` (structure) + `.env` (value/toggle) are the SSOT; detection
    // reads both, so the result faithfully reflects the files — no overlay/merge
    // and no clobber (the value round-trips through `.env`). Redis preview-config
    // is a derived cache refreshed here (strip runtime status — PREVIEW state owns it).
    const configConnections = connections.map(({ status, ...rest }: any) => rest);
    await this.stateStore.savePreviewConfig(
      userContext.organizationId,
      userContext.userId,
      projectId,
      feature,
      {
        connections: configConnections,
        // Same contract as connections: the codebase is the SSOT and this key is
        // the derived cache.
        ...observedFactsPatch(facts),
      }
    );

    // Also update PreviewState if preview is currently running
    try {
      const currentState = await this.previewService.getPreviewStatus(
        userContext.organizationId, userContext.userId, projectId, feature
      );
      if (currentState.running) {
        await this.stateStore.updatePreview(
          userContext.organizationId, userContext.userId, projectId, feature,
          { connections, ...observedFactsPatch(facts) }
        );
      }
    } catch { /* best-effort */ }

    // Push the refreshed facts so an open Preview Config panel updates without a
    // reload (the post-code-job case the user actually observes).
    if (facts) {
      this.previewService.broadcastProjectFacts(
        userContext.organizationId, userContext.userId, projectId, feature,
        { structureType: facts.structureType, projectProfile: facts.profile, canStart: facts.canStart },
      );
    }

    return connections;
  }

  /**
   * Observe the project facts for a feature's codebase. The codebase is the
   * SSOT; Redis holds only derived caches. Cheap enough to run per request —
   * detection reads manifests only, never source or `node_modules`.
   */
  private async detectProjectFacts(
    userContext: { organizationId: string; userId: string },
    projectId: string,
    feature: string,
    fallback?: ProjectProfile,
  ): Promise<DetectedProjectFacts | null> {
    try {
      const workspacePath = this.resolveWorkspacePath(userContext, projectId, feature);
      if (!fs.existsSync(workspacePath)) return null;
      return await new ProjectProfileDetector().detectFacts(workspacePath, fallback);
    } catch (err: any) {
      logger.warn(`[PreviewServer] Project facts detection failed: ${err?.message ?? err}`, { component: 'PreviewServer' });
      return null;
    }
  }

  /**
   * Mark the running preview as needing a restart to apply a just-saved
   * connection/toggle change. Env is captured at spawn time, so a config/.env
   * write does not reach the live dev server until it re-spawns. The FE reads
   * `PreviewState.restartRequired` to surface a "restart to apply" hint on the
   * existing Restart control. No-op when the preview is not running (the next
   * start injects fresh env anyway). Best-effort.
   */
  private async markRestartRequiredIfRunning(
    userContext: { organizationId: string; userId: string },
    projectId: string,
    feature: string,
  ): Promise<boolean> {
    try {
      const status = await this.previewService.getPreviewStatus(
        userContext.organizationId, userContext.userId, projectId, feature
      );
      if (status.running) {
        await this.stateStore.updatePreview(
          userContext.organizationId, userContext.userId, projectId, feature,
          { restartRequired: true }
        );
        return true;
      }
    } catch { /* best-effort — never block the save response */ }
    return false;
  }

  /**
   * Catch-all 404, shared by both listeners.
   *
   * A peer-forwarded request reaching the catch-all means the owner pod failed to
   * recognize its own preview host — always-on diagnostic, since this exact silent
   * 404 previously masked a lost-Host routing defect.
   */
  private notFoundHandler(listener: 'content' | 'control') {
    return (req: Request, res: Response): void => {
      if (isSubdomainRouting() && req.headers[PREVIEW_PEER_FORWARD_HEADER] === '1') {
        logger.warn(
          `[PreviewServer] Peer-forwarded request missed all proxies (catch-all 404 on ${listener}): ` +
          `host=${req.headers.host} xfh=${req.headers['x-forwarded-host'] ?? '(none)'} ` +
          `previewBase=${getPreviewBaseDomain() ?? '(unset)'} deployBase=${getDeployBaseDomain() ?? '(unset)'} url=${req.url}`,
          { component: 'PreviewServer' },
        );
      }
      res.status(404).json({
        error: 'Not Found',
        message: 'Preview endpoint not found',
      });
    };
  }

  /**
   * Wire both listeners.
   *
   * ## Why there are two
   * This process does two jobs that must not share a browser origin. It serves
   * USER CONTENT — a public deploy's built output, a user's own dev server — and
   * it exposes a cookie-authenticated CONTROL PLANE (`/projects/*`), which can
   * write a feature's `.env` and start/stop previews. On one origin, script in a
   * deployed SVG or HTML page runs same-origin with that API and drives it with
   * the viewer's session; no CSP or SVG filter fixes that, because the sink is the
   * browser's own origin model (H-NEW-001).
   *
   * So content gets its own listener with no control-plane route on it, and the
   * control plane keeps `PORT`. `isSelfOrigin` compares full origins (scheme, host
   * AND port), and `sameOriginGuard` refuses cookie-authenticated state changes
   * that did not originate same-origin — so reaching the control plane from the
   * content origin is neither same-origin nor CORS-allowed.
   *
   * Control-plane middleware order is load-bearing: cookie-parser → JWT →
   * body parser. The 50 MB JSON parser used to run BEFORE authentication, so an
   * unauthenticated request could make the process buffer and parse 50 MB before
   * being told 401 (M-010).
   */
  private setupRoutes(): void {
    this.setupContentRoutes();
    this.setupControlRoutes();
  }

  /**
   * Content listener: preview proxy, deploy proxy, nothing else.
   *
   * Deliberately has no cookie-parser, no JWT middleware and no body parser. The
   * proxies read the raw Cookie header themselves for their own owner gates, and
   * neither needs a parsed body.
   */
  private setupContentRoutes(): void {
    if (process.env.NODE_ENV === 'production') {
      this.contentApp.set('trust proxy', 1);
    }
    this.contentApp.use(helmet({
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      contentSecurityPolicy: false,
    }));

    // Liveness only — no state, no auth. The control listener owns the detailed
    // `/health`; this exists so the content port can be probed independently.
    this.contentApp.get('/health', (_req: Request, res: Response) => {
      res.json({ healthy: true, service: 'ant-preview-content' });
    });

    // 4. Preview Proxy - MUST be before body parsers and JWT auth
    // Owner-only access: previews are gated on the owning tenant/user via the
    // JWT cookie (undefined jwtService in local mode → owner-accessible). The
    // proxy runs before cookie-parser, so it parses the raw Cookie header
    // itself. Routes: /:urlKey/* where urlKey = tenantId--userId--projectId--feature
    this.contentApp.use(createPreviewProxyMiddleware({
      portRegistry: this.stateStore,
      pathPrefix: '',
      getBackendPort: async ({ tenantId, userId, projectId, feature }) => {
        const state = await this.stateStore.getPreview(tenantId, userId, projectId, feature);
        return state?.backendPort || null;
      },
      // Self-heal: rehydrate the dev server on THIS pod (spawn-only, from the
      // shared EFS workspace) when a request lands on a non-owner replica whose
      // owner is unreachable cross-pod. The preview twin of deploy's ensureRunning.
      ensureRunning: ({ tenantId, userId, projectId, feature }) =>
        this.previewService.ensureRunning(
          tenantId, userId, projectId, feature,
          this.resolveWorkspacePath({ organizationId: tenantId, userId }, projectId, feature),
        ),
      // Local-first: this pod's own instance (pod-local spawn facts) wins over
      // the shared Redis record — no owner-forward probe, no cross-pod fetch.
      getLocal: ({ tenantId, userId, projectId, feature }) =>
        this.previewService.getLocalPreview(tenantId, userId, projectId, feature),
      jwtService: createJwtServiceFromEnv(),
      cookieName: JwtService.cookieName,
    }));

    // 4b. Deploy proxy — serves deployed static builds via /deploy/:urlKey/*
    // Public deploys serve without auth; private deploys gate on the owning
    // tenant/user via the JWT cookie (undefined jwtService in local mode →
    // owner-accessible). The proxy runs before cookie-parser, so it parses the
    // raw Cookie header itself.
    const deployProxy = createDeployProxyMiddleware({
      ensureRunning: (t, u, p, f) => this.deployService.ensureRunning(t, u, p, f),
      touchDeploy: (t, u, p, f) => this.stateStore.touchDeploy(t, u, p, f),
      updateDeploy: (t, u, p, f, patch) => this.stateStore.updateDeploy(t, u, p, f, patch as any),
      broadcastStatus: (t, u, p, f, status) => this.deployService.broadcastStatus(t, u, p, f, status as any),
      jwtService: createJwtServiceFromEnv(),
      cookieName: JwtService.cookieName,
      // Subdomain routing: resolve a deploy Host label to its coordinates.
      resolveLabel: (label) => this.deployService.resolveDeployLabel(label),
      // Custom-domain routing (deploy-only): resolve a user-owned Host.
      resolveCustomDomain: (host) => this.deployService.resolveCustomDomain(host),
    });
    // Path routing mounts deploy at `/deploy/`; subdomain routing serves deploy
    // apps at their own host root, so the proxy must be a root catch-all (it
    // self-gates on the deploy base domain and defers other hosts via next()).
    if (isSubdomainRouting()) {
      this.contentApp.use(deployProxy);
    } else {
      this.contentApp.use('/deploy/', deployProxy);
    }

    this.contentApp.use(this.notFoundHandler('content'));
  }

  /** Control listener: management API only. */
  private setupControlRoutes(): void {
    if (process.env.NODE_ENV === 'production') {
      this.app.set('trust proxy', 1);
    }

    // Shared CORS configuration (same as ant-api and ant-realtime). Exact-origin,
    // so the content listener's origin is NOT auto-allowed here.
    this.app.use(createCorsMiddleware());

    this.app.use(helmet({
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      contentSecurityPolicy: false,
    }));

    // Health check (before auth). Uses the O(1) SCARD count — never enumerates
    // the whole preview registry — and is rate-limited per IP so anonymous
    // polling cannot amplify (M-NEW-020).
    this.app.get('/health', healthRateLimiter, async (_req: Request, res: Response) => {
      const activeInstances = await this.stateStore.countPreviews();
      res.json({
        healthy: true,
        service: 'ant-preview',
        activeInstances,
        timestamp: new Date().toISOString()
      });
    });

    // Custom-domain TLS ask endpoint (Caddy on-demand TLS).
    // Caddy pauses the TLS handshake for an unknown SNI and asks here whether a
    // certificate may be issued. Answer 200 ONLY for a verified (`active`)
    // custom domain whose target deploy is alive — this is the abuse gate that
    // stops arbitrary domains from triggering Let's Encrypt issuance. Mounted
    // before the proxies + auth so it is reachable without a session. Internal
    // only (NetworkPolicy); an optional shared secret adds defense-in-depth.
    this.app.get('/internal/tls-ask', async (req: Request, res: Response) => {
      const secret = process.env.ANT_TLS_ASK_SECRET;
      if (secret && req.headers['x-ant-tls-ask-secret'] !== secret) {
        res.status(403).end();
        return;
      }
      const domain = String(req.query.domain || '').split(':')[0].toLowerCase().replace(/\.$/, '');
      if (!domain) { res.status(400).end(); return; }
      const coords = await this.deployService.resolveCustomDomain(domain);
      if (!coords) { res.status(404).end(); return; }
      const state = await this.deployService.ensureRunning(
        coords.tenantId, coords.userId, coords.projectId, coords.feature,
      );
      if (!state) { res.status(404).end(); return; }
      res.status(200).end();
    });


    // Cookie parser (required for JWT cookie auth)
    this.app.use(cookieParser());

    // JWT cookie authentication (cloud mode only) — BEFORE the body parser.
    // Every route on this listener requires a session, and a 50 MB JSON parse is
    // real work: running it first let an unauthenticated client make the process
    // buffer and parse 50 MB per request before learning it was 401 (M-010). No
    // route here has an unauthenticated body, so nothing needs a public parser.
    const isCloudMode = this.options.mode === 'cloud' || process.env.ANT_SERVER_MODE === 'cloud';
    if (isCloudMode) {
      const jwtService = createJwtServiceFromEnv();
      if (!jwtService) {
        throw new Error(
          'A JWT verification key is required in cloud mode: set ANT_JWT_PUBLIC_KEY (recommended) or ANT_JWT_SECRET.',
        );
      }
      this.app.use(createJwtAuthMiddleware({
        jwtService,
        // Both are GET-only routes. Method-aware so a POST to either does not
        // skip auth and reach the 50MB body parser mounted below (M-010).
        publicPaths: [
          { path: '/health', methods: ['GET'] },
          { path: '/internal/tls-ask', methods: ['GET'] },
        ],
        publicPrefixes: [],
      }));
      // Cookie-authenticated state changes must originate from an allowed origin.
      // The content listener is a different origin, so a document served there
      // cannot drive this API with the viewer's session (H-NEW-001).
      this.app.use(createSameOriginGuard());
      logger.info('JWT authentication enabled for Preview Server', { component: 'PreviewServer' });
    }

    // Body parser for API routes — after authentication, by design (see above).
    this.app.use(express.json({ limit: '50mb' }));

    // 8. Rate limiting for management API (after auth)
    // Bootstrap-time init of every rate limiter — MUST run before the
    // limiter middleware is mounted onto the router, otherwise the
    // no-op proxy logs a passthrough warning. InfrastructureFactory is
    // already initialized at this point (see `initialize()` above).
    initializeRateLimiters();
    this.app.use('/projects/', previewRateLimiter);

    // ==========================================
    // Preview Management API
    // ==========================================

    /**
     * POST /preview/projects/:id/start
     * Start preview for a project
     */
    this.app.post('/projects/:id/start', async (req: Request, res: Response) => {
      try {
        const projectId = req.params.id;
        const userContext = extractUserContext(req);
        const feature = requireFeature(req, res);
        if (!feature) return;
        const port = req.body?.port;
        const forceRestart = req.body?.forceRestart !== false;

        logger.warn(`[PreviewServer] POST /projects/${projectId}/start (user=${userContext.userId}, feature=${feature})`, {
          component: 'PreviewServer'
        });

        const workspacePath = this.resolveWorkspacePath(userContext, projectId, feature);

        const result = await this.previewService.startPreview(
          userContext.organizationId,
          userContext.userId,
          projectId,
          feature,
          workspacePath,
          port,
          forceRestart
        );

        if (result.success) {
          res.json(result);
        } else {
          res.status(400).json(result);
        }
      } catch (error: any) {
        logger.error('[PreviewServer] Start error', { component: 'PreviewServer' }, error);
        sendErrorResponse(res, 500, error, 'PreviewServer');
      }
    });

    /**
     * POST /preview/projects/:id/stop
     * Stop preview for a project
     */
    this.app.post('/projects/:id/stop', async (req: Request, res: Response) => {
      try {
        const projectId = req.params.id;
        const userContext = extractUserContext(req);
        const feature = requireFeature(req, res);
        if (!feature) return;

        logger.warn(`[PreviewServer] POST /projects/${projectId}/stop (user=${userContext.userId}, feature=${feature})`, {
          component: 'PreviewServer'
        });

        const result = await this.previewService.stopPreview(
          userContext.organizationId,
          userContext.userId,
          projectId,
          feature
        );

        res.json(result);
      } catch (error: any) {
        logger.error('[PreviewServer] Stop error', { component: 'PreviewServer' }, error);
        sendErrorResponse(res, 500, error, 'PreviewServer');
      }
    });

    /**
     * GET /preview/projects/:id/status
     * Get preview status for a project
     */
    this.app.get('/projects/:id/status', async (req: Request, res: Response) => {
      try {
        const projectId = req.params.id;
        const userContext = extractUserContext(req);
        const feature = requireFeature(req, res);
        if (!feature) return;
        // getPreviewStatus reads from Redis (source of truth), with local memory fallback.
        // This guarantees consistent state across pods in multi-pod deployments.
        // status.url and status.packages[].url already obey the multi-frontend
        // contract (top-level url=null when 2+ frontends; per-package url for each).
        const status = await this.previewService.getPreviewStatus(
          userContext.organizationId,
          userContext.userId,
          projectId,
          feature
        );

        // Logs are only available on the owning pod (stored in local memory)
        const logs = this.previewService.getPreviewLogs(
          userContext.organizationId,
          userContext.userId,
          projectId,
          feature
        );

        // Observe the codebase unconditionally — the project's identity does not
        // depend on whether a preview happens to be running. Only `canStart` is
        // gated on busyness (see `resolveProjectFacts`). Gating detection itself
        // is what made the profile disappear mid-start and flip across a
        // start/stop cycle.
        const cachedConfig = await this.stateStore
          .getPreviewConfig(userContext.organizationId, userContext.userId, projectId, feature)
          .catch(() => null);
        const detected = await this.detectProjectFacts(
          userContext, projectId, feature, cachedConfig?.projectProfile ?? undefined,
        );
        const isBusy = status.running || status.phase === 'installing' || status.phase === 'starting';
        const facts = resolveProjectFacts({
          detected,
          runtime: { structureType: status.structureType as any, projectProfile: status.projectProfile },
          cached: cachedConfig,
          isBusy,
        });

        res.json({
          running: status.running,
          ready: status.ready,
          port: status.port || null,
          url: status.url ?? null,
          processCount: status.processCount || 0,
          backendPort: status.backendPort || null,
          packages: status.packages || [],
          issues: status.issues || [],
          phase: status.phase,
          error: status.error,
          setupReasoning: status.setupReasoning,
          setupReason: status.setupReason,
          suggestedFix: status.suggestedFix,
          structureType: facts.structureType,
          projectProfile: facts.projectProfile,
          connections: status.connections || [],
          restartRequired: status.restartRequired ?? false,
          canStart: facts.canStart,
          logs: logs.slice(-50)
        });
      } catch (error: any) {
        logger.error('[PreviewServer] Status error', { component: 'PreviewServer' }, error);
        sendErrorResponse(res, 500, error, 'PreviewServer');
      }
    });

    /**
     * GET /preview/projects/:id/validate
     * Validate preview setup
     */
    this.app.get('/projects/:id/validate', async (req: Request, res: Response) => {
      try {
        const projectId = req.params.id;
        const userContext = extractUserContext(req);

        const feature = requireFeature(req, res);
        if (!feature) return;
        const workspacePath = this.resolveWorkspacePath(userContext, projectId, feature);
        const result = await this.previewService.validatePreviewSetup(workspacePath);

        res.json({
          valid: result.valid,
          reason: result.reason,
          suggestedFix: result.suggestedFix
        });
      } catch (error: any) {
        logger.error('[PreviewServer] Validate error', { component: 'PreviewServer' }, error);
        sendErrorResponse(res, 500, error, 'PreviewServer');
      }
    });

    // ==========================================
    // Preview Config Endpoints
    // ==========================================

    /**
     * GET /preview/projects/:id/preview-config
     * Get preview configuration (connections, structureType, projectProfile).
     *
     * The codebase is the SSOT for all three: connections come from
     * `.env.example` / `.env`, and the profile / structureType from the project
     * manifests. Redis is a derived cache, refreshed here. This endpoint and
     * `GET /status` share `resolveProjectFacts`, so the two can never disagree.
     */
    this.app.get('/projects/:id/preview-config', async (req: Request, res: Response) => {
      try {
        const projectId = req.params.id;
        const userContext = extractUserContext(req);
        const feature = requireFeature(req, res);
        if (!feature) return;
        const serverKey = `${userContext.organizationId}:${userContext.userId}:${projectId}:${feature}`;

        const config = await this.stateStore.getPreviewConfig(
          userContext.organizationId,
          userContext.userId,
          projectId,
          feature
        );

        const status = await this.previewService.getPreviewStatus(
          userContext.organizationId,
          userContext.userId,
          projectId,
          feature
        );

        const detected = await this.detectProjectFacts(
          userContext, projectId, feature, config?.projectProfile ?? undefined,
        );
        const isBusy = status.running || status.phase === 'installing' || status.phase === 'starting';
        const facts = resolveProjectFacts({
          detected,
          runtime: { structureType: status.structureType as any, projectProfile: status.projectProfile },
          cached: config,
          isBusy,
        });

        // Cached connections are the fallback when the workspace or its structure
        // is transiently unavailable — never overwrite them with an empty list.
        let connections = config?.connections || [];
        if (detected?.structure) {
          try {
            const workspacePath = this.resolveWorkspacePath(userContext, projectId, feature);
            const connectionDetector = new ConnectionDetector();
            connections = connectionDetector.detect(workspacePath, detected.structure, serverKey);
            await this.stateStore.savePreviewConfig(
              userContext.organizationId, userContext.userId, projectId, feature,
              { connections, ...observedFactsPatch(detected) }
            );
          } catch (detectErr: any) {
            logger.warn(`[PreviewServer] Connection detect failed, using cached config: ${detectErr.message}`, { component: 'PreviewServer' });
          }
        }

        res.json({
          structureType: facts.structureType,
          projectProfile: facts.projectProfile,
          connections,
        });
      } catch (error: any) {
        logger.error('[PreviewServer] Preview config get error', { component: 'PreviewServer' }, error);
        sendErrorResponse(res, 500, error, 'PreviewServer');
      }
    });

    /**
     * PUT /preview/projects/:id/preview-config
     * Save preview configuration (connections).
     * Validates resolution type constraints and auto-computes ant-project proxy paths.
     */
    this.app.put('/projects/:id/preview-config', async (req: Request, res: Response) => {
      try {
        const projectId = req.params.id;
        const userContext = extractUserContext(req);
        const feature = requireFeature(req, res);
        if (!feature) return;
        const { connections } = req.body;

        // Validate resolution type constraints
        const VALID_RESOLUTIONS: Record<string, string[]> = {
          infrastructure: ['url', 'docker'],
          business: ['url', 'ant-project'],
        };
        for (const conn of (connections || [])) {
          const allowed = VALID_RESOLUTIONS[conn.category];
          if (allowed && conn.resolution?.type && !allowed.includes(conn.resolution.type)) {
            res.status(400).json({
              error: `Invalid resolution type '${conn.resolution.type}' for category '${conn.category}'. Allowed: ${allowed.join(', ')}`,
              envVar: conn.envVar,
            });
            return;
          }
        }

        // Validate `source` BEFORE persisting: it is the subdirectory this
        // service later joins onto the workspace root to write `.env` /
        // `.env.example`, so a `../` source would steer those writes out of the
        // caller's workspace. Rejecting at save time also means no escaping
        // value is ever stored in Redis for a later write to pick up.
        for (const conn of (connections || [])) {
          try {
            resolveConnectionDir(this.resolveWorkspacePath(userContext, projectId, feature), conn.source);
          } catch (err: any) {
            res.status(400).json({ error: err.message, envVar: conn.envVar });
            return;
          }
        }

        // Resolve ant-project connections: compute resolvedUrlKey and proxy path.
        // A service-less connection (e.g. `self`) resolves to the whole-backend
        // proxy path — see resolveConnectionForSave for the serviceName guard.
        const resolvedConnections = (connections || []).map((conn: any) =>
          resolveConnectionForSave(conn, {
            projectId,
            feature,
            organizationId: userContext.organizationId,
            userId: userContext.userId,
          }),
        );

        // Strip runtime status before persisting (status is transient, belongs in PREVIEW state only)
        const configConnections = resolvedConnections.map(({ status, ...rest }: any) => rest);

        // Snapshot previous connections (before overwrite) to detect removals —
        // a connection dropped from the panel must have its annotation removed.
        const prevConfig = await this.stateStore.getPreviewConfig(
          userContext.organizationId, userContext.userId, projectId, feature,
        );
        const newIds = new Set(configConnections.map((c: any) => c.id));
        const removedConns = (prevConfig?.connections ?? []).filter((c: any) => !newIds.has(c.id));

        await this.stateStore.savePreviewConfig(
          userContext.organizationId,
          userContext.userId,
          projectId,
          feature,
          { connections: configConnections }
        );
        // Deterministically persist annotations to .env.example + mirror to .env
        // — the write side of panel Save, replacing the Fix → LLM code-job round-trip.
        const workspacePath = this.resolveWorkspacePath(userContext, projectId, feature);
        if (fs.existsSync(workspacePath)) {
          for (const conn of configConnections) {
            const pkgDir = resolveConnectionDir(workspacePath, conn.source);
            const framework = toToggleFramework(detectFramework(pkgDir));
            upsertConnectionAnnotation(envTarget(workspacePath, pkgDir, '.env.example'), conn, framework);
            mirrorConnectionToEnv(envTarget(workspacePath, pkgDir, '.env'), conn, framework);
          }
          for (const conn of removedConns) {
            const pkgDir = resolveConnectionDir(workspacePath, conn.source);
            // Structure delete: drop the annotation from .env.example AND the
            // value/toggle keys from .env (explicit removal knows the envVar,
            // so this is the one safe place to delete .env keys).
            removeConnectionAnnotation(envTarget(workspacePath, pkgDir, '.env.example'), conn);
            const envPath = envTarget(workspacePath, pkgDir, '.env');
            removeEnvKey(envPath, conn.envVar);
            if (conn.virtualization?.toggleEnvVar) {
              const framework = toToggleFramework(detectFramework(pkgDir));
              const prefix = frameworkTogglePrefix(framework);
              removeEnvKey(envPath, conn.virtualization.toggleEnvVar);
              if (prefix) removeEnvKey(envPath, `${prefix}${conn.virtualization.toggleEnvVar}`);
            }
          }
        }

        const restartRequired = await this.markRestartRequiredIfRunning(userContext, projectId, feature);

        logger.info(`[PreviewServer] Preview config saved: ${projectId}/${feature} (${resolvedConnections.length} connections)`, { component: 'PreviewServer' });
        res.json({ success: true, connections: resolvedConnections, restartRequired });
      } catch (error: any) {
        logger.error('[PreviewServer] Preview config save error', { component: 'PreviewServer' }, error);
        sendErrorResponse(res, 500, error, 'PreviewServer');
      }
    });

    /**
     * POST /preview/projects/:id/detect-connections
     * Re-scan project files for connections and overwrite the registry.
     * Used by the "Auto Detect" button in Config UI.
     */
    this.app.post('/projects/:id/detect-connections', async (req: Request, res: Response) => {
      try {
        const projectId = req.params.id;
        const userContext = extractUserContext(req);
        const feature = requireFeature(req, res);
        if (!feature) return;

        const workspacePath = this.resolveWorkspacePath(userContext, projectId, feature);
        if (!fs.existsSync(workspacePath)) {
          res.status(404).json({ error: 'Project workspace not found', path: workspacePath });
          return;
        }

        const connections = await this.refreshProjectFacts(userContext, projectId, feature);
        logger.info(`[PreviewServer] Detect-connections: found ${connections.length} for ${projectId}/${feature}`, { component: 'PreviewServer' });
        res.json({ success: true, connections });
      } catch (error: any) {
        logger.error('[PreviewServer] Detect connections error', { component: 'PreviewServer' }, error);
        sendErrorResponse(res, 500, error, 'PreviewServer');
      }
    });

    // ==========================================
    // Deploy Management API (JWT-authenticated)
    // ==========================================

    /**
     * POST /projects/:id/deploy
     * Start build and deploy (non-blocking). Returns 202 immediately;
     * build progress and final status are delivered via SSE 'deploy' events.
     *
     * Deploy is feature-scoped, so a request without a feature is rejected with
     * 400. No feature NAME is privileged — under the bare-anchor model branch ==
     * feature, so `main` is an ordinary feature (and is the one clone
     * auto-creates). Requests issued while a code job is writing files on this
     * feature are rejected with 409 — DeployService surfaces this via
     * `reason === 'code-job-active'`.
     */
    this.app.post('/projects/:id/deploy', async (req: Request, res: Response) => {
      try {
        const projectId = req.params.id;
        const userContext = extractUserContext(req);
        const feature = req.body?.feature;

        if (!feature) {
          res.status(400).json({
            success: false,
            reason: 'feature-required',
            message: 'A feature is required — deploy is feature-scoped',
          });
          return;
        }

        // Free-tier gate: preview is open to all, deploy requires a paid plan.
        // Billing-guarded so local/OSS (noop ledger reports 'free') keeps deploy open.
        if (isBillingEnabled()) {
          try {
            const bal = await getInfrastructureFactory()
              .getCreditLedger()
              .getBalance(userContext.organizationId, userContext.userId);
            if (bal.tier === 'free') {
              res.status(403).json({
                success: false,
                reason: 'tier-not-allowed',
                message: 'Deploy requires Pro or Max. Preview is free for all tiers.',
              });
              return;
            }
          } catch (err) {
            logger.warn('[PreviewServer] deploy tier check failed — rejecting', { component: 'PreviewServer' }, err as any);
            res.status(500).json({ success: false, reason: 'internal-error', message: 'Tier verification failed.' });
            return;
          }
        }

        logger.warn(`[PreviewServer] POST /projects/${projectId}/deploy (user=${userContext.userId}, feature=${feature})`, {
          component: 'PreviewServer'
        });

        // Whitelist the visibility input — never trust the raw body value.
        const visibility = req.body?.visibility === 'private' ? 'private' : 'public';

        const codebasePath = this.resolveWorkspacePath(userContext, projectId, feature);
        const result = await this.deployService.startDeploy(
          userContext.organizationId,
          userContext.userId,
          projectId,
          feature,
          codebasePath,
          visibility
        );

        if (result.success) {
          res.status(202).json(result);
          return;
        }

        // Map failure reasons to HTTP status codes. 409 for the one that
        // is transient (resolves when the code job ends); 400 for the
        // rest (validation failures the caller must fix before retrying).
        const status = result.reason === 'code-job-active' ? 409 : 400;
        res.status(status).json(result);
      } catch (error: any) {
        logger.error('[PreviewServer] Deploy error', { component: 'PreviewServer' }, error);
        sendErrorResponse(res, 500, error, 'PreviewServer');
      }
    });

    /**
     * POST /projects/:id/deploy/stop
     * Stop a running deploy. Only valid for feature branches.
     */
    this.app.post('/projects/:id/deploy/stop', async (req: Request, res: Response) => {
      try {
        const projectId = req.params.id;
        const userContext = extractUserContext(req);
        const feature = req.body?.feature;

        if (!feature) {
          res.status(400).json({
            success: false,
            reason: 'feature-required',
            message: 'A feature is required — deploy is feature-scoped',
          });
          return;
        }

        const result = await this.deployService.stopDeploy(
          userContext.organizationId,
          userContext.userId,
          projectId,
          feature
        );

        res.json(result);
      } catch (error: any) {
        logger.error('[PreviewServer] Deploy stop error', { component: 'PreviewServer' }, error);
        sendErrorResponse(res, 500, error, 'PreviewServer');
      }
    });

    /**
     * GET /projects/:id/deploy/status
     * Get deploy status. Only valid for feature branches.
     */
    this.app.get('/projects/:id/deploy/status', async (req: Request, res: Response) => {
      try {
        const projectId = req.params.id;
        const userContext = extractUserContext(req);
        const feature = req.query.feature as string | undefined;

        if (!feature) {
          res.status(400).json({
            success: false,
            reason: 'feature-required',
            message: 'A feature is required — deploy is feature-scoped',
          });
          return;
        }

        const status = await this.deployService.getStatus(
          userContext.organizationId,
          userContext.userId,
          projectId,
          feature
        );

        res.json(status);
      } catch (error: any) {
        logger.error('[PreviewServer] Deploy status error', { component: 'PreviewServer' }, error);
        sendErrorResponse(res, 500, error, 'PreviewServer');
      }
    });

    // ==========================================
    // Custom Domains (deploy-only)
    // ==========================================
    // A user-owned domain attached to a deployed package. Same feature-branch +
    // cloud constraints as deploy. Serving is handled by the deploy proxy; these
    // routes are the management plane (register → verify → active, list, delete).

    /** Shared guard: validate feature and build deploy coords from the request. */
    const customDomainCoords = (
      req: Request,
      res: Response,
      feature: string | undefined,
    ): { organizationId: string; userId: string; projectId: string; feature: string } | null => {
      if (!feature) {
        res.status(400).json({ success: false, reason: 'feature-required', message: 'A feature is required — custom domains are feature-scoped' });
        return null;
      }
      const userContext = extractUserContext(req);
      return { organizationId: userContext.organizationId, userId: userContext.userId, projectId: req.params.id, feature };
    };

    /** POST /projects/:id/custom-domain — register (returns DNS setup instructions). */
    this.app.post('/projects/:id/custom-domain', async (req: Request, res: Response) => {
      try {
        const c = customDomainCoords(req, res, req.body?.feature);
        if (!c) return;
        const hostname = req.body?.hostname;
        const target = req.body?.target === 'backend' ? 'backend' : 'frontend';
        const slug = typeof req.body?.slug === 'string' && req.body.slug ? req.body.slug : undefined;
        const wildcard = req.body?.wildcard === true;
        if (!hostname || typeof hostname !== 'string') {
          res.status(400).json({ success: false, reason: 'invalid-hostname', message: 'hostname is required' });
          return;
        }
        const result = await this.customDomainService.register(
          { tenantId: c.organizationId, userId: c.userId, projectId: c.projectId, feature: c.feature },
          hostname, target, slug, new Date().toISOString(), wildcard,
        );
        if (!result.ok) {
          const code = result.reason === 'not-enabled' ? 503 : result.reason === 'already-taken' ? 409 : 400;
          res.status(code).json({ success: false, reason: result.reason, message: result.message });
          return;
        }
        res.status(201).json({ success: true, domain: result.domain, dns: result.dns });
      } catch (error: any) {
        sendErrorResponse(res, 500, error, 'PreviewServer');
      }
    });

    /** GET /projects/:id/custom-domain/status?feature=... — list domains for the deploy. */
    this.app.get('/projects/:id/custom-domain/status', async (req: Request, res: Response) => {
      try {
        const c = customDomainCoords(req, res, req.query.feature as string | undefined);
        if (!c) return;
        const domains = await this.customDomainService.list(
          { tenantId: c.organizationId, userId: c.userId, projectId: c.projectId, feature: c.feature },
        );
        res.json({ success: true, enabled: this.customDomainService.isEnabled(), domains });
      } catch (error: any) {
        sendErrorResponse(res, 500, error, 'PreviewServer');
      }
    });

    /** POST /projects/:id/custom-domain/verify — trigger ownership (TXT) verification. */
    this.app.post('/projects/:id/custom-domain/verify', async (req: Request, res: Response) => {
      try {
        const c = customDomainCoords(req, res, req.body?.feature);
        if (!c) return;
        const hostname = req.body?.hostname;
        if (!hostname || typeof hostname !== 'string') {
          res.status(400).json({ success: false, reason: 'invalid-hostname', message: 'hostname is required' });
          return;
        }
        const domain = await this.customDomainService.verify(
          { tenantId: c.organizationId, userId: c.userId, projectId: c.projectId, feature: c.feature },
          hostname, new Date().toISOString(),
        );
        if (!domain) { res.status(404).json({ success: false, reason: 'not-found', message: 'Domain not found' }); return; }
        res.json({ success: true, domain });
      } catch (error: any) {
        sendErrorResponse(res, 500, error, 'PreviewServer');
      }
    });

    /** DELETE /projects/:id/custom-domain?feature=...&hostname=... — remove a domain. */
    this.app.delete('/projects/:id/custom-domain', async (req: Request, res: Response) => {
      try {
        const c = customDomainCoords(req, res, (req.query.feature as string | undefined) ?? req.body?.feature);
        if (!c) return;
        const hostname = (req.query.hostname as string | undefined) ?? req.body?.hostname;
        if (!hostname || typeof hostname !== 'string') {
          res.status(400).json({ success: false, reason: 'invalid-hostname', message: 'hostname is required' });
          return;
        }
        const ok = await this.customDomainService.delete(
          { tenantId: c.organizationId, userId: c.userId, projectId: c.projectId, feature: c.feature },
          hostname,
        );
        if (!ok) { res.status(404).json({ success: false, reason: 'not-found', message: 'Domain not found' }); return; }
        res.json({ success: true });
      } catch (error: any) {
        sendErrorResponse(res, 500, error, 'PreviewServer');
      }
    });

    // ==========================================
    // Admin/Debug Endpoints
    // ==========================================

    /**
     * GET /preview/admin/instances
     * List all preview instances (admin only)
     */
    this.app.get('/admin/instances', async (_req: Request, res: Response) => {
      try {
        const previews = await this.stateStore.listPreviews();
        res.json({ instances: previews });
      } catch (error: any) {
        sendErrorResponse(res, 500, error, 'PreviewServer');
      }
    });

    // 404 handler
    this.app.use(this.notFoundHandler('control'));
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    await this.initialize();
    await this.deployService.cleanupStaleDeploys();
    this.deployService.startIdleEviction();
    this.setupRoutes();

    const port = this.options.port || getPreviewControlPort();
    const contentPort = getPreviewContentPort(port);
    // A shared port silently restores the single-origin layout (H-NEW-001).
    assertPreviewOriginSeparation(port);

    // Content listener: preview + deploy proxies and their HMR/app WebSockets.
    // Separate origin from the control plane below.
    this.contentServer = this.contentApp.listen(contentPort, () => {
      logger.warn(`[PreviewServer] 🌐 Content (preview/deploy) listening on port ${contentPort}`, {
        component: 'PreviewServer',
      });
    });
    // A bind failure here MUST be fatal. Silently continuing leaves the process
    // answering the control plane while no origin serves content at all — every
    // preview and deploy 404s, or worse, resolves to whatever else holds the port.
    // The default is `PORT + 1`, which is exactly the kind of value another local
    // service can already own.
    this.contentServer.on('error', (err: NodeJS.ErrnoException) => {
      logger.error(
        `[PreviewServer] content listener failed to bind port ${contentPort} (${err.code ?? err.message}). ` +
        'Set ANT_PREVIEW_CONTENT_PORT to a free port — user content must have its own origin.',
        { component: 'PreviewServer' },
        err,
      );
      process.exit(1);
    });

    return new Promise((resolve) => {
      this.server = this.app.listen(port, () => {
        logger.warn(`[PreviewServer] 🚀 Preview listening on port ${port}`, {
          component: 'PreviewServer'
        });
        logger.warn(`[PreviewServer] 📡 Ready for /preview/* requests`, {
          component: 'PreviewServer'
        });
        // Routing/identity diagnostics — confirms the deployed build, the routing
        // mode, and whether POD_IP is injected (the config that decides whether
        // cross-pod owner-forwarding can work). `build` is the marker to grep for
        // after a redeploy to be certain the new image is live.
        logger.warn(
          `[PreviewServer] routing diag: build=${PREVIEW_ROUTING_BUILD} mode=${getPreviewRoutingMode()} ` +
          `previewBase=${getPreviewBaseDomain() ?? '(unset)'} deployBase=${getDeployBaseDomain() ?? '(unset)'} ` +
          `podId=${os.hostname()} POD_IP=${process.env.POD_IP ?? '(unset)'} ` +
          `controlPort=${port} contentPort=${contentPort}`,
          { component: 'PreviewServer' },
        );

        // Peer reachability probe — one greppable line per peer pod proving
        // whether pod-to-pod TCP on the service port is open (owner-forward
        // fast path) or blocked (previews self-heal locally). Infra evidence
        // for the NetworkPolicy/SG request; fire-and-forget.
        void this.probePeerReachability();

        // Start idle check
        this.previewService.startIdleCheck();
        
        resolve();
      });

      // Same reasoning as the content listener: a control-plane bind failure must
      // stop the process, not leave a half-started server behind.
      this.server.on('error', (err: NodeJS.ErrnoException) => {
        logger.error(
          `[PreviewServer] control listener failed to bind port ${port} (${err.code ?? err.message})`,
          { component: 'PreviewServer' },
          err,
        );
        process.exit(1);
      });

      // ✅ WebSocket Upgrade Proxy
      // Next.js dev server requires WebSocket for HMR (Hot Module Replacement).
      // Without this, the HotReload component fails and the page doesn't render properly.
      // We intercept HTTP Upgrade requests on the server, extract the serverKey from the URL,
      // look up the dev server port, then create a raw TCP tunnel to the dev server.
      // Registered on the CONTENT listener: every tunnel below terminates at a
      // user-authored dev server or deploy app, which is what that listener serves.
      this.contentServer.on('upgrade', async (req: IncomingMessage, socket: net.Socket, head: Buffer) => {
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
            let coords = label ? await this.deployService.resolveDeployLabel(label) : null;
            if (!coords) coords = await this.deployService.resolveCustomDomain(hostHeader || '');
            if (coords) {
              const state = await this.deployService.ensureRunning(
                coords.tenantId, coords.userId, coords.projectId, coords.feature,
              );
              if (!state) { socket.destroy(); return; }
              if (state.visibility === 'private') {
                const jwtService = createJwtServiceFromEnv();
                if (jwtService) {
                  const token = parseCookieHeader(req.headers.cookie)[JwtService.cookieName];
                  let authorized = false;
                  if (token) {
                    try {
                      authorized = assertProxyOwnership(jwtService.verify(token), {
                        tenantId: coords.tenantId, userId: coords.userId,
                      });
                    } catch { authorized = false; }
                  }
                  if (!authorized) { socket.destroy(); return; }
                }
              }
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
            // O(1) index first (M-NEW-020), same as the HTTP proxy; fall back to
            // a full scan only on a genuine miss.
            const store = this.stateStore as any;
            const indexedPreview = previewLabel && typeof store.getPreviewByLabel === 'function'
              ? await store.getPreviewByLabel(previewLabel)
              : null;
            const pMatch = previewLabel
              ? (indexedPreview
                  ? resolvePreviewLabel([indexedPreview], previewLabel)
                  : resolvePreviewLabel(await this.stateStore.listPreviews(), previewLabel))
              : null;
            if (pMatch) {
              // Cloud mode requires a valid owner session (upgrade bypasses Express middleware).
              const isCloudMode = this.options.mode === 'cloud' || process.env.ANT_SERVER_MODE === 'cloud';
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
              const wsLocal = this.previewService.getLocalPreview(
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
                const fresh = await this.previewService.ensureRunning(
                  pMatch.tenantId, pMatch.userId, pMatch.projectId, pMatch.feature,
                  this.resolveWorkspacePath({ organizationId: pMatch.tenantId, userId: pMatch.userId }, pMatch.projectId, pMatch.feature),
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

            const state = await this.deployService.ensureRunning(
              parsed.tenantId,
              parsed.userId,
              parsed.projectId,
              parsed.feature,
            );
            if (!state) { socket.destroy(); return; }

            // Private-deploy gate — symmetric with the HTTP proxy. Without it,
            // a private deploy's HMR/runtime assets would tunnel to an
            // unauthorized client. Failure → silent socket.destroy (no signal).
            if (state.visibility === 'private') {
              const jwtService = createJwtServiceFromEnv();
              if (jwtService) {
                const token = parseCookieHeader(req.headers.cookie)[JwtService.cookieName];
                let authorized = false;
                if (token) {
                  try {
                    authorized = assertProxyOwnership(jwtService.verify(token), parsed);
                  } catch { authorized = false; }
                }
                if (!authorized) { socket.destroy(); return; }
              }
            }

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
          const isCloudMode = this.options.mode === 'cloud' || process.env.ANT_SERVER_MODE === 'cloud';
          let previewPayload: { org: string; sub: string } | undefined;
          if (isCloudMode) {
            const jwtService = createJwtServiceFromEnv();
            if (jwtService) {
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
          const mapping = this.previewService.getLocalPreview(tenantId, userId, projectId, feature)
            ?? await this.stateStore.getPreview(
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
      });
    });
  }

  /**
   * Boot-time diagnostic: probe every peer pod found in the preview registry
   * on the shared service port. Emits one `peer-probe` warn line per peer —
   * `UNREACHABLE` is the greppable evidence that pod-to-pod TCP is blocked
   * at the network layer (NetworkPolicy / security group), which disables
   * the owner-forward fast path and forces per-pod local self-heal.
   */
  private async probePeerReachability(): Promise<void> {
    try {
      const previews = await this.stateStore.listPreviews();
      const self = os.hostname();
      const peers = new Map<string, string>();
      for (const p of previews) {
        if (p.podId && p.host && p.host !== 'localhost' && p.podId !== self) {
          peers.set(p.podId, p.host);
        }
      }
      if (peers.size === 0) {
        logger.warn(`[PreviewServer] peer-probe: no peer pods in the preview registry — nothing to probe`, { component: 'PreviewServer' });
        return;
      }
      const port = selfServicePort();
      for (const [podId, host] of peers) {
        const liveness = await resolveCrossPodLiveness({ host, port }, false);
        if (liveness === 'reachable') {
          logger.warn(`[PreviewServer] peer-probe: ${podId}@${host}:${port} reachable — owner-forward fast path available`, { component: 'PreviewServer' });
        } else {
          logger.warn(
            `[PreviewServer] peer-probe: ${podId}@${host}:${port} UNREACHABLE — pod-to-pod TCP appears blocked (NetworkPolicy/SG); previews self-heal locally on each pod`,
            { component: 'PreviewServer' },
          );
        }
      }
    } catch (err: any) {
      logger.debug(`[PreviewServer] peer-probe failed: ${err?.message ?? err}`, { component: 'PreviewServer' });
    }
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    logger.info('[PreviewServer] Stopping...', { component: 'PreviewServer' });

    // Drop the cross-process cleanup subscription before tearing down services.
    if (this.cleanupUnsubscribe) {
      try {
        this.cleanupUnsubscribe();
      } catch (err) {
        logger.warn('[PreviewServer] Error unsubscribing cleanup channel', { component: 'PreviewServer' }, err);
      }
      this.cleanupUnsubscribe = undefined;
    }
    if (this.connectionsRefreshUnsubscribe) {
      try {
        this.connectionsRefreshUnsubscribe();
      } catch (err) {
        logger.warn('[PreviewServer] Error unsubscribing connections-refresh channel', { component: 'PreviewServer' }, err);
      }
      this.connectionsRefreshUnsubscribe = undefined;
    }

    // Stop the PortManager TTL-refresh loop (claims TTL-expire on their own).
    try {
      this.portManager?.dispose();
    } catch (err) {
      logger.warn('[PreviewServer] Error disposing PortManager', { component: 'PreviewServer' }, err);
    }

    // Cleanup preview service
    try {
      await this.previewService.cleanup();
    } catch (err) {
      logger.warn('[PreviewServer] Error during preview cleanup', { component: 'PreviewServer' }, err);
    }

    // Cleanup deploy service
    try {
      await this.deployService.cleanup();
    } catch (err) {
      logger.warn('[PreviewServer] Error during deploy cleanup', { component: 'PreviewServer' }, err);
    }

    // Close Redis connection (may already be closed if another service shut down first)
    try {
      if (this.stateStore && typeof (this.stateStore as any).close === 'function') {
        await (this.stateStore as any).close();
      }
    } catch (err) {
      logger.warn('[PreviewServer] Error closing Redis', { component: 'PreviewServer' }, err);
    }

    // Close both HTTP listeners with a shared timeout budget
    for (const [label, server] of [['content', this.contentServer], ['control', this.server]] as const) {
      if (!server) continue;
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          logger.warn(`[PreviewServer] ${label} listener shutdown timed out, forcing`, { component: 'PreviewServer' });
          resolve();
        }, 5000);

        server.close(() => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }

    logger.info('[PreviewServer] Stopped', { component: 'PreviewServer' });
  }
}

/**
 * Create and start PreviewServer
 */
export async function createPreviewServer(): Promise<PreviewServer> {
  const redisUrl = resolveRedisUrl();

  const server = new PreviewServer({
    port: parseInt(process.env.PORT || '8080'),
    redisUrl,
    workspacesPath: process.env.ANT_WORKSPACE_BASE_PATH,
    mode: process.env.ANT_SERVER_MODE === 'cloud' ? 'cloud' : 'local'
  });

  // Handle shutdown signals (once guard prevents re-entrant shutdown)
  let isShuttingDown = false;
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.warn(`[PreviewServer] ${signal} received, shutting down...`, {
      component: 'PreviewServer'
    });
    await server.stop();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await server.start();
  return server;
}
