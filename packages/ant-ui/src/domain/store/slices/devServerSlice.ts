import { StateCreator } from 'zustand';
import { DevServerState } from '../types';
import type { DevServerStatus } from '@/infrastructure/http/api';

export interface DevServerActions {
  setDevServerStatus: (status: DevServerStatus | undefined) => void;
  setDevServerLoading: (loading: boolean) => void;
  refreshDevServerStatus: () => Promise<void>;
}

export type DevServerSlice = DevServerState & DevServerActions;

export const createDevServerSlice: StateCreator<any, [], [], DevServerSlice> = (set, get) => ({
  // ==================
  // State
  // ==================
  devServerStatus: undefined,
  isDevServerLoading: false,

  // ==================
  // Actions
  // ==================
  setDevServerStatus: (status) => {
    set({ devServerStatus: status });
  },

  setDevServerLoading: (loading) => {
    set({ isDevServerLoading: loading });
  },

  refreshDevServerStatus: async () => {
    const state = get();
    const { selectedProject, backendMode, userEmail } = state;
    if (!selectedProject) return;
    
    if (backendMode === 'cloud' && !userEmail) {
      console.log('[Store] Skipping refreshDevServerStatus: Cloud mode requires authentication');
      set({ devServerStatus: undefined });
      return;
    }
    
    try {
      const { getDevServerStatus } = await import('@/infrastructure/http/api');
      const status = await getDevServerStatus(selectedProject);
      set({ devServerStatus: status });
    } catch (error) {
      console.error('Failed to refresh dev server status:', error);
      set({ devServerStatus: undefined });
    }
  },
});

