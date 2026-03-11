import { StateCreator } from 'zustand';
import { FileState } from '../types';
import type { FileNode, FileContent } from '@/infrastructure/http/api';

export interface FileActions {
  selectFile: (filePath: string | undefined) => void;
  setFileTree: (tree: FileNode[]) => void;
  refreshFileTree: () => Promise<void>;
  setFileContent: (content: FileContent | undefined) => void;
  triggerFileReload: (filePath?: string | undefined) => void;
  setLastViewMode: (mode: 'raw' | 'preview') => void;
  setUnseenArtifacts: (paths: string[]) => void;
  markArtifactsSeen: (paths: string[]) => void;
}

export type FileSlice = FileState & FileActions;

export const createFileSlice: StateCreator<any, [], [], FileSlice> = (set, get) => ({
  // ==================
  // State
  // ==================
  selectedFile: undefined,
  fileTree: [],
  fileContent: undefined,
  fileReloadTrigger: 0,
  fileReloadTarget: undefined,
  lastViewMode: 'raw',
  unseenArtifacts: [],

  // ==================
  // Actions
  // ==================
  selectFile: (filePath) => {
    const normalized = filePath && filePath.length > 0 ? filePath : undefined;
    if (normalized === undefined) {
      set({ selectedFile: undefined });
      const state = get();
      if (state.closeMainPanelTab) {
        state.closeMainPanelTab('fileEdit');
      }
    } else {
      const { selectedFile } = get();
      if (selectedFile === normalized) {
        set({ selectedFile: undefined });
      } else {
        set((s: any) => {
          const newOrder = s.mainPanelTabOrder.filter((t: string) => t !== 'fileEdit');
          newOrder.push('fileEdit');
          
          return {
            selectedFile: normalized,
            mainPanelActiveTab: 'fileEdit',
            mainPanelOpenTabs: {
              ...s.mainPanelOpenTabs,
              fileEdit: true
            },
            mainPanelTabOrder: newOrder
          };
        });
      }
    }
  },

  setFileTree: (tree) => {
    set({ fileTree: tree });
  },

  refreshFileTree: async () => {
    const state = get();
    const { selectedProject, selectedFeature, backendMode, userEmail, connectionStatus } = state;
    
    if (!selectedProject || !selectedFeature) return;
    if (connectionStatus !== 'connected') return;
    
    if (backendMode === 'cloud' && !userEmail) {
      console.log('[Store] Skipping refreshFileTree: Cloud mode requires authentication');
      set({ fileTree: [] });
      return;
    }
    
    try {
      const tFetch = performance.now();
      console.log(`[Timing] refreshFileTree REST start @${Math.round(tFetch)}ms`);
      const { fetchFileTree } = await import('@/infrastructure/http/api');
      const tree = await fetchFileTree(selectedProject, selectedFeature, { force: true });
      console.log(`[Timing] refreshFileTree REST done (nodes=${tree?.length ?? 0}) +${Math.round(performance.now() - tFetch)}ms @${Math.round(performance.now())}ms`);
      set({ fileTree: tree });
    } catch (error) {
      console.error('Failed to refresh file tree:', error);
    }
  },

  setFileContent: (content) => {
    set({ fileContent: content });
  },

  triggerFileReload: (filePath) => {
    const target = filePath && filePath.length > 0 ? filePath : get().selectedFile;
    set((s: any) => ({
      fileReloadTrigger: (s.fileReloadTrigger || 0) + 1,
      fileReloadTarget: target
    }));
  },

  setLastViewMode: (mode) => {
    set({ lastViewMode: mode });
  },

  setUnseenArtifacts: (paths) => {
    set({ unseenArtifacts: paths });
  },

  markArtifactsSeen: (paths) => {
    // Optimistic update: remove from local state immediately
    const current: string[] = get().unseenArtifacts || [];
    const pathSet = new Set(paths);
    const updated = current.filter((p: string) => !pathSet.has(p));
    set({ unseenArtifacts: updated });

    // Fire API call in background
    const { selectedProject, selectedFeature } = get();
    if (selectedProject && selectedFeature) {
      import('@/infrastructure/http/api').then(({ authFetch, API_BASE }) => {
        authFetch(
          `${API_BASE()}/projects/${encodeURIComponent(selectedProject)}/features/${encodeURIComponent(selectedFeature)}/mark-seen`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths }),
          }
        ).catch(() => {});
      });
    }
  },
});

