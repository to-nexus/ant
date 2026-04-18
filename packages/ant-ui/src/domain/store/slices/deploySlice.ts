import { StateCreator } from 'zustand';
import type { DeployStatus, DeployLogEntry } from '@/infrastructure/http/api';

export interface PerFeatureDeployState {
  status: DeployStatus | undefined;
  logs: DeployLogEntry[];
  isLoading: boolean;
}

export interface DeploySliceState {
  /** Map keyed by `${projectId}:${featureName}` — isolates state per feature. */
  deployByFeature: Record<string, PerFeatureDeployState>;
}

export interface DeployActions {
  setDeployStatus: (key: string, status: DeployStatus | undefined) => void;
  appendDeployLog: (key: string, log: DeployLogEntry) => void;
  clearDeployLogs: (key: string) => void;
  setDeployLoading: (key: string, loading: boolean) => void;
  removeDeployEntry: (key: string) => void;
  refreshDeployStatus: (projectId: string, featureName: string) => Promise<void>;
}

export type DeploySlice = DeploySliceState & DeployActions;

/**
 * Build the canonical per-feature key. Returns null when either input is
 * missing — callers must skip state reads/writes in that case.
 */
export function makeFeatureKey(
  projectId: string | undefined,
  featureName: string | undefined,
): string | null {
  if (!projectId || !featureName) return null;
  return `${projectId}:${featureName}`;
}

const emptyEntry = (): PerFeatureDeployState => ({
  status: undefined,
  logs: [],
  isLoading: false,
});

// Stable reference for "no logs" — selectors must return the SAME array
// instance on repeated calls, otherwise Zustand treats every unrelated
// store update as a log change and re-renders subscribers needlessly.
const EMPTY_LOGS: DeployLogEntry[] = Object.freeze([]) as unknown as DeployLogEntry[];

export function selectDeployStatus(
  s: { deployByFeature: Record<string, PerFeatureDeployState> },
  key: string | null,
): DeployStatus | undefined {
  if (!key) return undefined;
  return s.deployByFeature[key]?.status;
}

export function selectDeployLogs(
  s: { deployByFeature: Record<string, PerFeatureDeployState> },
  key: string | null,
): DeployLogEntry[] {
  if (!key) return EMPTY_LOGS;
  return s.deployByFeature[key]?.logs ?? EMPTY_LOGS;
}

export function selectIsDeployLoading(
  s: { deployByFeature: Record<string, PerFeatureDeployState> },
  key: string | null,
): boolean {
  if (!key) return false;
  return s.deployByFeature[key]?.isLoading ?? false;
}

export const createDeploySlice: StateCreator<any, [], [], DeploySlice> = (set, get) => ({
  deployByFeature: {},

  setDeployStatus: (key, status) => {
    set((state: any) => ({
      deployByFeature: {
        ...state.deployByFeature,
        [key]: {
          ...(state.deployByFeature[key] ?? emptyEntry()),
          status,
        },
      },
    }));
  },

  appendDeployLog: (key, log) => {
    set((state: any) => {
      const cur = state.deployByFeature[key] ?? emptyEntry();
      return {
        deployByFeature: {
          ...state.deployByFeature,
          [key]: { ...cur, logs: [...cur.logs, log].slice(-200) },
        },
      };
    });
  },

  clearDeployLogs: (key) => {
    set((state: any) => ({
      deployByFeature: {
        ...state.deployByFeature,
        [key]: { ...(state.deployByFeature[key] ?? emptyEntry()), logs: [] },
      },
    }));
  },

  setDeployLoading: (key, loading) => {
    set((state: any) => ({
      deployByFeature: {
        ...state.deployByFeature,
        [key]: { ...(state.deployByFeature[key] ?? emptyEntry()), isLoading: loading },
      },
    }));
  },

  removeDeployEntry: (key) => {
    set((state: any) => {
      if (!state.deployByFeature[key]) return state;
      const next = { ...state.deployByFeature };
      delete next[key];
      return { deployByFeature: next };
    });
  },

  refreshDeployStatus: async (projectId, featureName) => {
    const key = makeFeatureKey(projectId, featureName);
    if (!key) return;
    const state = get();
    const { backendMode, userEmail } = state;
    if (backendMode === 'cloud' && !userEmail) {
      get().setDeployStatus(key, undefined);
      return;
    }

    try {
      const { getDeployStatus } = await import('@/infrastructure/http/api');
      const status = await getDeployStatus(projectId, featureName);
      get().setDeployStatus(key, status);
    } catch (error) {
      console.error('Failed to refresh deploy status:', error);
      get().setDeployStatus(key, undefined);
    }
  },
});
