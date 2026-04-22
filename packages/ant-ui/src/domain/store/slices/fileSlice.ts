import { StateCreator } from 'zustand';
import { FileState } from '../types';
import type { FileNode, FileContent } from '@/infrastructure/http/api';
import { isFigmaDataPopulated } from '@ant/shared';

export interface FileActions {
  selectFile: (filePath: string | undefined) => void;
  setFileTree: (tree: FileNode[]) => void;
  refreshFileTree: (options?: { force?: boolean }) => Promise<void>;
  setFileContent: (content: FileContent | undefined) => void;
  triggerFileReload: (filePath?: string | undefined) => void;
  setLastViewMode: (mode: 'raw' | 'preview') => void;
  setUnseenArtifacts: (paths: string[]) => void;
  markArtifactsSeen: (paths: string[]) => void;
  setFigmaPopulated: (value: boolean | null) => void;
  refreshFigmaPopulated: () => Promise<void>;
}

export type FileSlice = FileState & FileActions;

let fileTreeInFlight: Promise<void> | null = null;

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
  figmaPopulated: null,

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

  refreshFileTree: async (options?: { force?: boolean }) => {
    if (fileTreeInFlight) return fileTreeInFlight;

    const forceRefresh = options?.force ?? true;
    const state = get();
    const { selectedProject, selectedFeature, backendMode, userEmail, connectionStatus } = state;
    
    if (!selectedProject || !selectedFeature) return;
    if (connectionStatus !== 'connected') return;
    
    if (backendMode === 'cloud' && !userEmail) {
      console.log('[Store] Skipping refreshFileTree: Cloud mode requires authentication');
      set({ fileTree: [] });
      return;
    }
    
    fileTreeInFlight = (async () => {
      try {
        const tFetch = performance.now();
        console.log(`[Timing] refreshFileTree REST start (force=${forceRefresh}) @${Math.round(tFetch)}ms`);
        const { fetchFileTree } = await import('@/infrastructure/http/api');
        const tree = await fetchFileTree(selectedProject, selectedFeature, { force: forceRefresh });
        console.log(`[Timing] refreshFileTree REST done (nodes=${tree?.length ?? 0}) +${Math.round(performance.now() - tFetch)}ms @${Math.round(performance.now())}ms`);
        set({ fileTree: tree });
      } catch (error) {
        console.error('Failed to refresh file tree:', error);
      }
    })();

    try { await fileTreeInFlight; }
    finally { fileTreeInFlight = null; }
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

  setFigmaPopulated: (value: boolean | null) => {
    set({ figmaPopulated: value });
  },

  refreshFigmaPopulated: async () => {
    const { selectedProject, selectedFeature, fileTree, refreshFileTree } = get();
    if (!selectedProject || !selectedFeature) {
      set({ figmaPopulated: null });
      return;
    }
    try {
      const { getFigmaConfig } = await import('@/infrastructure/http/api/figma');
      const config = await getFigmaConfig(selectedProject, selectedFeature);
      set({ figmaPopulated: isFigmaDataPopulated(config) });

      // Canonical path: outputs/design/ui/figma/figma.json
      const outputs = fileTree?.find((n: any) => n.name === 'outputs');
      const design = outputs?.children?.find((n: any) => n.name === 'design');
      const ui = design?.children?.find((n: any) => n.name === 'ui');
      const figma = ui?.children?.find((n: any) => n.name === 'figma');
      const hasFigmaInTree = figma?.children?.some((n: any) => n.name === 'figma.json');
      if (!hasFigmaInTree) {
        refreshFileTree();
      }
    } catch {
      set({ figmaPopulated: false });
    }
  },
});

