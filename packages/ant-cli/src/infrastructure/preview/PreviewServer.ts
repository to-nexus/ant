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
  refusesSharedOriginPrivateAdmission,
} from '../../core/config/previewRouting';
import { resolveRedisUrl } from '../../core/config/redisUrl';
import { createCorsMiddleware } from '../../periphery/adapters/http/middleware/corsConfig';
import { createJwtAuthMiddleware } from '../../periphery/adapters/http/middleware/jwtAuth';
import { previewRateLimiter, healthRateLimiter, initializeRateLimiters } from '../../periphery/adapters/http/middleware/rateLimiter';
import { createSameOriginGuard } from '../../periphery/adapters/http/middleware/sameOriginGuard';
import {
  createWorkspacePreviewLane,
  WORKSPACE_LANE_PREFIX,
} from '../../periphery/adapters/http/middleware/workspacePreviewLane';
import { createRequireApprovedAccount } from '../../periphery/adapters/http/middleware/requireApprovedAccount';
import { createNoStoreForAuthenticated } from '../../periphery/adapters/http/middleware/noStoreForAuthenticated';
import { createJwtServiceFromEnv, JwtService } from '../auth/JwtService';
import { extractForwardingContext, parseCookieHeader } from '../../periphery/adapters/http/middleware/proxyForwarding';
import { assertProxyOwnership } from '../../periphery/adapters/http/middleware/proxyOwnership';
import { PortManager } from '../networking/PortManager';
import { RedisStateStore } from '../state/RedisStateStore';
import { StateStorePort } from '../../core/ports/stateStore';
import { PortRegistryPort } from '../../core/ports/portRegistry';
import { DeployService } from '../deploy/DeployService';
import { CustomDomainService } from '../deploy/customDomain/CustomDomainService';
import { getTlsAskSecret, assertTlsAskSecretConfigured } from '../deploy/customDomain/config';
import { timingSafeEqual } from 'crypto';

/**
 * Constant-time comparison of a request header against a shared secret.
 *
 * `!==` on a secret leaks its prefix through response timing to anything that
 * can reach the endpoint (ADV-094). Lengths are compared first, and non-secretly:
 * `timingSafeEqual` throws on a length mismatch, and the LENGTH of a shared
 * secret is not the secret.
 */
function timingSafeHeaderEquals(header: string | string[] | undefined, secret: string): boolean {
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string') return false;
  const a = Buffer.from(value, 'utf-8');
  const b = Buffer.from(secret, 'utf-8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
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
import { openRawTunnel, WS_HANDSHAKE_TIMEOUT_MS } from './wsTunnel';
import { envTarget, type PreviewServerCtx } from './controlRoutes/context';
import { createPreviewControlHandlers } from './controlRoutes/previewHandlers';
import { createDeployControlHandlers } from './controlRoutes/deployHandlers';
import { createContentUpgradeHandler } from './upgradeHandler';

// Re-exported for compatibility: unit tests and the credential-isolation
// policy suite import these from this module's path.
export {
  openRawTunnel,
  rewriteUpgradeHeaders,
  buildPeerForwardUpgradeHeaders,
  WS_HANDSHAKE_TIMEOUT_MS,
} from './wsTunnel';

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
 * Deployed-build marker for the preview cross-pod routing. Printed in the boot
 * `routing diag` line so a redeploy can be confirmed live from the logs. Bump on
 * material changes to the owner-forwarding path.
 */
const PREVIEW_ROUTING_BUILD = process.env.ANT_BUILD_SHA || 'owner-forward-podId-v2';

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

    // Subdomain routing resolves through the DNS-label index alone (there is no
    // per-request registry scan to fall back on — M-NEW-020/023), so records
    // written before the index existed, or whose entry expired, are repopulated
    // here. Best-effort: never blocks boot.
    try {
      await this.stateStore.backfillLabelIndexes();
    } catch (err: any) {
      logger.warn('[PreviewServer] label-index backfill failed (continuing)', { component: 'PreviewServer' }, { err: err?.message ?? String(err) });
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
   * Admit (or refuse) a raw WS upgrade to a deploy tunnel BEFORE any side effect
   * (M-029). The raw upgrade handler bypasses Express middleware, so this is the
   * only admission a deploy WS gets. Ordering is the point: visibility is read
   * side-effect-free via `getStatus` (never `ensureRunning`), so an unauthorized
   * caller cannot force a private deploy to rehydrate. Public deploys stay open
   * (lazy start intact). A private deploy requires the owner's session cookie and
   * refuses an ambient cross-site upgrade (a logged-in victim's browser driven by
   * attacker content) — same-origin HMR and non-browser callers are unaffected.
   */
  private async authorizeDeployUpgrade(
    req: IncomingMessage,
    coords: { tenantId: string; userId: string; projectId: string; feature: string },
  ): Promise<boolean> {
    let visibility = 'public';
    try {
      const status = await this.deployService.getStatus(
        coords.tenantId, coords.userId, coords.projectId, coords.feature,
      );
      visibility = status.visibility ?? 'public';
    } catch {
      visibility = 'private'; // fail closed on a read error
    }
    if (visibility !== 'private') return true;

    const jwtService = createJwtServiceFromEnv();
    if (!jwtService) return true; // no JWT configured (local single-user)

    // Cloud path-mode: the private tunnel shares the content origin with public
    // deploys, so a browser same-origin upgrade from attacker public content
    // carries the victim's ambient cookie and would pass the owner check below
    // (M-029 — cross-site alone does not catch it, the attack source is
    // same-origin). Refuse ambient/browser admission to a private tunnel in path
    // mode; private serving requires subdomain mode, where the per-deploy origin
    // stops an attacker hosting content on the victim's host. Non-ambient bearer
    // callers and local mode are unaffected. `jwtService` present ⇒ cloud.
    if (refusesSharedOriginPrivateAdmission(req.headers)) return false;
    const token = parseCookieHeader(req.headers.cookie)[JwtService.cookieName];
    if (!token) return false;
    try {
      return assertProxyOwnership(jwtService.verify(token), {
        tenantId: coords.tenantId, userId: coords.userId,
      });
    } catch {
      return false;
    }
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
   * Is this request addressed to a subdomain-mode CONTENT host (a preview/deploy
   * app host under one of the base domains)? Suffix-only test — no Redis lookup,
   * no existence signal (base domains are public knowledge), so it is safe on
   * unauthenticated paths (M-NEW-020 stays O(1), nothing is leaked).
   */
  private contentHostKind(req: Request): 'preview' | 'deploy' | null {
    if (!isSubdomainRouting()) return null;
    const externalHost = extractForwardingContext(req).externalHost ?? '';
    const hostname = externalHost.split(':')[0].toLowerCase();
    for (const [kind, base] of [
      ['preview', getPreviewBaseDomain()],
      ['deploy', getDeployBaseDomain()],
    ] as const) {
      if (base && hostname !== base && hostname.endsWith(`.${base}`)) return kind;
    }
    return null;
  }

  /** Per-key log throttle so a persistent misconfiguration cannot flood. */
  private lastMisrouteWarnAt = new Map<string, number>();
  private warnThrottled(key: string, message: string): void {
    const now = Date.now();
    if (now - (this.lastMisrouteWarnAt.get(key) ?? 0) < 60_000) return;
    this.lastMisrouteWarnAt.set(key, now);
    logger.error(message, { component: 'PreviewServer' });
  }

  /**
   * Catch-all 404, shared by both listeners.
   *
   * A peer-forwarded request reaching the catch-all means the owner pod failed to
   * recognize its own preview host — always-on diagnostic, since this exact silent
   * 404 previously masked a lost-Host routing defect.
   *
   * A CONTENT host reaching the CONTROL listener means the ingress still routes
   * the wildcard hosts at the control port — the exact misconfiguration that made
   * every preview/deploy page 404 after the origin split (H-NEW-001's infra
   * half). Answer 421 with the diagnosis instead of a mute 404, and log it.
   * Re-mounting the content proxies here would regress H-NEW-001 — the fix is
   * the ingress mapping, so the code's job is to make the misroute self-evident.
   */
  private notFoundHandler(listener: 'content' | 'control') {
    return (req: Request, res: Response): void => {
      const contentKind = this.contentHostKind(req);
      if (listener === 'control' && contentKind) {
        this.warnThrottled(
          `control:${contentKind}`,
          `[PreviewServer] ${contentKind} content host reached the CONTROL listener — ingress misroute: ` +
          `wildcard *.${contentKind === 'preview' ? getPreviewBaseDomain() : getDeployBaseDomain()} ` +
          `must target the content port (${getPreviewContentPort()}). ` +
          `host=${req.headers.host} xfh=${req.headers['x-forwarded-host'] ?? '(none)'} url=${req.url}`,
        );
        res.status(421).json({
          error: 'Misdirected Request',
          message:
            `This host serves ${contentKind} content, but the request reached the control-plane ` +
            `listener — the wildcard ingress must target the content port (${getPreviewContentPort()}).`,
        });
        return;
      }
      if (listener === 'content' && contentKind) {
        // Host says content, yet no proxy claimed it: malformed label (dots in
        // the subdomain), or a deploy-label index miss (deployProxy defers via
        // next() on unresolved coords). Always-on but throttled — hosts outside
        // the base domains (scanners) stay unlogged.
        this.warnThrottled(
          `content:${contentKind}:${req.headers.host ?? ''}`,
          `[PreviewServer] ${contentKind} host missed all proxies (catch-all 404 on content): ` +
          `host=${req.headers.host} xfh=${req.headers['x-forwarded-host'] ?? '(none)'} url=${req.url}`,
        );
      }
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
    // A CONTENT host's `/health` belongs to the user's app, so it defers to the
    // proxies — probes address the pod/service directly, never an app subdomain.
    this.contentApp.get('/health', (req: Request, res: Response, next) => {
      if (this.contentHostKind(req)) return next();
      res.json({ healthy: true, service: 'ant-preview-content' });
    });

    // 3b. Workspace preview lane — the file editor's HTML preview, served as a
    // real static site. Read-only, ticket-authorized, no cookie: it is CONTENT,
    // which is why it lives here and not beside the file API on the control
    // plane. Mounted BEFORE the preview proxy (which claims the root) and
    // deferred on a content host, where `/workspace` belongs to the user's own
    // app rather than to us.
    const workspaceLane = createWorkspacePreviewLane({
      workspaceResolver: this.workspaceResolver,
      ticketStore: this.stateStore,
      profile: 'content-origin',
    });
    this.contentApp.use(WORKSPACE_LANE_PREFIX, (req: Request, res: Response, next) => {
      if (this.contentHostKind(req)) return next();
      return workspaceLane(req, res, next);
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
      // Side-effect-free visibility read so a private deploy's ownership is
      // checked BEFORE ensureRunning rehydrates it (M-NEW-023).
      getVisibility: async (t, u, p, f) => (await this.deployService.getStatus(t, u, p, f)).visibility,
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
  /** Late-bound handler/upgrade context — built after initialize() wired the services. */
  private serverCtx(): PreviewServerCtx {
    return {
      mode: this.options.mode,
      stateStore: this.stateStore,
      previewService: this.previewService,
      deployService: this.deployService,
      customDomainService: this.customDomainService,
      resolveWorkspacePath: (userContext, projectId, feature) => this.resolveWorkspacePath(userContext, projectId, feature),
      detectProjectFacts: (userContext, projectId, feature, fallback) => this.detectProjectFacts(userContext, projectId, feature, fallback),
      refreshProjectFacts: (userContext, projectId, feature) => this.refreshProjectFacts(userContext, projectId, feature),
      markRestartRequiredIfRunning: (userContext, projectId, feature) => this.markRestartRequiredIfRunning(userContext, projectId, feature),
      authorizeDeployUpgrade: (req, coords) => this.authorizeDeployUpgrade(req, coords),
    };
  }

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

    const isCloudTlsAsk = this.options.mode === 'cloud' || process.env.ANT_SERVER_MODE === 'cloud';
    assertTlsAskSecretConfigured(isCloudTlsAsk);

    // Custom-domain TLS ask endpoint (Caddy on-demand TLS).
    // Caddy pauses the TLS handshake for an unknown SNI and asks here whether a
    // certificate may be issued. Answer 200 ONLY for a verified (`active`)
    // custom domain whose target deploy is alive — this is the abuse gate that
    // stops arbitrary domains from triggering Let's Encrypt issuance. Mounted
    // before the proxies + auth so it is reachable without a session. Internal
    // only (NetworkPolicy) — and in cloud with custom domains enabled the shared
    // secret is REQUIRED, not optional: a NetworkPolicy is a deployment artifact
    // this process cannot verify, and the sink behind this endpoint starts a
    // private deploy (L-NEW-002).
    this.app.get('/internal/tls-ask', async (req: Request, res: Response) => {
      const secret = getTlsAskSecret();
      // Cloud fails CLOSED. `assertTlsAskSecretConfigured` already refuses to
      // boot a custom-domain deployment without the secret, so reaching here
      // with it unset means custom domains are off and there is nothing to
      // answer for. Either way this must not fall through to
      // `resolveCustomDomain()` + `ensureRunning()`, which wakes a private
      // deploy (L-NEW-002).
      if (isCloudTlsAsk && !secret) {
        res.status(503).end();
        return;
      }
      if (secret && !timingSafeHeaderEquals(req.headers['x-ant-tls-ask-secret'], secret)) {
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
          'A JWT verification key is required in cloud mode: set ANT_JWT_PUBLIC_KEY.',
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
      // Per-identity responses must not be held by a shared cache.
      this.app.use(createNoStoreForAuthenticated());
      // Cookie-authenticated state changes must originate from an allowed origin.
      // The content listener is a different origin, so a document served there
      // cannot drive this API with the viewer's session (H-NEW-001).
      this.app.use(createSameOriginGuard());
      // Every control-plane route here is `/projects/*` — starting previews,
      // writing a feature's `.env`, deploying, claiming a custom domain. None of
      // it is available to an unapproved account.
      this.app.use(createRequireApprovedAccount());
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
    // Preview Management API + Config (handlers: controlRoutes/previewHandlers.ts)
    // ==========================================
    const ph = createPreviewControlHandlers(this.serverCtx());
    this.app.post('/projects/:id/start', ph.start);
    this.app.post('/projects/:id/stop', ph.stop);
    this.app.get('/projects/:id/status', ph.status);
    this.app.get('/projects/:id/validate', ph.validate);
    this.app.get('/projects/:id/preview-config', ph.getPreviewConfig);
    this.app.put('/projects/:id/preview-config', ph.savePreviewConfig);
    this.app.post('/projects/:id/detect-connections', ph.detectConnections);

    // ==========================================
    // Deploy Management + Custom Domains + Admin (handlers: controlRoutes/deployHandlers.ts)
    // ==========================================
    const dh = createDeployControlHandlers(this.serverCtx());
    this.app.post('/projects/:id/deploy', dh.deploy);
    this.app.post('/projects/:id/deploy/stop', dh.deployStop);
    this.app.get('/projects/:id/deploy/status', dh.deployStatus);
    this.app.post('/projects/:id/custom-domain', dh.registerCustomDomain);
    this.app.get('/projects/:id/custom-domain/status', dh.customDomainStatus);
    this.app.post('/projects/:id/custom-domain/verify', dh.verifyCustomDomain);
    this.app.delete('/projects/:id/custom-domain', dh.deleteCustomDomain);
    this.app.get('/admin/instances', dh.adminInstances);

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
      this.contentServer.on('upgrade', createContentUpgradeHandler(this.serverCtx()));
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
