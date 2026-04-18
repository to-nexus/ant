import { useEffect, useRef } from 'react';
import { useStore } from '@/domain/store';
import { useGitActions } from './useGitActions';

/**
 * Centralized git auto-refresh on project/feature change.
 *
 * Mount this hook **once** near the root of the tree that owns the git UI
 * (e.g. from `ProjectSection`). It:
 *   1. Reacts to `selectedProject` / `selectedFeature` changes.
 *   2. Waits for session restore to finish (so we don't fetch the wrong
 *      feature's git data while the restored feature is still being set).
 *   3. Issues `fetchGitAll` to populate both `gitStatus` and `gitChanges`.
 *   4. Issues `fetchFromRemote` to refresh `ahead`/`behind` from origin
 *      (timer-guarded inside the action).
 *
 * Previously this logic was spread across four useEffects in three files,
 * coupled via `gitStatusRefreshTrigger` + `bypassFetchTimer`. Consolidating
 * it here removes the carrier flags and makes the refresh policy auditable
 * in one place.
 */
export function useGitRefresh(): void {
  const selectedProject = useStore((s) => s.selectedProject);
  const selectedFeature = useStore((s) => s.selectedFeature);
  const isSessionRestoring = useStore((s) => s.isSessionRestoring);
  const { fetchGitAll, fetchFromRemote } = useGitActions();

  // Track last key to avoid refetching on other state changes.
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedProject) {
      lastKeyRef.current = null;
      return;
    }
    // Wait for session restore to complete: during restore, selectedFeature
    // may transiently be `undefined` before flipping to the restored feature.
    if (isSessionRestoring) return;

    const key = `${selectedProject}:${selectedFeature || 'base'}`;
    if (lastKeyRef.current === key) return;
    lastKeyRef.current = key;

    const feature = selectedFeature || undefined;
    // Populate both objects first, then try the (throttled) remote fetch so
    // ahead/behind reflect origin. fetchFromRemote refetches changes itself.
    fetchGitAll(selectedProject, feature).then(() => {
      fetchFromRemote(selectedProject, feature);
    });
  }, [selectedProject, selectedFeature, isSessionRestoring, fetchGitAll, fetchFromRemote]);
}
