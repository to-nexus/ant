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
