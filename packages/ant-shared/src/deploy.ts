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

export interface DeployStatus {
  phase: DeployPhase;
  url?: string;
  port?: number;
  framework?: string;
  error?: string;
}

export interface DeployLogEntry {
  timestamp: string;
  type: 'stdout' | 'stderr';
  message: string;
}
