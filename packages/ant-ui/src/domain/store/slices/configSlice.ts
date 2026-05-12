import { StateCreator } from 'zustand';
import type { ServerMode, SystemConfigResponse } from '@ant/shared';
import { ConfigState } from '../types';
import { STORAGE_KEYS, DEFAULT_LOCAL_BACKEND_PORT, loadFromStorage, saveToStorage } from '../storage';
import { initialAsyncFields } from '@/domain/async';
import { API_BASE, authFetch } from '@/infrastructure/http/api';

export interface ConfigActions {
  setRecursionLimit: (limit: number) => void;
  loadSystemConfig: () => Promise<void>;
  setLocalBackendPort: (port: number) => void;
}

export type ConfigSlice = ConfigState & ConfigActions;

const LEGACY_LAUNCH_MODE_KEYS = ['ant-ui:launch-mode', 'ant-ui:backend-mode'];

function clearLegacyLaunchModeKeys() {
  try {
    for (const key of LEGACY_LAUNCH_MODE_KEYS) {
      localStorage.removeItem(key);
    }
  } catch {
    // localStorage may be unavailable (SSR, sandboxed iframe). Ignore — the
    // keys are obsolete either way.
  }
}

export const createConfigSlice: StateCreator<any, [], [], ConfigSlice> = (set, get) => {
  clearLegacyLaunchModeKeys();

  const storedLocalBackendPort = loadFromStorage(STORAGE_KEYS.LOCAL_BACKEND_PORT);
  const localBackendPort = storedLocalBackendPort || DEFAULT_LOCAL_BACKEND_PORT;

  return {
    // ==================
    // State
    // ==================
    recursionLimit: 50,
    systemConfigStatus: 'idle',
    serverMode: initialAsyncFields<ServerMode>(),
    localBackendPort,

    // ==================
    // Actions
    // ==================
    setRecursionLimit: (limit) => {
      set({ recursionLimit: limit });
    },

    loadSystemConfig: async () => {
      // Idempotent: system config (ANT_SERVER_MODE / recursionLimit) is BE
      // startup-time fixed. Refetching cycles `serverMode` through loading→ready,
      // which made `selectServerMode` oscillate `null ↔ 'cloud'` and re-fired the
      // `verifyServerMode` effect, looping with `useHealthCheck` via authStatus.
      if (get().systemConfigStatus === 'ready') return;
      set({
        systemConfigStatus: 'loading',
        serverMode: { ...get().serverMode, status: 'loading' },
      });
      try {
        const response = await authFetch(`${API_BASE()}/system/config`);
        if (!response.ok) {
          set({
            systemConfigStatus: 'error',
            serverMode: {
              status: 'error',
              data: null,
              error: new Error(`HTTP ${response.status}`),
              refreshing: false,
            },
          });
          return;
        }
        const config = (await response.json()) as SystemConfigResponse;
        set({
          recursionLimit: config.recursionLimit,
          systemConfigStatus: 'ready',
          serverMode: {
            status: 'ready',
            data: config.authMode,
            error: null,
            refreshing: false,
          },
        });
        console.log(
          `[Store] System config loaded: recursionLimit=${config.recursionLimit}, authMode=${config.authMode}`,
        );
      } catch (error) {
        console.error('[Store] Failed to load system config:', error);
        set({
          systemConfigStatus: 'error',
          serverMode: {
            status: 'error',
            data: null,
            error: error instanceof Error ? error : new Error(String(error)),
            refreshing: false,
          },
        });
      }
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
