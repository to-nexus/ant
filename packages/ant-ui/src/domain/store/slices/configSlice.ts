import { StateCreator } from 'zustand';
import { ConfigState } from '../types';
import { STORAGE_KEYS, DEFAULT_LOCAL_BACKEND_PORT, saveToStorage, loadFromStorage } from '../storage';
import { determineInitialLaunchMode } from '../launchModeInit';
import { API_BASE, authFetch } from '@/infrastructure/http/api';

export interface ConfigActions {
  setRecursionLimit: (limit: number) => void;
  loadSystemConfig: () => Promise<void>;
  setLaunchMode: (mode: 'local' | 'cloud') => void;
  setLocalBackendPort: (port: number) => void;
}

export type ConfigSlice = ConfigState & ConfigActions;

export const createConfigSlice: StateCreator<any, [], [], ConfigSlice> = (set, get) => {
  // Resolve launch mode via the SSOT helper (legacy key migration +
  // origin-detection + 'local' default). See `domain/store/launchModeInit.ts`.
  const launchMode = determineInitialLaunchMode();

  // Get local backend port from localStorage (default: 4100)
  const storedLocalBackendPort = loadFromStorage(STORAGE_KEYS.LOCAL_BACKEND_PORT);
  const localBackendPort = storedLocalBackendPort || DEFAULT_LOCAL_BACKEND_PORT;

  return {
    // ==================
    // State
    // ==================
    recursionLimit: 50,
    systemConfigStatus: 'idle',
    launchMode,
    localBackendPort,

    // ==================
    // Actions
    // ==================
    setRecursionLimit: (limit) => {
      set({ recursionLimit: limit });
    },

    loadSystemConfig: async () => {
      set({ systemConfigStatus: 'loading' });
      try {
        const response = await authFetch(`${API_BASE()}/system/config`);
        if (response.ok) {
          const config = await response.json();
          set({ recursionLimit: config.recursionLimit, systemConfigStatus: 'ready' });
          console.log(`[Store] System config loaded: recursionLimit=${config.recursionLimit}`);
        } else {
          set({ systemConfigStatus: 'error' });
        }
      } catch (error) {
        console.error('[Store] Failed to load system config:', error);
        set({ systemConfigStatus: 'error' });
      }
    },

    setLaunchMode: (mode) => {
      const currentMode = get().launchMode;

      if (currentMode === mode) {
        console.log('[Store] Launch mode unchanged:', mode);
        return;
      }

      set({ launchMode: mode });
      saveToStorage(STORAGE_KEYS.LAUNCH_MODE, mode);
      console.log('[Store] Launch mode changed:', currentMode, '→', mode);

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

    setLocalBackendPort: (port) => {
      const currentPort = get().localBackendPort;

      if (currentPort === port) {
        console.log('[Store] Local backend port unchanged:', port);
        return;
      }

      set({ localBackendPort: port });
      saveToStorage(STORAGE_KEYS.LOCAL_BACKEND_PORT, port);
      console.log('[Store] Local backend port changed:', currentPort, '→', port);
    },
  };
};

