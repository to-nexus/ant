import { StateCreator } from 'zustand';
import { ConfigState } from '../types';
import { STORAGE_KEYS, saveToStorage, loadFromStorage } from '../storage';
import { getApiBase } from '@/infrastructure/http/api';

export interface ConfigActions {
  setRecursionLimit: (limit: number) => void;
  loadSystemConfig: () => Promise<void>;
  setBackendMode: (mode: 'local' | 'cloud') => void;
}

export type ConfigSlice = ConfigState & ConfigActions;

export const createConfigSlice: StateCreator<any, [], [], ConfigSlice> = (set, get) => {
  // Get frontend mode from env
  const frontendMode = (import.meta.env.VITE_FRONTEND_MODE || 'local') as 'local' | 'cloud';
  
  // Get backend mode from localStorage
  const storedBackendMode = loadFromStorage(STORAGE_KEYS.BACKEND_MODE);
  const backendMode = (storedBackendMode || 'cloud') as 'local' | 'cloud';

  return {
    // ==================
    // State
    // ==================
    recursionLimit: 50,
    frontendMode,
    backendMode,

    // ==================
    // Actions
    // ==================
    setRecursionLimit: (limit) => {
      set({ recursionLimit: limit });
    },

    loadSystemConfig: async () => {
      try {
        const response = await fetch(`${getApiBase()}/system/config`);
        if (response.ok) {
          const config = await response.json();
          set({ recursionLimit: config.recursionLimit });
          console.log(`[Store] System config loaded: recursionLimit=${config.recursionLimit}`);
        }
      } catch (error) {
        console.error('[Store] Failed to load system config:', error);
      }
    },

    setBackendMode: (mode) => {
      const currentMode = get().backendMode;
      
      if (currentMode === mode) {
        console.log('[Store] Backend mode unchanged:', mode);
        return;
      }
      
      set({ backendMode: mode });
      saveToStorage(STORAGE_KEYS.BACKEND_MODE, mode);
      console.log('[Store] Backend mode changed:', currentMode, '→', mode);
      
      // Clear user info when switching from Cloud to Local
      if (currentMode === 'cloud' && mode === 'local') {
        const state = get();
        if (state.userEmail && state.clearUser) {
          console.log('[Store] Clearing user info (Cloud → Local)');
          state.clearUser();
        }
      }
      
      // Clear projects when switching modes
      set({ projects: [], selectedProject: undefined, selectedFeature: undefined });
    },
  };
};

