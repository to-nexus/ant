import { StateCreator } from 'zustand';
import { FileState } from '../types';
import type { FileNode, FileResource } from '@/infrastructure/http/api';
import type { AsyncFields } from '@/domain/async';
import { initialAsyncFields } from '@/domain/async';
import { isFigmaDataPopulated } from '@ant/shared';

/**
 * Current file — single SSOT for the file the editor is displaying.
 *
 * `data` is the server ground-truth FileResource (content + meta); `buffer`
 * is the user's dirty edit (null means "no unsaved changes"). Every editor
 * surface (body, header template warning, save button, binary preview) MUST
 * subscribe to this slice. Local `useState<string>` for file content is
 * forbidden — see docs/architecture/ui-async-policy.md.
 */
export type CurrentFileState = AsyncFields<FileResource> & {
  buffer: string | null;
  savingStatus: 'idle' | 'saving' | 'error';
  saveError: Error | null;
};

export const initialCurrentFile = (): CurrentFileState => ({
  ...initialAsyncFields<FileResource>(),
  buffer: null,
  savingStatus: 'idle',
  saveError: null,
});

export interface FileActions {
  selectFile: (filePath: string | undefined, options?: { syncUnpinnedTab?: boolean }) => void;
  setFileTree: (tree: FileNode[]) => void;
  refreshFileTree: (options?: { force?: boolean }) => Promise<void>;

  /**
   * Open a file in the editor. Selects the tab and triggers a GET that
   * populates `currentFile.data`. Safe to call even when already open —
   * re-opens (re-fetches) the same path.
   */
  openFile: (filePath: string, options?: { syncUnpinnedTab?: boolean }) => Promise<void>;
  /** Write dirty content to the in-memory buffer (no network). */
  updateBuffer: (content: string) => void;
  /** PUT the buffer (or current data.content) and replace `data` with the response. */
  saveCurrentFile: () => Promise<void>;
  /** Drop any unsaved edits. */
  discardBuffer: () => void;
  /** Mark the currently-open file as potentially stale (e.g. SSE observed a foreign mutation). */
  markCurrentFileStale: (filePath: string) => void;
  /** Hard reset — used when switching projects/features. */
  resetCurrentFile: () => void;

  setLastViewMode: (mode: 'raw' | 'preview') => void;
  setUnseenArtifacts: (paths: string[]) => void;
  markArtifactsSeen: (paths: string[]) => void;
  setFigmaPopulated: (value: boolean | null) => void;
  refreshFigmaPopulated: () => Promise<void>;
}

export type FileSlice = FileState & FileActions;

let fileTreeInFlight: Promise<void> | null = null;

async function loadFileResource(
  projectId: string,
  featureName: string,
  filePath: string,
): Promise<FileResource> {
  const { fetchFileContent } = await import('@/infrastructure/http/api');
  return fetchFileContent(projectId, featureName, filePath);
}

export const createFileSlice: StateCreator<any, [], [], FileSlice> = (set, get) => ({
  // ==================
  // State
  // ==================
  selectedFile: undefined,
  fileTree: [],
  currentFile: initialCurrentFile(),
  lastViewMode: 'raw',
  unseenArtifacts: [],
  figmaPopulated: null,

  // ==================
  // Actions — tab/tree
  // ==================
  selectFile: (filePath, options) => {
    const normalized = filePath && filePath.length > 0 ? filePath : undefined;
    const syncUnpinnedTab = options?.syncUnpinnedTab !== false;
    const { selectedFile } = get();

    if (normalized === undefined) {
      set({ selectedFile: undefined, currentFile: initialCurrentFile() });
      if (syncUnpinnedTab) {
        get().syncUnpinnedEditorTab?.(undefined);
      }
      const state = get();
      if (state.closeMainPanelTab && (state.editorTabs ?? []).length === 0) {
        state.closeMainPanelTab('fileEdit');
      }
      return;
    }

    if (selectedFile === normalized) {
      // Toggle: close the currently open file.
      set({ selectedFile: undefined, currentFile: initialCurrentFile() });
      if (syncUnpinnedTab) {
        get().syncUnpinnedEditorTab?.(undefined);
      }
      return;
    }

    // Switch to a different file. Reset `currentFile` so the editor never
    // flashes the previous file's meta (e.g. a template warning lingering
    // when swapping to an image, whose path bypasses openFile).
    set((s: any) => {
      return {
        selectedFile: normalized,
        currentFile: initialCurrentFile(),
        mainPanelOpenTabs: {
          ...s.mainPanelOpenTabs,
          fileEdit: true,
        },
      };
    });
    if (syncUnpinnedTab) {
      get().syncUnpinnedEditorTab?.(normalized);
    }
  },

  setFileTree: (tree) => {
    set({ fileTree: tree });

    // If the currently open file has a different mtime in the new tree, the
    // file was mutated by a foreign source — mark stale so the editor refetches.
    const { currentFile, markCurrentFileStale } = get();
    const openPath = currentFile?.data?.path;
    if (!openPath) return;
    const node = findNodeByPath(tree, openPath);
    const currentMtime = currentFile.data?.meta.mtime ?? 0;
    const nodeMtime = node?.meta?.mtime ?? 0;
    if (node && nodeMtime && nodeMtime !== currentMtime) {
      markCurrentFileStale(openPath);
    }
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
        const { fetchFileTree } = await import('@/infrastructure/http/api');
        const tree = await fetchFileTree(selectedProject, selectedFeature, { force: forceRefresh });
        get().setFileTree(tree);
      } catch (error) {
        console.error('Failed to refresh file tree:', error);
      }
    })();

    try { await fileTreeInFlight; }
    finally { fileTreeInFlight = null; }
  },

  // ==================
  // Actions — FileResource SSOT
  // ==================

  openFile: async (filePath, options) => {
    const normalized = filePath && filePath.length > 0 ? filePath : undefined;
    if (!normalized) {
      get().selectFile(undefined);
      return;
    }

    // Route through `selectFile` only when switching — `selectFile` is a
    // toggle, so calling it with the already-selected path would CLOSE the
    // file. `openFile` must be idempotent when re-invoked by the editor
    // panel's useEffect against the currently open path.
    if (get().selectedFile !== normalized) {
      get().selectFile(normalized, { syncUnpinnedTab: options?.syncUnpinnedTab !== false });
    }

    const { selectedProject, selectedFeature } = get();
    if (!selectedProject || !selectedFeature) return;

    set({
      currentFile: {
        ...initialCurrentFile(),
        status: 'loading',
      },
    });

    try {
      const resource = await loadFileResource(selectedProject, selectedFeature, normalized);
      // Ignore stale response if user switched files during the fetch.
      if (get().selectedFile !== normalized) return;
      set({
        currentFile: {
          status: 'ready',
          data: resource,
          error: null,
          refreshing: false,
          buffer: null,
          savingStatus: 'idle',
          saveError: null,
        },
      });
    } catch (err: any) {
      if (get().selectedFile !== normalized) return;
      set({
        currentFile: {
          status: 'error',
          data: null,
          error: err instanceof Error ? err : new Error(String(err)),
          refreshing: false,
          buffer: null,
          savingStatus: 'idle',
          saveError: null,
        },
      });
    }
  },

  updateBuffer: (content) => {
    const { currentFile } = get();
    if (!currentFile.data) return;
    const isClean = content === currentFile.data.content;
    set({
      currentFile: {
        ...currentFile,
        buffer: isClean ? null : content,
      },
    });
  },

  saveCurrentFile: async () => {
    const { currentFile, selectedProject, selectedFeature, setFigmaPopulated } = get();
    const resource = currentFile.data;
    if (!resource || !selectedProject || !selectedFeature) return;

    const content = currentFile.buffer ?? resource.content;

    set({
      currentFile: {
        ...currentFile,
        savingStatus: 'saving',
        saveError: null,
      },
    });

    try {
      const { saveFileContent } = await import('@/infrastructure/http/api');
      const updated = await saveFileContent(selectedProject, selectedFeature, resource.path, content);

      // Ignore stale response if user navigated away during save.
      if (get().selectedFile !== resource.path) return;

      set({
        currentFile: {
          status: 'ready',
          data: updated,
          error: null,
          refreshing: false,
          buffer: null,
          savingStatus: 'idle',
          saveError: null,
        },
      });

      // figmaPopulated is derived from figma.json content; keep it in sync
      // via the same ground-truth response (no SSE round-trip needed).
      if (updated.path.endsWith('figma.json')) {
        try {
          const parsed = JSON.parse(updated.content);
          setFigmaPopulated(isFigmaDataPopulated(parsed));
        } catch {
          setFigmaPopulated(false);
        }
      }
    } catch (err: any) {
      if (get().selectedFile !== resource.path) return;
      set({
        currentFile: {
          ...get().currentFile,
          savingStatus: 'error',
          saveError: err instanceof Error ? err : new Error(String(err)),
        },
      });
      throw err;
    }
  },

  discardBuffer: () => {
    const { currentFile } = get();
    if (currentFile.buffer == null) return;
    set({
      currentFile: {
        ...currentFile,
        buffer: null,
        savingStatus: 'idle',
        saveError: null,
      },
    });
  },

  markCurrentFileStale: (filePath) => {
    const { currentFile, selectedProject, selectedFeature } = get();
    if (!currentFile.data || currentFile.data.path !== filePath) return;
    if (!selectedProject || !selectedFeature) return;

    // Background refetch — keep existing data visible, flip `refreshing`.
    set({
      currentFile: {
        ...currentFile,
        refreshing: true,
      },
    });

    (async () => {
      try {
        const updated = await loadFileResource(selectedProject, selectedFeature, filePath);
        const latest = get().currentFile;
        if (latest.data?.path !== filePath) return; // user moved on
        if (latest.data.meta.mtime === updated.meta.mtime) {
          // Echo: our own write already reflected. Just clear refreshing.
          set({ currentFile: { ...latest, refreshing: false } });
          return;
        }
        // Foreign mutation observed. Keep user's buffer (if any); replace data.
        set({
          currentFile: {
            status: 'ready',
            data: updated,
            error: null,
            refreshing: false,
            buffer: latest.buffer,
            savingStatus: latest.savingStatus,
            saveError: latest.saveError,
          },
        });
      } catch {
        set({ currentFile: { ...get().currentFile, refreshing: false } });
      }
    })();
  },

  resetCurrentFile: () => {
    set({ currentFile: initialCurrentFile() });
  },

  // ==================
  // Misc
  // ==================
  setLastViewMode: (mode) => {
    set({ lastViewMode: mode });
  },

  setUnseenArtifacts: (paths) => {
    set({ unseenArtifacts: paths });
  },

  markArtifactsSeen: (paths) => {
    const current: string[] = get().unseenArtifacts || [];
    const pathSet = new Set(paths);
    const updated = current.filter((p: string) => !pathSet.has(p));
    set({ unseenArtifacts: updated });

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

      const visual = fileTree?.find((n: any) => n.name === 'visual');
      const ui = visual?.children?.find((n: any) => n.name === 'ui');
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

function findNodeByPath(tree: FileNode[], path: string): FileNode | null {
  const parts = path.split('/');
  let nodes: FileNode[] = tree;
  for (let i = 0; i < parts.length; i++) {
    const node = nodes.find(n => n.name === parts[i]);
    if (!node) return null;
    if (i === parts.length - 1) return node.type === 'file' ? node : null;
    if (!node.children) return null;
    nodes = node.children;
  }
  return null;
}
