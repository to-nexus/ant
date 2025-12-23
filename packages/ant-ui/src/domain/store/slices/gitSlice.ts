import { StateCreator } from 'zustand';
import { GitState } from '../types';

export interface GitActions {
  setGitStatusLoading: (loading: boolean) => void;
  setGitStatusPhase: (phase: 'switching' | 'fetching' | 'pushing' | 'pulling' | 'committing' | 'syncing' | 'initializing' | 'cloning' | null) => void;
  setCurrentGitBranch: (branch: string | undefined) => void;
}

export type GitSlice = GitState & GitActions;

export const createGitSlice: StateCreator<any, [], [], GitSlice> = (set) => ({
  // ==================
  // State
  // ==================
  isGitStatusLoading: false,
  gitStatusPhase: null,
  currentGitBranch: undefined,
  gitStatusRefreshTrigger: 0,

  // ==================
  // Actions
  // ==================
  setGitStatusLoading: (loading) => {
    set({ isGitStatusLoading: loading });
  },

  setGitStatusPhase: (phase) => {
    set({ gitStatusPhase: phase });
  },

  setCurrentGitBranch: (branch) => {
    set({ currentGitBranch: branch });
  },
});

