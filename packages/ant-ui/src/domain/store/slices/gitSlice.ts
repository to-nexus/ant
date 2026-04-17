import { StateCreator } from 'zustand';
import { GitState, GitStatus } from '../types';
import { getGitStatus, getGitChanges, GitChanges } from '@/infrastructure/http/api';

/**
 * gitSlice is the SINGLE SOURCE OF TRUTH for Git state consumed by UI.
 *
 * Includes both:
 *   - gitStatus: disk-level info from `/git/status` (hasGit, remoteUrl, ...)
 *   - gitChanges / isGitInitialized / isFetchingChanges: working-tree info
 *     from `/git/changes` (staged, unstaged, untracked, ahead, behind, ...)
 *
 * Prior to SSOT consolidation these two were split between `gitSlice` and
 * a local `useGitChanges` hook that cached to sessionStorage and re-injected
 * fields back into the store. That created stale-field bugs on feature
 * switches and inconsistent branch logic between ProjectSection and
 * ActionButton. Everything now reads from this slice.
 */

export interface GitActions {
  setGitStatusLoading: (loading: boolean) => void;
  setGitStatusPhase: (phase: 'switching' | 'fetching' | 'pushing' | 'pulling' | 'committing' | 'syncing' | 'initializing' | 'cloning' | 'discarding' | null) => void;
  // NOTE: `setGitStatus` was removed — it was only used by the old
  // `useGitChanges` hook to re-inject working-tree info back into gitStatus.
  // That responsibility now lives inside `fetchGitChanges` itself. Exposing
  // a generic `setGitStatus` writer would re-enable the same SSOT violation.
  fetchGitStatus: (projectId: string, feature?: string) => Promise<void>;
  refreshGitStatus: () => void;
  setBypassFetchTimer: (bypass: boolean) => void;
  fetchGitChanges: (projectId: string, feature?: string) => Promise<void>;
  clearGitChanges: () => void;
}

export type GitSlice = GitState & GitActions;

// In-flight fetchGitChanges promises keyed by `${projectId}:${feature||'base'}`.
// Same-key re-entry reuses the pending promise — prevents 3–4× fan-out when
// feature-switch + SSE gitChange + phase-null + initial load all fire together.
const inFlightGitChanges: Map<string, Promise<void>> = new Map();

const gitChangesKeyOf = (projectId: string, feature?: string): string =>
  `${projectId}:${feature || 'base'}`;

export const createGitSlice: StateCreator<any, [], [], GitSlice> = (set, _get) => ({
  // ==================
  // State
  // ==================
  isGitStatusLoading: false,
  gitStatusPhase: null,
  gitStatus: null,
  gitStatusRefreshTrigger: 0,
  bypassFetchTimer: false,
  gitChanges: null,
  isGitInitialized: null,
  isFetchingChanges: false,
  gitChangesKey: null,

  // ==================
  // Actions
  // ==================
  setGitStatusLoading: (loading) => {
    set({ isGitStatusLoading: loading });
  },

  setGitStatusPhase: (phase) => {
    // Auto-trigger gitChanges refetch on phase-null transition (Git
    // operation just finished). The dedup map ensures this doesn't
    // double-up with the explicit refreshGitStatus() caller.
    const prev = _get().gitStatusPhase;
    set({ gitStatusPhase: phase });
    if (prev !== null && phase === null) {
      const projectId = _get().selectedProject;
      const feature = _get().selectedFeature;
      if (projectId) {
        _get().fetchGitChanges(projectId, feature).catch(() => {
          // Errors are already logged inside fetchGitChanges.
        });
      }
    }
  },

  fetchGitStatus: async (projectId: string, feature?: string) => {
    if (!projectId) {
      set({ gitStatus: { hasGit: false, hasCodebase: false, codebaseHasFiles: false, hasFeatures: false }, isGitStatusLoading: false });
      return;
    }

    set({ isGitStatusLoading: true });
    try {
      const status = await getGitStatus(projectId, feature);
      const prev = _get().gitStatus;
      // Critical: reset fields that getGitStatus does NOT return
      // (hasUpstream/ahead/behind/hasUncommittedChanges come from getGitChanges).
      // Without this reset, feature-switch keeps stale values from the previous
      // feature until fetchGitChanges finishes — which is the root cause of
      // "Commit label shows 10 changes for a clean feature" symptom.
      set({
        gitStatus: prev
          ? {
              ...prev,
              ...status,
              hasUpstream: undefined,
              ahead: undefined,
              behind: undefined,
              hasUncommittedChanges: undefined,
            }
          : status,
      });
    } catch {
      // Transient errors (network, timeout) should not flash "Git uninitialized".
      // Leave gitStatus as-is (null or previous). Retry comes from the next
      // gitStatusRefreshTrigger / bypassFetchTimer cycle.
    } finally {
      set({ isGitStatusLoading: false });
    }
  },

  refreshGitStatus: () => {
    set((state: GitSlice) => ({ gitStatusRefreshTrigger: state.gitStatusRefreshTrigger + 1 }));
  },

  setBypassFetchTimer: (bypass) => {
    set({ bypassFetchTimer: bypass });
  },

  fetchGitChanges: async (projectId: string, feature?: string) => {
    if (!projectId) return;

    const key = gitChangesKeyOf(projectId, feature);

    // Dedup: if a fetch for the same key is already in flight, reuse it.
    const existing = inFlightGitChanges.get(key);
    if (existing) return existing;

    const task = (async () => {
      set({ isFetchingChanges: true });
      try {
        const changes: GitChanges = await getGitChanges(projectId, feature);

        // Guard against stale completion: only commit results if the active
        // feature hasn't changed under us during the await.
        const activeKey = gitChangesKeyOf(_get().selectedProject, _get().selectedFeature);
        if (activeKey !== key) {
          return;
        }

        const totalChanges =
          changes.staged.length + changes.unstaged.length + changes.untracked.length;

        const currentGitStatus = _get().gitStatus;
        const mergedStatus: GitStatus | null = currentGitStatus
          ? {
              ...currentGitStatus,
              hasUpstream: changes.hasUpstream,
              ahead: changes.ahead,
              behind: changes.behind,
              hasUncommittedChanges: totalChanges > 0,
            }
          : null;

        set({
          gitChanges: changes,
          isGitInitialized: changes.isGitInitialized ?? true,
          gitChangesKey: key,
          ...(mergedStatus && { gitStatus: mergedStatus }),
        });
      } catch (error: any) {
        if (error?.message?.includes('not initialized')) {
          set({ gitChanges: null, isGitInitialized: false, gitChangesKey: key });
        } else {
          // Transient errors — leave previous data intact. Next trigger retries.
          console.warn('[gitSlice] fetchGitChanges failed:', error?.message ?? error);
        }
      } finally {
        set({ isFetchingChanges: false });
        inFlightGitChanges.delete(key);
      }
    })();

    inFlightGitChanges.set(key, task);
    return task;
  },

  clearGitChanges: () => {
    // Also scrub the derived fields on gitStatus — they were injected by
    // the previous `fetchGitChanges` and would otherwise survive one React
    // reconciliation window past a feature switch, leaking stale `ahead`/
    // `behind`/`hasUncommittedChanges` into `deriveGitMenuState`.
    const prev = _get().gitStatus;
    set({
      gitChanges: null,
      isGitInitialized: null,
      gitChangesKey: null,
      isFetchingChanges: false,
      ...(prev && {
        gitStatus: {
          ...prev,
          hasUpstream: undefined,
          ahead: undefined,
          behind: undefined,
          hasUncommittedChanges: undefined,
        },
      }),
    });
  },
});
