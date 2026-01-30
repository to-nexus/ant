import { StateCreator } from 'zustand';
import type { PreviewStatus } from '@/infrastructure/http/api';

export interface PreviewSliceState {
  previewStatus: PreviewStatus | undefined;
  isPreviewLoading: boolean;
  // Backward compatibility aliases
  devServerStatus: PreviewStatus | undefined;
  isDevServerLoading: boolean;
}

export interface PreviewActions {
  setPreviewStatus: (status: PreviewStatus | undefined) => void;
  setPreviewLoading: (loading: boolean) => void;
  refreshPreviewStatus: () => Promise<void>;
  // Backward compatibility aliases
  setDevServerStatus: (status: PreviewStatus | undefined) => void;
  setDevServerLoading: (loading: boolean) => void;
  refreshDevServerStatus: () => Promise<void>;
}

export type PreviewSlice = PreviewSliceState & PreviewActions;

export const createPreviewSlice: StateCreator<any, [], [], PreviewSlice> = (set, get) => ({
  // ==================
  // State
  // ==================
  previewStatus: undefined,
  isPreviewLoading: false,
  // Backward compatibility - same reference
  get devServerStatus() { return this.previewStatus; },
  get isDevServerLoading() { return this.isPreviewLoading; },

  // ==================
  // Actions
  // ==================
  setPreviewStatus: (status) => {
    set({ previewStatus: status, devServerStatus: status });
  },

  setPreviewLoading: (loading) => {
    set({ isPreviewLoading: loading, isDevServerLoading: loading });
  },

  refreshPreviewStatus: async () => {
    const state = get();
    const { selectedProject, backendMode, userEmail } = state;
    if (!selectedProject) return;
    
    if (backendMode === 'cloud' && !userEmail) {
      console.log('[Store] Skipping refreshPreviewStatus: Cloud mode requires authentication');
      set({ previewStatus: undefined, devServerStatus: undefined });
      return;
    }
    
    try {
      const { getPreviewStatus } = await import('@/infrastructure/http/api');
      const status = await getPreviewStatus(selectedProject);
      set({ previewStatus: status, devServerStatus: status });
    } catch (error) {
      console.error('Failed to refresh preview status:', error);
      set({ previewStatus: undefined, devServerStatus: undefined });
    }
  },

  // Backward compatibility aliases
  setDevServerStatus: (status) => {
    set({ previewStatus: status, devServerStatus: status });
  },

  setDevServerLoading: (loading) => {
    set({ isPreviewLoading: loading, isDevServerLoading: loading });
  },

  refreshDevServerStatus: async function() {
    return (this as any).refreshPreviewStatus();
  },
});

// ==========================================
// Backward compatibility aliases (deprecated)
// ==========================================

/** @deprecated Use PreviewActions instead */
export type DevServerActions = PreviewActions;
/** @deprecated Use PreviewSlice instead */
export type DevServerSlice = PreviewSlice;
/** @deprecated Use createPreviewSlice instead */
export const createDevServerSlice = createPreviewSlice;
