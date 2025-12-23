import { StateCreator } from 'zustand';
import { FileState } from '../types';
import type { FileNode, FileContent } from '@/infrastructure/http/api';

export interface FileActions {
  selectFile: (filePath: string | undefined) => void;
  setFileTree: (tree: FileNode[]) => void;
  refreshFileTree: () => Promise<void>;
  setFileContent: (content: FileContent | undefined) => void;
}

export type FileSlice = FileState & FileActions;

export const createFileSlice: StateCreator<any, [], [], FileSlice> = (set, get) => ({
  // ==================
  // State
  // ==================
  selectedFile: undefined,
  fileTree: [],
  fileContent: undefined,

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
    const { selectedProject, selectedFeature, backendMode, userEmail } = state;
    
    if (!selectedProject || !selectedFeature) return;
    
    if (backendMode === 'cloud' && !userEmail) {
      console.log('[Store] Skipping refreshFileTree: Cloud mode requires authentication');
      set({ fileTree: [] });
      return;
    }
    
    try {
      const { fetchFileTree } = await import('@/infrastructure/http/api');
      const tree = await fetchFileTree(selectedProject, selectedFeature);
      set({ fileTree: tree });
    } catch (error) {
      console.error('Failed to refresh file tree:', error);
    }
  },

  setFileContent: (content) => {
    set({ fileContent: content });
  },
});

