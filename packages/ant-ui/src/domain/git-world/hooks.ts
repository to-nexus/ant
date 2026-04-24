/**
 * git-world consumer hooks.
 *
 * Surface intentionally narrow — presentation code reads through these and
 * never imports `infrastructure/api.ts` or the slice internals directly.
 */

import { useMemo } from 'react';
import { useStore } from '../store';
import type {
  GitSnapshot,
  GitOperationState,
  GitPatState,
  GitUserOperation,
  GitOperationError as GitOperationErrorShape,
} from '@ant/shared';
import {
  deriveGitCta,
  deriveGitMenu,
  deriveGitBadge,
  deriveGitSetupCta,
  type GitCta,
  type GitMenu,
  type GitBadge,
  type GitSetupCta,
} from './selectors';

interface GitWorldStoreSurface {
  snapshot: { data: GitSnapshot | null; refreshing: boolean; error: string | null };
  operation: GitOperationState;
  pat: { data: GitPatState | null; refreshing: boolean; error: string | null };
  runGitOperation: (
    projectId: string,
    op: GitUserOperation,
  ) => Promise<{ success: boolean; error?: GitOperationErrorShape }>;
  fetchGitWorldState: (
    projectId: string,
    opts?: { feature?: string; fresh?: boolean },
  ) => Promise<void>;
  fetchGitPat: () => Promise<void>;
  savePat: (pat: string) => Promise<{ success: boolean; error?: string }>;
  deletePat: () => Promise<{ success: boolean; error?: string }>;
  clearGitOperation: () => void;
  clearGitWorld: () => void;
  selectedProject?: string | null;
  selectedFeature?: string | null;
}

// Helper — typed access to the merged store without leaking slice names.
function useGitWorldStore<T>(selector: (s: GitWorldStoreSurface) => T): T {
  return useStore((s: any) => selector(s as GitWorldStoreSurface));
}

/**
 * Returns the current {@link GitSnapshot} or `null` if not yet loaded.
 */
export function useGitSnapshot(): GitSnapshot | null {
  return useGitWorldStore((s) => s.snapshot.data);
}

export function useGitSnapshotRefreshing(): boolean {
  return useGitWorldStore((s) => s.snapshot.refreshing);
}

export function useGitOperation(): GitOperationState {
  return useGitWorldStore((s) => s.operation);
}

export function useGitPat(): GitPatState | null {
  return useGitWorldStore((s) => s.pat.data);
}

export function useGitPatRefreshing(): boolean {
  return useGitWorldStore((s) => s.pat.refreshing);
}

/**
 * Returns the primary CTA discriminated union derived from the snapshot.
 */
export function useGitCta(): GitCta {
  const snapshot = useGitSnapshot();
  return useMemo(() => deriveGitCta(snapshot), [snapshot]);
}

export function useGitMenu(githubRepo: string | null): GitMenu {
  const snapshot = useGitSnapshot();
  return useMemo(() => deriveGitMenu({ snapshot, githubRepo }), [snapshot, githubRepo]);
}

export function useGitBadge(githubRepo: string | null): GitBadge {
  const snapshot = useGitSnapshot();
  return useMemo(() => deriveGitBadge(snapshot, githubRepo), [snapshot, githubRepo]);
}

export function useGitSetupCta(): GitSetupCta {
  const snapshot = useGitSnapshot();
  return useMemo(() => deriveGitSetupCta(snapshot), [snapshot]);
}

export function useGitDispatch() {
  const runGitOperation = useGitWorldStore((s) => s.runGitOperation);
  const fetchGitWorldState = useGitWorldStore((s) => s.fetchGitWorldState);
  const clearGitOperation = useGitWorldStore((s) => s.clearGitOperation);
  const selectedProject = useGitWorldStore((s) => s.selectedProject ?? null);

  return useMemo(
    () => ({
      runGitOperation,
      fetchGitWorldState,
      clearGitOperation,
      selectedProject,
    }),
    [runGitOperation, fetchGitWorldState, clearGitOperation, selectedProject],
  );
}

export function useGitPatDispatch() {
  const fetchGitPat = useGitWorldStore((s) => s.fetchGitPat);
  const savePat = useGitWorldStore((s) => s.savePat);
  const deletePat = useGitWorldStore((s) => s.deletePat);
  return useMemo(() => ({ fetchGitPat, savePat, deletePat }), [fetchGitPat, savePat, deletePat]);
}
