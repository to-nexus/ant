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
      set({ gitStatus: { hasGit: false, hasCodebase: false, hasFeatures: false } });
      return;
    }
    
    try {
      const status = await getGitStatus(projectId, feature);
      set({ gitStatus: status });
      console.log('[GitSlice] Git status loaded:', status);
    } catch (error) {
      console.error('[GitSlice] Failed to get Git status:', error);
      set({ gitStatus: { hasGit: false, hasCodebase: false, hasFeatures: false } });
    }
  },
  
  refreshGitStatus: () => {
    set((state: GitSlice) => ({ gitStatusRefreshTrigger: state.gitStatusRefreshTrigger + 1 }));
  },
  
  setBypassFetchTimer: (bypass) => {
    set({ bypassFetchTimer: bypass });
  },
});

