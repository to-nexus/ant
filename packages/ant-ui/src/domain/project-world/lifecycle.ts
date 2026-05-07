/**
 * useProjectLifecycle — the single orchestrator for `(project, feature)`
 * transitions.
 *
 * Contract (see docs/architecture/24-git-operations.md §0 and §9.6):
 *
 * Whenever `(selectedProject, selectedFeature)` changes, exactly one effect
 * fires and runs:
 *
 *   1. `clearGitWorld()`       — reset snapshot/pat for the new (project,
 *                                 feature) pair. `operation` is preserved so
 *                                 in-flight dispatches survive transient
 *                                 identity flips.
 *   2. `clearProjectConfig()`  — drop cached config so `githubRepo` reloads.
 *   3. `initializeSSE()`       — re-subscribe the unified SSE stream to the
 *                                 new (project, feature). Server publishes a
 *                                 `gitState` event with `cause='reconnectRefill'`
 *                                 on connect-open, which primes git-world.
 *   4. `fetchProjectConfig()`  — populates `githubRepo` (used by GitBadge
 *                                 / GitMenu before disk state arrives).
 *   5. `fetchGitWorldState()`  — final authoritative fetch as a safety net
 *                                 in case the SSE refill event missed (eg.
 *                                 the subscriber attached after emission).
 *
 * The hook is idempotent and MUST be mounted exactly once near the app root.
 */

import { useEffect } from 'react';
import { useStore } from '../store';
import { selectIsAuthBlocked } from '../store/selectors';

/**
 * @param opts.enabled  — guard so tests / storybook can disable the effect.
 */
export function useProjectLifecycle(opts: { enabled?: boolean } = {}): void {
  const enabled = opts.enabled ?? true;

  const selectedProject = useStore((s: any) => s.selectedProject as string | undefined);
  const selectedFeature = useStore((s: any) => s.selectedFeature as string | undefined);
  // Subscribed so 'verifying' → 'verified' re-fires the orchestration once
  // the cloud JWT cookie is confirmed. Without this, an authed boot that
  // hydrates `selectedProject` from sessionStorage would never run the
  // initial git-world / project-config prime — `selectIsAuthBlocked` would
  // bounce the only effect run.
  const authStatus = useStore((s: any) => s.authStatus as string | undefined);

  // Pull actions via getState() inside the effect so we don't re-run it on
  // every slice re-render. Only identity changes trigger orchestration.
  useEffect(() => {
    if (!enabled) return;
    if (!selectedProject) return;

    const state = useStore.getState() as any;

    // Stale-session guard. Without this, a cloud-mode page entry with
    // expired JWT cookie still observes a stale `selectedProject` and
    // fans out fetchProjectConfig + fetchGitWorldState before
    // `clearUser` 's cascade can scrub the identity. See
    // plan `stale-session-lifecycle-cascade`.
    if (selectIsAuthBlocked(state)) return;

    // (1) Reset git-world for the new identity.
    try { state.clearGitWorld?.(); } catch { /* no-op */ }

    // (2) Drop project-config cache.
    try { state.clearProjectConfig?.(); } catch { /* no-op */ }

    // (3) Re-subscribe the unified SSE stream. `initializeSSE()` is the
    // only writer that actually connects — `reconnectSSE(key)` is scoped to
    // legacy kanban/chat/fileTree keys and does not recognize 'git'. We
    // call `initializeSSE` directly here; its own guard against missing
    // (project|feature) is respected — when a project is selected without
    // a feature, the `setSelectedFeature` path finishes the connection.
    try {
      if (selectedFeature !== undefined && typeof state.initializeSSE === 'function') {
        state.initializeSSE();
      }
    } catch { /* no-op */ }

    // (4) Prime project config for the new identity.
    try { state.fetchProjectConfig?.(selectedProject); } catch { /* no-op */ }

    // (5) Safety-net authoritative fetch. SSE `reconnectRefill` usually
    // wins, but the direct call guarantees convergence on slow opens.
    try {
      state.fetchGitWorldState?.(selectedProject, { feature: selectedFeature });
    } catch { /* no-op */ }
  }, [enabled, selectedProject, selectedFeature, authStatus]);
}
