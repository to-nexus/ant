import { StateCreator } from 'zustand';
import { GitState, GitStatus } from '../types';
import { getGitStatus } from '@/infrastructure/http/api';

export interface GitActions {
  setGitStatusLoading: (loading: boolean) => void;
  setGitStatusPhase: (phase: 'switching' | 'fetching' | 'pushing' | 'pulling' | 'committing' | 'syncing' | 'initializing' | 'cloning' | 'discarding' | null) => void;
  setGitStatus: (status: GitStatus | null) => void;
  fetchGitStatus: (projectId: string, feature?: string) => Promise<void>;
  refreshGitStatus: () => void;
  setBypassFetchTimer: (bypass: boolean) => void;
}

export type GitSlice = GitState & GitActions;

export const createGitSlice: StateCreator<any, [], [], GitSlice> = (set, _get) => ({
  // ==================
  // State
  // ==================
  isGitStatusLoading: false,
  gitStatusPhase: null,
  gitStatus: null,  // ✅ Single source of truth
  gitStatusRefreshTrigger: 0,
  bypassFetchTimer: false,  // ✅ Default: respect timer

  // ==================
  // Actions
  // ==================
  setGitStatusLoading: (loading) => {
    set({ isGitStatusLoading: loading });
  },

  setGitStatusPhase: (phase) => {
    set({ gitStatusPhase: phase });
  },

  setGitStatus: (status) => {
    set({ gitStatus: status });
  },
  
  fetchGitStatus: async (projectId: string, feature?: string) => {
    if (!projectId) {
      set({ gitStatus: { hasGit: false, hasCodebase: false, hasFeatures: false }, isGitStatusLoading: false });
      return;
    }
    
    set({ isGitStatusLoading: true });
    try {
      const status = await getGitStatus(projectId, feature);
      const prev = _get().gitStatus;
      set({ gitStatus: prev ? { ...prev, ...status } : status });
    } catch {
      // Transient errors (network, timeout) should not reset git status.
      // Only clear if there was no previous status at all.
      if (!_get().gitStatus) {
        set({ gitStatus: { hasGit: false, hasCodebase: false, hasFeatures: false } });
      }
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
});

