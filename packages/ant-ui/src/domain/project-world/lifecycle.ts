/**
 * useProjectLifecycle — the single orchestrator for `(project, feature)`
 * transitions.
 *
 * Contract (see docs/architecture/24-git-operations.md §0 and §9.6):
 *
 * Whenever `(selectedProject, selectedFeature)` changes, exactly one effect
 * fires and runs:
 *
 *   1. `clearGitWorld()`       — reset snapshot/pat/operation for the new
 *                                 (project, feature) pair. `operation` is
 *                                 preserved so in-flight dispatches survive
 *                                 transient identity flips.
 *   2. `clearProjectConfig()`  — drop cached config so `githubRepo` reloads.
 *   3. `reconnectSSE()`        — the unified SSE stream re-subscribes to the
 *                                 new (project, feature). Server publishes a
 *                                 `gitState` event with `cause='reconnectRefill'`
 *                                 on open which primes git-world.
 *   4. `fetchProjectConfig()`  — populates `githubRepo` (used by GitBadge
 *                                 / GitMenu before disk state arrives).
 *   5. `fetchGitWorldState()`  — final authoritative fetch as a safety net
 *                                 in case the SSE refill event missed (eg.
 *                                 before the subscriber attached).
 *
 * The hook is idempotent: mounting it multiple times in the tree is a bug.
 * It must live on the app root exactly once.
 *
 * NOTE: During the greenfield migration the legacy `setSelectedProject`
 * still performs several of these side-effects inline. That is tolerated
 * because the steps are idempotent; at cutover `setSelectedProject` becomes
 * a pure setter and this hook becomes the only lifecycle driver.
 */

import { useEffect } from 'react';
import { useStore } from '../store';

/**
 * @param opts.enabled  — guard so tests / storybook can disable the effect.
 */
export function useProjectLifecycle(opts: { enabled?: boolean } = {}): void {
  const enabled = opts.enabled ?? true;

  const selectedProject = useStore((s: any) => s.selectedProject as string | undefined);
  const selectedFeature = useStore((s: any) => s.selectedFeature as string | undefined);

  // Pull actions via getState() inside the effect so we don't re-run it on
  // every slice re-render. This also keeps the dep list stable — only the
  // identity (project, feature) triggers orchestration.
  useEffect(() => {
    if (!enabled) return;
    if (!selectedProject) return;

    const state = useStore.getState() as any;

    // (1) Reset git-world for the new identity. Operation is preserved
    // inside clearGitWorld() by design.
    try { state.clearGitWorld?.(); } catch { /* no-op */ }

    // (2) Drop project-config cache.
    try { state.clearProjectConfig?.(); } catch { /* no-op */ }

    // (3) Reconnect SSE so the server publishes `reconnectRefill` for the
    // new (project, feature) pair. If SSE is not yet initialized this call
    // is a no-op; initializeSSE() will pick up the current identity.
    try {
      state.reconnectSSE?.('git');
    } catch { /* no-op */ }

    // (4) Prime project config for the new identity.
    try { state.fetchProjectConfig?.(selectedProject); } catch { /* no-op */ }

    // (5) Safety-net fetch of the authoritative git snapshot. The SSE
    // refill event usually arrives first, but a direct fetch guarantees
    // UI convergence if the subscriber attached late.
    try {
      state.fetchGitWorldState?.(selectedProject, { feature: selectedFeature });
    } catch { /* no-op */ }
  }, [enabled, selectedProject, selectedFeature]);
}
