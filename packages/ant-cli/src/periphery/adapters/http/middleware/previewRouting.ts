/**
 * Preview routing SSOT.
 *
 * Resolves a 5-part preview urlKey (`org--user--project--feature--serviceSlug`)
 * to the upstream dev server (host:port) for the package the URL targets, by
 * matching `packages[].slug`. Used by BOTH the HTTP middleware (previewProxy.ts)
 * and the WebSocket upgrade handler (PreviewServer.ts) so the per-package
 * decision can never drift between the two paths.
 *
 * Parallel to `deployRouting.ts#resolveDeployTarget`. Preview differs from
 * deploy in two ways, so this helper is deliberately narrower:
 *   - `PreviewPackage.slug` is OPTIONAL (stale records from older builds lack
 *     it), so an unmatched slug is expected and returns null (entry fallback).
 *   - The caller owns the entry-frontend / backend-only / `/api/*` fallbacks
 *     (the HTTP middleware has a richer precedence chain than deploy). This
 *     helper resolves ONLY the slug-matched case and returns null otherwise.
 */

import * as os from 'os';
import { getPreviewContentPort } from '../../../../core/config/previewRouting';
import { logger } from '../../../../utils/logger';
import { packageSlug, toUrlKey, parseUrlKey } from '../services/PreviewService/utils/serverKeyUtils';
import { toDnsLabel } from '../services/PreviewService/utils/previewLabel';

export interface PreviewTarget {
  targetHost: string;
  targetPort: number;
  /** Whether the matched package is a frontend (caller keeps the urlKey prefix). */
  isFrontend: boolean;
}

/**
 * Loop-guard header for cross-pod owner-forwarding (see `resolveOwnerForward`).
 * The non-owner replica sets it when forwarding to the owner; the owner replica
 * must never forward again — if it still doesn't own the preview locally, the
 * record is stale and the request fails fast instead of bouncing between pods.
 */
export const PREVIEW_PEER_FORWARD_HEADER = 'x-ant-preview-fwd';

/** This replica's raw `POD_IP` (or undefined) — for boot/diagnostic logging only. */
export function selfPodHost(): string | undefined {
  const v = process.env.POD_IP;
  return v && v.trim() ? v.trim() : undefined;
}

/**
 * This replica's identity for cross-pod ownership — the pod hostname, EXACTLY the
 * value `PreviewService` records as `podId` (`os.hostname()`). Always present (no
 * env dependency), so owner detection never silently disables itself. This mirrors
 * `DeployService.ensureRunning`'s `state.podId !== os.hostname()` check.
 */
export function selfPodId(): string {
  return os.hostname();
}

/**
 * The ant-preview HTTP listen port — identical on every replica and the port the
 * ingress/ALB forwards to, so pod-to-pod on it is open by construction. Dev-server
 * ports (Vite/Next, arbitrary high ports) are NOT reachable cross-pod. Mirrors
 * `createPreviewServer`'s `parseInt(process.env.PORT || '8080')`.
 */
/**
 * The port a peer pod serves preview CONTENT on — the forward target for
 * cross-pod owner-forwarding, which is a content request by definition. Content
 * lives on its own listener (see `core/config/previewRouting`), so this is the
 * content port, not `PORT`.
 */
export function selfServicePort(): number {
  return getPreviewContentPort();
}

export interface OwnerForwardDecision {
  /** Owning pod's address (its `host`, from the Redis record — a routable pod IP). */
  forwardHost: string;
  /** ant-preview service port on that pod (same as ours). */
  forwardPort: number;
}

/**
 * Decide whether a preview request that landed on THIS replica must be forwarded
 * to the pod that actually spawned the dev server.
 *
 * A preview's dev server lives on exactly one owner pod, bound to that pod's IP on
 * an ephemeral port. The ALB round-robins each preview host across replicas with no
 * owner affinity, so ~half of requests land on a non-owner pod. That pod cannot
 * reach the owner's dev-server port cross-pod (blocked); instead it forwards the
 * whole request to the owner's ant-preview SERVICE port (open) with the original
 * `Host` preserved, and the owner proxies to its own `localhost` dev server.
 *
 * Ownership is decided by `podId` (`os.hostname()`) — the SAME signal deploy uses —
 * NOT `POD_IP`. (An earlier version gated on `process.env.POD_IP`, which the record
 * writer does not require: `getPodHost()` falls back to the eth0 IP when POD_IP is
 * unset, so records looked cross-pod-routable while the forwarder believed it was
 * off-cluster and disabled itself. Using the always-present hostname removes that
 * silent-inert failure.)
 *
 * Returns null when the request can be served from this pod directly: no owner podId
 * (stale/legacy record → forgiving fallback to record host), owner IS this pod,
 * owner host unknown/loopback, or the request was already forwarded once (loop guard
 * against a stale owner record bouncing a request between pods).
 */
export function resolveOwnerForward(
  ownerPodId: string | undefined,
  ownerHost: string | undefined,
  alreadyForwarded: boolean,
): OwnerForwardDecision | null {
  if (alreadyForwarded) return null; // owner couldn't serve locally → don't bounce again
  if (!ownerPodId || ownerPodId === selfPodId()) return null; // owned locally (or unknown → forgiving)
  if (!ownerHost || ownerHost === 'localhost') return null; // owner host not routable
  return { forwardHost: ownerHost, forwardPort: selfServicePort() };
}

/**
 * Minimal structural view of a preview registry record — the only fields this
 * router reads. `PreviewState` (WS handler) and the HTTP middleware's hoisted
 * locals both satisfy it, so neither caller has to materialize a full record.
 */
export interface PreviewRoutingPool {
  host?: string;
  packages?: ReadonlyArray<{ slug?: string; type: string; port: number }>;
}

/**
 * Match a 5-part preview urlKey's service segment to a package port.
 *
 * Returns a target ONLY when `serviceName` is present AND a package with the
 * corresponding slug exists. For a 4-part urlKey (no `serviceName`), an
 * unmatched slug, or a stale record lacking `slug`, returns null so the caller
 * falls back to the entry frontend (`mapping.port`).
 *
 * `urlKey` is accepted purely for logging context.
 */
export function resolvePreviewTarget(
  mapping: PreviewRoutingPool,
  serviceName: string | undefined,
  urlKey: string,
): PreviewTarget | null {
  if (!serviceName) return null;

  const wantedSlug = packageSlug(serviceName);
  const pkg = (mapping.packages || []).find((p) => p.slug === wantedSlug);
  if (!pkg) {
    logger.warn(
      `[Preview] Service '${serviceName}' not found in packages for '${urlKey}', falling back to entry`,
      { component: 'PreviewRouting' },
    );
    return null;
  }

  return {
    targetHost: mapping.host || 'localhost',
    targetPort: pkg.port,
    isFrontend: pkg.type === 'frontend',
  };
}

/**
 * Minimal structural view of a preview registry record for label resolution —
 * `PreviewState` (from `listPreviews`) satisfies it.
 */
export interface PreviewLabelPool {
  tenantId: string;
  userId: string;
  projectId: string;
  feature: string;
  host?: string;
  /** Owning pod hostname (`os.hostname()`) — drives cross-pod owner-forwarding. */
  podId?: string;
  port: number; // entry port
  packages?: ReadonlyArray<{ type: string; port: number; slug?: string; urlKey?: string }>;
}

export interface PreviewLabelMatch {
  tenantId: string;
  userId: string;
  projectId: string;
  feature: string;
  /** 5th urlKey segment of the matched frontend (multi-frontend); undefined for a 4-part / single-frontend / top-level label. */
  serviceName?: string;
  host: string;
  /** Owning pod hostname (`os.hostname()`) — passed to `resolveOwnerForward`. */
  podId?: string;
  /** Entry (first frontend) port — the fallback when no per-package serviceName. */
  port: number;
  packages: ReadonlyArray<{ type: string; port: number; slug?: string; urlKey?: string }>;
}

/**
 * Subdomain routing: resolve a Host DNS label to a preview's coordinates by
 * RECOMPUTE-and-MATCH over the active preview set (deterministic label; small
 * set — no extra Redis index). Mirrors `DeployService.resolveDeployLabel`.
 *
 * Returns the matched frontend package's `serviceName` (5-part urlKey) so the
 * caller can route multi-frontend previews per-package via `resolvePreviewTarget`.
 * A 4-part serverKey match (single frontend / top-level label) yields no
 * `serviceName`, so the caller falls back to the entry `port`.
 *
 * SSOT: the single preview label resolver, shared by the HTTP proxy and the WS
 * upgrade handler — symmetric with the single `resolvePreviewTarget` port SSOT.
 */
export function resolvePreviewLabel(
  previews: ReadonlyArray<PreviewLabelPool>,
  label: string,
): PreviewLabelMatch | null {
  for (const st of previews) {
    const serverKey = `${st.tenantId}:${st.userId}:${st.projectId}:${st.feature}`;
    const frontends = (st.packages || []).filter((p) => p.type === 'frontend');
    const matched = frontends.find((p) => toDnsLabel(p.urlKey || toUrlKey(serverKey)) === label);
    const matchesEntry = toDnsLabel(toUrlKey(serverKey)) === label;
    if (matched || matchesEntry) {
      const serviceName = matched
        ? parseUrlKey(matched.urlKey || toUrlKey(serverKey))?.serviceName
        : undefined;
      return {
        tenantId: st.tenantId,
        userId: st.userId,
        projectId: st.projectId,
        feature: st.feature,
        serviceName,
        host: st.host || 'localhost',
        podId: st.podId,
        port: st.port,
        packages: st.packages || [],
      };
    }
  }
  return null;
}
