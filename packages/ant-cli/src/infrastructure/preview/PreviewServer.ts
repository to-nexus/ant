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
 * @see docs/architecture/10-cloud-architecture.md Section 3.2
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as net from 'net';
import { IncomingMessage } from 'http';
import { PreviewService } from '../../periphery/adapters/http/services/PreviewService';
import { createPreviewProxyMiddleware } from '../../periphery/adapters/http/middleware/previewProxy';
import { createDeployProxyMiddleware } from '../../periphery/adapters/http/middleware/deployProxy';
import { isSubdomainRouting, getDeployBaseDomain, getPreviewBaseDomain } from '../../core/config/previewRouting';
import { extractLabelFromHost } from '../../periphery/adapters/http/services/PreviewService/utils/previewLabel';
import { createCorsMiddleware } from '../../periphery/adapters/http/middleware/corsConfig';
import { createJwtAuthMiddleware } from '../../periphery/adapters/http/middleware/jwtAuth';
import { previewRateLimiter, initializeRateLimiters } from '../../periphery/adapters/http/middleware/rateLimiter';
import { createJwtServiceFromEnv, JwtService } from '../auth/JwtService';
import { parseCookieHeader } from '../../periphery/adapters/http/middleware/proxyForwarding';
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
import { isUrlKey, parseUrlKey } from '../../periphery/adapters/http/services/PreviewService/utils/serverKeyUtils';
import { resolveConnectionForSave } from '../../periphery/adapters/http/services/PreviewService/utils/connectionResolve';
import { resolveDeployTarget } from '../../periphery/adapters/http/middleware/deployRouting';
import { resolvePreviewTarget, resolvePreviewLabel, resolveOwnerForward, PREVIEW_PEER_FORWARD_HEADER } from '../../periphery/adapters/http/middleware/previewRouting';
import { ProjectStructureDetector } from '../../periphery/adapters/http/services/PreviewService/detectors/ProjectStructureDetector';
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
 * trust). Other headers pass through unchanged. Exported for unit coverage.
 */
export function rewriteUpgradeHeaders(
  rawHeaderPairs: readonly string[],
  targetPort: number,
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
    const rawHeaders = peerForward
      ? buildPeerForwardUpgradeHeaders(req.rawHeaders)
      : rewriteUpgradeHeaders(req.rawHeaders, targetPort);

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

// ============================================
// PreviewServer
// ============================================

export class PreviewServer {
  private app: Express;
  private previewService!: PreviewService;
  private deployService!: DeployService;
  private customDomainService!: CustomDomainService;
  private portManager!: PortManager;
  private stateStore!: StateStorePort & PortRegistryPort;
  private server: any;
  private options: PreviewServerOptions;
  private cleanupUnsubscribe?: () => void;
  private connectionsRefreshUnsubscribe?: () => void;

  constructor(options: PreviewServerOptions) {
    this.options = options;
    this.app = express();
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
        if (!msg || !msg.organizationId || !msg.userId || !msg.projectId) {
          logger.warn('[PreviewServer] Ignored malformed connections-refresh request', { component: 'PreviewServer' }, { msg });
          return;
        }
        try {
          const connections = await this.refreshProjectConnections(
            { organizationId: msg.organizationId, userId: msg.userId },
            msg.projectId,
            msg.feature || 'main',
          );
          logger.info(
            `[PreviewServer] Connections refreshed post-job: ${connections.length} for ${msg.projectId}/${msg.feature || 'main'}`,
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
   * Resolve workspace path for a project (feature-aware)
   */
  private resolveWorkspacePath(
    userContext: { organizationId: string; userId: string },
    projectId: string,
    feature?: string
  ): string {
    const basePath = this.options.workspacesPath || process.env.ANT_WORKSPACE_BASE_PATH || '/mnt/workspaces';
    
    if (feature && feature !== 'main') {
      // Feature worktree path: basePath/org/user/projectId/features/{feature}/codebase
      return path.join(basePath, userContext.organizationId, userContext.userId, projectId, 'features', feature, 'codebase');
    }
    
    // Main codebase path: basePath/org/user/projectId/codebase
    return path.join(basePath, userContext.organizationId, userContext.userId, projectId, 'codebase');
  }

  /**
   * Re-detect this project's service connections from the CURRENT code and
   * overwrite the cached registry (+ the live PreviewState if running). SINGLE
   * source shared by the `detect-connections` endpoint (Auto Detect button) AND
   * the post-code-job `CONNECTIONS_REFRESH` subscriber — so the post-job panel
   * reflects the FINAL code, not the snapshot cached early in the job. Best-effort
   * detection: a missing workspace or structure-detection failure yields [].
   */
  private async refreshProjectConnections(
    userContext: { organizationId: string; userId: string },
    projectId: string,
    feature: string,
  ): Promise<import('../../core/ports/portRegistry').ServiceConnection[]> {
    const serverKey = `${userContext.organizationId}:${userContext.userId}:${projectId}:${feature}`;
    const workspacePath = this.resolveWorkspacePath(userContext, projectId, feature);
    if (!fs.existsSync(workspacePath)) {
      return [];
    }

    let connections: import('../../core/ports/portRegistry').ServiceConnection[] = [];
    try {
      const structureDetector = new ProjectStructureDetector();
      const structure = await structureDetector.detect(workspacePath);
      if (structure) {
        const connectionDetector = new ConnectionDetector();
        connections = connectionDetector.detect(workspacePath, structure, serverKey);
      }
    } catch (detectErr: any) {
      logger.warn(`[PreviewServer] Structure detection failed, clearing connections: ${detectErr.message}`, { component: 'PreviewServer' });
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
        const pkgDir = subdir ? path.join(workspacePath, subdir) : workspacePath;
        const framework = toToggleFramework(detectFramework(pkgDir));
        syncEnvStructureFromExample(
          path.join(pkgDir, '.env.example'),
          path.join(pkgDir, '.env'),
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
      { connections: configConnections }
    );

    // Also update PreviewState if preview is currently running
    try {
      const currentState = await this.previewService.getPreviewStatus(
        userContext.organizationId, userContext.userId, projectId, feature
      );
      if (currentState.running) {
        await this.stateStore.updatePreview(
          userContext.organizationId, userContext.userId, projectId, feature,
          { connections }
        );
      }
    } catch { /* best-effort */ }

    return connections;
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
   * Setup Express middleware and routes
   * 
   * Middleware order (per plan):
   * 1. CORS (shared corsConfig)
   * 2. helmet (security headers)
   * 3. Health check (before auth)
   * 4. Preview Proxy middleware (no auth, before body parser)
   * 5. cookie-parser
   * 6. Body parsers (json)
   * 7. JWT auth middleware (cloud only)
   * 8. Management API routes
   */
  private setupRoutes(): void {
    if (process.env.NODE_ENV === 'production') {
      this.app.set('trust proxy', 1);
    }

    // 1. Shared CORS configuration (same as ant-api and ant-realtime)
    this.app.use(createCorsMiddleware());

    // 2. Security headers
    this.app.use(helmet({
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      contentSecurityPolicy: false,
    }));

    // 3. Health check (before auth, before proxy)
    this.app.get('/health', async (_req: Request, res: Response) => {
      const previews = await this.stateStore.listPreviews();
      res.json({
        healthy: true,
        service: 'ant-preview',
        activeInstances: previews.length,
        timestamp: new Date().toISOString()
      });
    });

    // 3b. Custom-domain TLS ask endpoint (Caddy on-demand TLS).
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

    // 4. Preview Proxy - MUST be before body parsers and JWT auth
    // Owner-only access: previews are gated on the owning tenant/user via the
    // JWT cookie (undefined jwtService in local mode → owner-accessible). The
    // proxy runs before cookie-parser, so it parses the raw Cookie header
    // itself. Routes: /:urlKey/* where urlKey = tenantId--userId--projectId--feature
    this.app.use(createPreviewProxyMiddleware({
      portRegistry: this.stateStore,
      pathPrefix: '',
      getBackendPort: async ({ tenantId, userId, projectId, feature }) => {
        const state = await this.stateStore.getPreview(tenantId, userId, projectId, feature);
        return state?.backendPort || null;
      },
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
      this.app.use(deployProxy);
    } else {
      this.app.use('/deploy/', deployProxy);
    }

    // 5. Cookie parser (required for JWT cookie auth)
    this.app.use(cookieParser());

    // 6. Body parser for API routes
    this.app.use(express.json({ limit: '50mb' }));

    // 7. JWT cookie authentication (cloud mode only)
    const isCloudMode = this.options.mode === 'cloud' || process.env.ANT_SERVER_MODE === 'cloud';
    if (isCloudMode) {
      const jwtService = createJwtServiceFromEnv();
      if (!jwtService) {
        throw new Error('ANT_JWT_SECRET is required in cloud mode. Set the environment variable to enable authentication.');
      }
      this.app.use(createJwtAuthMiddleware({
        jwtService,
        publicPaths: ['/health'],
        publicPrefixes: [],
      }));
      logger.info('JWT authentication enabled for Preview Server', { component: 'PreviewServer' });
    }

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
        const feature = req.body?.feature || 'main';
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
        const feature = req.body?.feature || 'main';

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
        const feature = req.query.feature as string || 'main';
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

        // Compute canStart + detect project profile: lightweight filesystem check when idle
        let canStart = false;
        let fsProjectProfile: { language: string; framework?: string } | undefined;
        let fsStructureType: string | undefined;
        if (!status.running && status.phase !== 'installing' && status.phase !== 'starting') {
          try {
            const workspacePath = this.resolveWorkspacePath(userContext, projectId, feature);
            const detection = this.detectProjectQuick(workspacePath);
            canStart = detection.canStart;
            fsProjectProfile = detection.projectProfile;
            fsStructureType = detection.structureType;
          } catch {
            // Filesystem check failure → canStart remains false
          }
        }

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
          structureType: status.structureType || fsStructureType || null,
          projectProfile: (status as any).projectProfile || fsProjectProfile || null,
          connections: status.connections || [],
          restartRequired: status.restartRequired ?? false,
          canStart,
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

        const feature = req.query.feature as string || 'main';
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
     * If connections registry is empty and project files exist, runs ConnectionDetector
     * once and caches the result in Redis.
     */
    this.app.get('/projects/:id/preview-config', async (req: Request, res: Response) => {
      try {
        const projectId = req.params.id;
        const userContext = extractUserContext(req);
        const feature = req.query.feature as string || 'main';
        const serverKey = `${userContext.organizationId}:${userContext.userId}:${projectId}:${feature}`;

        let config = await this.stateStore.getPreviewConfig(
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

        // `.env.example` (structure) + `.env` (value/toggle) are the SSOT. Always
        // re-detect from files so the panel reflects the current file state;
        // Redis preview-config is a derived cache, refreshed here (never the
        // authority). Cached connections are the fallback when the workspace or
        // structure is transiently unavailable.
        let connections = config?.connections || [];
        try {
          const workspacePath = this.resolveWorkspacePath(userContext, projectId, feature);
          if (fs.existsSync(workspacePath)) {
            const detector = new ProjectStructureDetector();
            const structure = await detector.detect(workspacePath);
            if (structure) {
              const connectionDetector = new ConnectionDetector();
              connections = connectionDetector.detect(workspacePath, structure, serverKey);
              await this.stateStore.savePreviewConfig(
                userContext.organizationId, userContext.userId, projectId, feature,
                { connections }
              );
            }
          }
        } catch (detectErr: any) {
          logger.warn(`[PreviewServer] Connection detect failed, using cached config: ${detectErr.message}`, { component: 'PreviewServer' });
        }

        res.json({
          structureType: status.structureType || config?.structureType || null,
          projectProfile: config?.projectProfile || null,
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
        const feature = req.body.feature || 'main';
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
            const subdir = conn.source && conn.source !== '*' ? conn.source : '';
            const pkgDir = subdir ? path.join(workspacePath, subdir) : workspacePath;
            const framework = toToggleFramework(detectFramework(pkgDir));
            upsertConnectionAnnotation(path.join(pkgDir, '.env.example'), conn, framework);
            mirrorConnectionToEnv(path.join(pkgDir, '.env'), conn, framework);
          }
          for (const conn of removedConns) {
            const subdir = conn.source && conn.source !== '*' ? conn.source : '';
            const pkgDir = subdir ? path.join(workspacePath, subdir) : workspacePath;
            // Structure delete: drop the annotation from .env.example AND the
            // value/toggle keys from .env (explicit removal knows the envVar,
            // so this is the one safe place to delete .env keys).
            removeConnectionAnnotation(path.join(pkgDir, '.env.example'), conn);
            const envPath = path.join(pkgDir, '.env');
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
        const feature = req.body.feature || req.query.feature as string || 'main';

        const workspacePath = this.resolveWorkspacePath(userContext, projectId, feature);
        if (!fs.existsSync(workspacePath)) {
          res.status(404).json({ error: 'Project workspace not found', path: workspacePath });
          return;
        }

        const connections = await this.refreshProjectConnections(userContext, projectId, feature);
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
     * Only feature branches are deployable. Requests without a feature (or
     * with `feature === 'main'`) are rejected with 400. Requests issued
     * while a code job is writing files on this feature are rejected with
     * 409 — DeployService surfaces this via `reason === 'code-job-active'`.
     */
    this.app.post('/projects/:id/deploy', async (req: Request, res: Response) => {
      try {
        const projectId = req.params.id;
        const userContext = extractUserContext(req);
        const feature = req.body?.feature;

        if (!feature || feature === 'main') {
          res.status(400).json({
            success: false,
            reason: 'base-branch-not-allowed',
            message: 'Deploy is only available on feature branches',
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

        if (!feature || feature === 'main') {
          res.status(400).json({
            success: false,
            reason: 'base-branch-not-allowed',
            message: 'Deploy is only available on feature branches',
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

        if (!feature || feature === 'main') {
          res.status(400).json({
            success: false,
            reason: 'base-branch-not-allowed',
            message: 'Deploy is only available on feature branches',
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
      if (!feature || feature === 'main') {
        res.status(400).json({ success: false, reason: 'base-branch-not-allowed', message: 'Custom domains are only available on feature branches' });
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
    this.app.use((_req: Request, res: Response) => {
      res.status(404).json({
        error: 'Not Found',
        message: 'Preview endpoint not found'
      });
    });
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    await this.initialize();
    await this.deployService.cleanupStaleDeploys();
    this.deployService.startIdleEviction();
    this.setupRoutes();

    const port = this.options.port || parseInt(process.env.PORT || '8080');

    return new Promise((resolve) => {
      this.server = this.app.listen(port, () => {
        logger.warn(`[PreviewServer] 🚀 Preview listening on port ${port}`, {
          component: 'PreviewServer'
        });
        logger.warn(`[PreviewServer] 📡 Ready for /preview/* requests`, {
          component: 'PreviewServer'
        });
        
        // Start idle check
        this.previewService.startIdleCheck();
        
        resolve();
      });

      // ✅ WebSocket Upgrade Proxy
      // Next.js dev server requires WebSocket for HMR (Hot Module Replacement).
      // Without this, the HotReload component fails and the page doesn't render properly.
      // We intercept HTTP Upgrade requests on the server, extract the serverKey from the URL,
      // look up the dev server port, then create a raw TCP tunnel to the dev server.
      this.server.on('upgrade', async (req: IncomingMessage, socket: net.Socket, head: Buffer) => {
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
            const hostHeader =
              (req.headers['x-forwarded-host'] as string | undefined) || req.headers.host;
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
              openRawTunnel(req, socket, head, target.targetHost, target.targetPort, urlPath);
              return;
            }

            // Preview subdomain WS: the app is served at its own host root, so
            // the HMR Upgrade arrives at a bare path (no urlKey). Resolve the
            // Host label via the preview base domain and tunnel per-package
            // through the SAME resolvePreviewLabel + resolvePreviewTarget SSOTs
            // as the HTTP proxy — symmetric with the deploy branch above.
            const previewLabel = extractLabelFromHost(hostHeader, getPreviewBaseDomain());
            const pMatch = previewLabel
              ? resolvePreviewLabel(await this.stateStore.listPreviews(), previewLabel)
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
              // Cross-pod owner-forwarding (mirrors the HTTP proxy): when this
              // HMR upgrade lands on a non-owner replica, tunnel it to the owner
              // pod's ant-preview service port (Host preserved via peerForward)
              // instead of the owner's dev port (unreachable cross-pod). Off-
              // cluster / owner-is-self / already-forwarded → serve here directly.
              const ownerForward = resolveOwnerForward(
                pMatch.host,
                req.headers[PREVIEW_PEER_FORWARD_HEADER] === '1',
              );
              if (ownerForward) {
                openRawTunnel(req, socket, head, ownerForward.forwardHost, ownerForward.forwardPort, urlPath, WS_HANDSHAKE_TIMEOUT_MS, true);
                return;
              }
              const internalKey = `${pMatch.tenantId}:${pMatch.userId}:${pMatch.projectId}:${pMatch.feature}`;
              const target = resolvePreviewTarget({ host: pMatch.host, packages: pMatch.packages }, pMatch.serviceName, internalKey);
              const targetHost = target?.targetHost ?? pMatch.host;
              const targetPort = target?.targetPort ?? pMatch.port;
              // Root-served: forward the path verbatim (no basePath prefix).
              openRawTunnel(req, socket, head, targetHost, targetPort, urlPath);
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
            openRawTunnel(req, socket, head, target.targetHost, target.targetPort, urlPath);
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
          const mapping = await this.stateStore.getPreview(
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

          openRawTunnel(req, socket, head, targetHost, targetPort, targetPath);
        } catch (error: any) {
          logger.warn(`[PreviewServer] WS upgrade failed: ${error.message}`, { component: 'PreviewServer' });
          socket.destroy();
        }
      });
    });
  }

  /**
   * Check if preview can be started (lightweight filesystem check).
   * Returns true if workspace has a package.json with dev/start scripts,
   * or a Makefile/go.mod indicating a runnable project.
   */
  /**
   * Lightweight filesystem check: can the project be started, and what is its profile?
   * Delegates to ProjectStructureDetector.quickDetect() for unified detection logic.
   */
  private detectProjectQuick(workspacePath: string): {
    canStart: boolean;
    projectProfile?: { language: string; framework?: string };
    structureType?: string;
  } {
    try {
      const result = ProjectStructureDetector.quickDetect(workspacePath);
      if (!result) {
        return { canStart: false };
      }
      return {
        canStart: result.canStart,
        projectProfile: { language: result.language },
        structureType: result.structureType,
      };
    } catch {
      return { canStart: false };
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

    // Close HTTP server with timeout
    if (this.server) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          logger.warn('[PreviewServer] Shutdown timed out, forcing', { component: 'PreviewServer' });
          resolve();
        }, 5000);

        this.server.close(() => {
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
  const redisUrl = process.env.ANT_REDIS_URL;
  if (!redisUrl) {
    throw new Error('ANT_REDIS_URL is required for Preview Server');
  }

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
