import { StateCreator } from 'zustand';
import type { DeployStatus, DeployLogEntry } from '@/infrastructure/http/api';

export interface DeploySliceState {
  deployStatus: DeployStatus | undefined;
  deployLogs: DeployLogEntry[];
  isDeployLoading: boolean;
}

export interface DeployActions {
  setDeployStatus: (status: DeployStatus | undefined) => void;
  appendDeployLog: (log: DeployLogEntry) => void;
  clearDeployLogs: () => void;
  setDeployLoading: (loading: boolean) => void;
  refreshDeployStatus: () => Promise<void>;
}

export type DeploySlice = DeploySliceState & DeployActions;

export const createDeploySlice: StateCreator<any, [], [], DeploySlice> = (set, get) => ({
  deployStatus: undefined,
  deployLogs: [],
  isDeployLoading: false,

  setDeployStatus: (status) => {
    set({ deployStatus: status });
  },

  appendDeployLog: (log) => {
    set((state: any) => ({
      deployLogs: [...state.deployLogs, log].slice(-200),
    }));
  },

  clearDeployLogs: () => {
    set({ deployLogs: [] });
  },

  setDeployLoading: (loading) => {
    set({ isDeployLoading: loading });
  },

  refreshDeployStatus: async () => {
    const state = get();
    const { selectedProject, selectedFeature, backendMode, userEmail } = state;
    if (!selectedProject) return;

    if (backendMode === 'cloud' && !userEmail) {
      set({ deployStatus: undefined });
      return;
    }

    try {
      const { getDeployStatus } = await import('@/infrastructure/http/api');
      const status = await getDeployStatus(selectedProject, selectedFeature);
      set({ deployStatus: status });
    } catch (error) {
      console.error('Failed to refresh deploy status:', error);
      set({ deployStatus: undefined });
    }
  },
});
