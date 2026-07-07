/**
 * Deploy Types
 * 
 * Shared types for the deploy feature (static build + serve).
 * Used for SSE events and API contracts between BE and FE.
 */

/**
 * Deploy lifecycle phase.
 *
 * State machine (simplified):
 *   idle → building → deploying → running
 *     running → hibernated (pod restart / idle eviction / crash)
 *     running → stopped (user stop)
 *     hibernated → starting → running (lazy re-hydration on URL access)
 *     hibernated → unavailable (meta/artifact lost)
 *     * → error
 *
 * Meaning:
 *   - idle:         No deploy has ever been created, or state is fully cleared.
 *   - building:     `npm run build` in progress.
 *   - deploying:    Build finished, static server process is being spawned (first deploy only).
 *   - running:      Static server process alive, URL reachable.
 *   - hibernated:   Build artifacts + meta.json exist on disk, but the server
 *                   process is gone. Auto-wakes on next URL access.
 *   - starting:     Lazy re-hydration in flight (spawning static server from meta).
 *   - unavailable:  Meta or build output lost. User must re-deploy.
 *   - stopped:      User explicitly stopped the deploy.
 *   - error:        Build or serve failed; check `error` field.
 */
export type DeployPhase =
  | 'idle'
  | 'building'
  | 'deploying'
  | 'running'
  | 'hibernated'
  | 'starting'
  | 'unavailable'
  | 'error'
  | 'stopped';

export type DeployFramework = 'vite' | 'cra' | 'nextjs' | 'static' | 'unknown';

/**
 * Deploy-build access visibility. Applies to BOTH individual and team orgs.
 *
 * - `public`  — the static build is served without authentication (the
 *               historical behavior; treat `undefined` from old BE builds
 *               as `'public'`).
 * - `private` — only the owning tenant/user may access; unauthorized
 *               requests get an indistinguishable 404 (never 403).
 *
 * Visibility is a deploy-level concept keyed on `(tenant,user,project,feature)`,
 * NOT per-package — it lives on the aggregate `DeployStatus`.
 */
export type DeployVisibility = 'public' | 'private';

/**
 * One deployed package within a multi-package deploy.
 *
 * Single-package deploys produce a single-element array. Multi-package
 * deploys (monorepo with N frontends) produce N entries — there is no
 * "primary" package.
 */
export interface DeployStatusPackage {
  name: string;
  /** URL-safe identifier, used as the 5th urlKey segment for multi-package deploys. */
  slug: string;
  framework: DeployFramework;
  /**
   * What kind of deploy server backs this package:
   *   - `'static'`  — built artifact served by a static file server (frontend).
   *   - `'process'` — long-lived backend process (API server).
   * Absent on records from old BE builds → treat as `'static'`.
   * Orthogonal to `framework` (which is the build/artifact shape).
   */
  kind?: 'static' | 'process';
  /**
   * Static-server port. `0` indicates the package is hibernated and a port
   * has not yet been allocated for the current pod.
   */
  port: number;
  /** urlKey segment carried in this package's public URL (4 or 5 part). */
  urlKey: string;
  /** Public URL for THIS package (`/deploy/{urlKey}`). */
  url: string;
  /** Per-package phase. Aggregate `DeployStatus.phase` is derived from these. */
  phase: DeployPhase;
  error?: string;
}

export interface DeployStatus {
  phase: DeployPhase;
  /**
   * Representative Open URL.
   * `null` when there are 2+ packages — UI must use `packages[].url` to
   * render one Open button per deployed package.
   *
   * `undefined` from old BE builds; treat undefined as "no URL available".
   */
  url?: string | null;
  /**
   * Per-package state (multi-package deploys).
   * Always set on responses from new BE; missing from stale records and
   * old BE builds.
   */
  packages?: DeployStatusPackage[];
  /**
   * Access visibility for this deploy build. `undefined` from old BE builds
   * — treat as `'public'`.
   */
  visibility?: DeployVisibility;
  error?: string;
}

export interface DeployLogEntry {
  timestamp: string;
  type: 'stdout' | 'stderr';
  message: string;
}

/**
 * Custom-domain lifecycle status.
 *
 *   pending_dns → verifying → active
 *              ↘ error (any step)
 *
 *   - pending_dns: registered; waiting for the user's DNS records (TXT + CNAME/A).
 *   - verifying:   TXT challenge seen once; confirming ownership.
 *   - active:      ownership confirmed. The domain routes to the deploy and is
 *                  eligible for on-demand certificate issuance (the `tls-ask`
 *                  gate returns 200 only for `active`).
 *   - error:       verification failed / target deploy gone; see `error`.
 */
export type CustomDomainStatus = 'pending_dns' | 'verifying' | 'active' | 'error';

/**
 * Which deploy package kind a custom hostname fronts. One hostname → one
 * package (frontend OR backend); a fullstack app uses two distinct hostnames.
 */
export type CustomDomainTarget = 'frontend' | 'backend';

/**
 * TLS certificate provisioning state for the hostname. Issuance is on-demand
 * (Caddy) at first HTTPS access, so `none`/`pending` are normal before the
 * first hit; ANT does not issue certs itself.
 */
export type CustomDomainCertStatus = 'none' | 'pending' | 'issued' | 'error';

/**
 * A user-owned domain attached to a DEPLOY (never a preview). Keyed by
 * `hostname` (lowercased) in the state store; the tuple
 * `(tenantId,userId,projectId,feature[,slug])` identifies the target package.
 */
export interface CustomDomain {
  /** Fully-qualified hostname, lowercased (e.g. `app.mycompany.com`). SSOT key. */
  hostname: string;
  tenantId: string;
  userId: string;
  projectId: string;
  feature: string;
  /** Deploy package slug for multi-package deploys; omitted for single-package. */
  slug?: string;
  /** Which package kind this hostname serves. */
  target: CustomDomainTarget;
  /** TXT challenge token: `_ant-challenge.<hostname>` must equal this value. */
  verificationToken: string;
  status: CustomDomainStatus;
  certStatus?: CustomDomainCertStatus;
  error?: string;
  /**
   * Wildcard registration: `hostname` holds the base domain (e.g. `example.com`)
   * and this record serves the apex (exact match) PLUS every subdomain
   * (`www.`, `app.`, …) via parent walk-up matching. Ownership is proven once on
   * the base (`_ant-challenge.<base>`); each visited subdomain gets its own
   * on-demand certificate. Omitted/false → exact-hostname match only.
   */
  wildcard?: boolean;
  /** ISO timestamp of registration. */
  createdAt: string;
  /** ISO timestamp when ownership was confirmed (status → active). */
  verifiedAt?: string;
}

/**
 * DNS records the user must create, returned by the register endpoint and
 * rendered by the UI. `apex` distinguishes CNAME (subdomain) vs A (root domain).
 */
export interface CustomDomainDnsInstructions {
  /** TXT ownership record. */
  txt: { name: string; value: string };
  /** Connection record: CNAME target for subdomains, or A-record IPs for apex. */
  connection:
    | { kind: 'cname'; name: string; value: string }
    | { kind: 'a'; name: string; values: string[] };
  apex: boolean;
  /** Wildcard registration — `connection` is a `*.<base>` CNAME covering all subdomains. */
  wildcard?: boolean;
  /**
   * Optional apex A-record for a wildcard registration (a `*.<base>` CNAME does
   * NOT cover the bare apex). Present only when wildcard AND apex IPs are
   * provisioned; lets the root `<base>` reach the same deploy.
   */
  apexConnection?: { kind: 'a'; name: string; values: string[] };
}
