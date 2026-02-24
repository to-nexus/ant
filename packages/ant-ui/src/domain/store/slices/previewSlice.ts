import { StateCreator } from 'zustand';
import type { PreviewStatus } from '@/infrastructure/http/api';

export interface PreviewSliceState {
  previewStatus: PreviewStatus | undefined;
  isPreviewLoading: boolean;
  previewStopGuardUntil: number;
}

export interface PreviewActions {
  setPreviewStatus: (status: PreviewStatus | undefined) => void;
  setPreviewLoading: (loading: boolean) => void;
  setPreviewStopGuardUntil: (until: number) => void;
  refreshPreviewStatus: () => Promise<void>;
}

export type PreviewSlice = PreviewSliceState & PreviewActions;

export const createPreviewSlice: StateCreator<any, [], [], PreviewSlice> = (set, get) => ({
  // State
  previewStatus: undefined,
  isPreviewLoading: false,
  previewStopGuardUntil: 0,

  // Actions
  setPreviewStatus: (status) => {
    set({ previewStatus: status });
  },

  setPreviewLoading: (loading) => {
    set({ isPreviewLoading: loading });
  },

  setPreviewStopGuardUntil: (until) => {
    set({ previewStopGuardUntil: until });
  },

  refreshPreviewStatus: async () => {
    const state = get();
    const { selectedProject, backendMode, userEmail } = state;
    if (!selectedProject) return;
    
    if (backendMode === 'cloud' && !userEmail) {
      console.log('[Store] Skipping refreshPreviewStatus: Cloud mode requires authentication');
      set({ previewStatus: undefined });
      return;
    }
    
    try {
      const { getPreviewStatus } = await import('@/infrastructure/http/api');
      const status = await getPreviewStatus(selectedProject);
      set({ previewStatus: status });
    } catch (error) {
      console.error('Failed to refresh preview status:', error);
      set({ previewStatus: undefined });
    }
  },
});
