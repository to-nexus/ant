import { StateCreator } from 'zustand';
import type { GitStatusResponse, GitChangesResponse } from '@ant/shared';
import { GitState, GitPhase } from '../types';
import { getGitStatus, getGitChanges, fetchFromGitHub } from '@/infrastructure/http/api';
import { GIT_FETCH_INTERVAL } from '@/shared/utils/constants';

/**
 * gitSlice — Single source of truth for Git state consumed by the UI.
 *
 * Two REST endpoints feed two store fields. No merging, no derived fields
 * re-injected into the other object:
 *   - `/git/status` → `gitStatus` (disk-level: hasGit, remoteUrl, codebaseHasFiles…)
 *   - `/git/changes` → `gitChanges` (working-tree: staged/unstaged/untracked,
 *      ahead, behind, isGitInitialized, hasUpstream)
 *
 * Each fetch uses a stale-guard (`${projectId}:${feature||'base'}` key
 * compared against current selection at completion) and in-flight dedup.
 * Actions are explicit — no counters, no bypass flags, no auto-triggers from
 * phase transitions.
 */

// Key helper: matches SSE gitChange "same feature" comparison.
const keyOf = (projectId: string, feature?: string): string =>
  `${projectId}:${feature || 'base'}`;

// In-flight dedup per fetch type.
const inFlightStatus: Map<string, Promise<void>> = new Map();
const inFlightChanges: Map<string, Promise<void>> = new Map();

// Stale-guard helper: ensure the active (selectedProject, selectedFeature) is
// still the one we fetched for. Prevents a slow response for feature A from
// overwriting state that already belongs to feature B.
function isStillActive(store: any, projectId: string, feature?: string): boolean {
  return (
    store.selectedProject === projectId &&
    (store.selectedFeature || undefined) === (feature || undefined)
  );
}

export interface GitActions {
  fetchGitStatus: (projectId: string, feature?: string) => Promise<void>;
  fetchGitChanges: (projectId: string, feature?: string) => Promise<void>;
  /** Convenience: run both fetches in parallel. Use on project/feature change. */
  fetchGitAll: (projectId: string, feature?: string) => Promise<void>;
  /** Timer-guarded remote fetch + refresh changes. Used by the Fetch button
   *  and by feature-switch auto-refresh. Atomic sequence in one action. */
  fetchFromRemote: (projectId: string, feature?: string) => Promise<void>;
  /** Pure writer — no auto-triggered side effects. */
  setGitStatusPhase: (phase: GitPhase | null) => void;
  /** Clear both objects and fetch states. Use on project/feature change. */
  clearGitState: () => void;
}

export type GitSlice = GitState & GitActions;

// Last-fetch throttle for the Fetch-from-remote button. Keyed per
// (project, feature) in sessionStorage so it survives reloads.
function shouldSkipRemoteFetch(projectId: string, feature: string | undefined): boolean {
  const key = `git-fetch-time:${projectId}:${feature || 'base'}`;
  const last = sessionStorage.getItem(key);
  if (!last) return false;
  return Date.now() - parseInt(last, 10) < GIT_FETCH_INTERVAL;
}

function recordRemoteFetch(projectId: string, feature: string | undefined): void {
  const key = `git-fetch-time:${projectId}:${feature || 'base'}`;
  sessionStorage.setItem(key, Date.now().toString());
}

export const createGitSlice: StateCreator<any, [], [], GitSlice> = (set, _get) => ({
  // ==================
  // State
  // ==================
  gitStatus: null,
  gitChanges: null,
  statusFetchState: 'idle',
  changesFetchState: 'idle',
  gitStatusPhase: null,

  // ==================
  // Actions
  // ==================
  fetchGitStatus: async (projectId: string, feature?: string) => {
    if (!projectId) return;

    const key = keyOf(projectId, feature);
    const existing = inFlightStatus.get(key);
    if (existing) return existing;

    const task = (async () => {
      set({ statusFetchState: 'pending' });
      try {
        const status: GitStatusResponse = await getGitStatus(projectId, feature);
        if (!isStillActive(_get(), projectId, feature)) return;
        set({ gitStatus: status });
      } catch (error: any) {
        // Transient error — preserve previous gitStatus rather than flash a
        // "git uninitialized" UI. Consumers retry by invoking fetch again.
        console.warn('[gitSlice] fetchGitStatus failed:', error?.message ?? error);
      } finally {
        if (isStillActive(_get(), projectId, feature)) {
          set({ statusFetchState: 'idle' });
        }
        inFlightStatus.delete(key);
      }
    })();

    inFlightStatus.set(key, task);
    return task;
  },

  fetchGitChanges: async (projectId: string, feature?: string) => {
    if (!projectId) return;

    const key = keyOf(projectId, feature);
    const existing = inFlightChanges.get(key);
    if (existing) return existing;

    const task = (async () => {
      set({ changesFetchState: 'pending' });
      try {
        const changes: GitChangesResponse = await getGitChanges(projectId, feature);
        if (!isStillActive(_get(), projectId, feature)) return;
        set({ gitChanges: changes });
      } catch (error: any) {
        if (error?.message?.includes('not initialized')) {
          // Explicit "no .git yet" — record with a zeroed shape so consumers
          // can render "uninitialized" without treating it as still-loading.
          if (isStillActive(_get(), projectId, feature)) {
            set({
              gitChanges: {
                staged: [],
                unstaged: [],
                untracked: [],
                ahead: 0,
                behind: 0,
                isGitInitialized: false,
                hasUpstream: false,
              },
            });
          }
        } else {
          console.warn('[gitSlice] fetchGitChanges failed:', error?.message ?? error);
        }
      } finally {
        if (isStillActive(_get(), projectId, feature)) {
          set({ changesFetchState: 'idle' });
        }
        inFlightChanges.delete(key);
      }
    })();

    inFlightChanges.set(key, task);
    return task;
  },

  fetchGitAll: async (projectId: string, feature?: string) => {
    if (!projectId) return;
    const self = _get();
    await Promise.all([
      self.fetchGitStatus(projectId, feature),
      self.fetchGitChanges(projectId, feature),
    ]);
  },

  fetchFromRemote: async (projectId: string, feature?: string) => {
    if (!projectId) return;
    const self = _get();

    // Throttle: respect GIT_FETCH_INTERVAL so feature switches during rapid
    // navigation don't hammer the origin. Still refresh local changes.
    if (shouldSkipRemoteFetch(projectId, feature)) {
      await self.fetchGitChanges(projectId, feature);
      return;
    }

    self.setGitStatusPhase('fetching');
    try {
      try {
        const result = await fetchFromGitHub(projectId, feature);
        if (result?.success) {
          recordRemoteFetch(projectId, feature);
        }
      } catch (err) {
        console.warn('[gitSlice] fetchFromRemote network error:', err);
      }
    } finally {
      self.setGitStatusPhase(null);
      // Always refresh changes so ahead/behind reflect the latest origin.
      await self.fetchGitChanges(projectId, feature);
    }
  },

  setGitStatusPhase: (phase) => {
    set({ gitStatusPhase: phase });
  },

  clearGitState: () => {
    set({
      gitStatus: null,
      gitChanges: null,
      statusFetchState: 'idle',
      changesFetchState: 'idle',
      gitStatusPhase: null,
    });
  },
});
