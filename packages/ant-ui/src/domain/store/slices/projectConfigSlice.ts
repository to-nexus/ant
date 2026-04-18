import { StateCreator } from 'zustand';
import {
  fetchProjectConfig as apiFetchProjectConfig,
  createProjectConfig as apiCreateProjectConfig,
  updateProjectConfig as apiUpdateProjectConfig,
  ProjectConfig,
} from '@/infrastructure/http/api';
import type { AsyncFields } from '@/domain/async';
import { initialAsyncFields } from '@/domain/async';

/**
 * projectConfigSlice — holds the currently-selected project's `ProjectConfig`
 * as an AsyncFields<T> view. The previous two-field model (data + tri-state
 * exists flag) conflated loading / empty / unknown and spawned the shared-
 * text loading-vs-empty bug. All readers now go through
 * `selectProjectConfigMissing` / `selectProjectConfigExists` selectors.
 * See docs/architecture/ui-async-policy.md.
 */

export interface ProjectConfigState {
  projectConfig: AsyncFields<ProjectConfig>;
}

export interface ProjectConfigActions {
  fetchProjectConfig: (projectId: string) => Promise<void>;
  createProjectConfig: (
    projectId: string,
    backendMode: 'local' | 'cloud',
  ) => Promise<void>;
  /**
   * Save an edited ProjectConfig. Returns `{ success, error? }` so editors
   * can surface persistence failures without subscribing to the slice.
   * On success, triggers `fetchGitAll` so disk-level flags (remoteUrl,
   * hasGit) reflect the new config.
   */
  updateProjectConfig: (
    projectId: string,
    config: ProjectConfig,
  ) => Promise<{ success: boolean; error?: string }>;
  clearProjectConfig: () => void;
}

export type ProjectConfigSlice = ProjectConfigState & ProjectConfigActions;

// Dedup map keyed by projectId — same-project re-fetch reuses in-flight promise.
const inFlight: Map<string, Promise<void>> = new Map();

export const createProjectConfigSlice: StateCreator<
  any,
  [],
  [],
  ProjectConfigSlice
> = (set, get) => ({
  projectConfig: initialAsyncFields<ProjectConfig>(),

  fetchProjectConfig: async (projectId) => {
    if (!projectId) return;

    const existing = inFlight.get(projectId);
    if (existing) return existing;

    // Mark loading / refreshing. If data is already present, keep it and
    // surface activity via `refreshing` (ambient bar picks this up).
    const current = get().projectConfig as AsyncFields<ProjectConfig>;
    set({
      projectConfig: {
        ...current,
        status: current.data ? current.status : 'loading',
        error: null,
        refreshing: current.data != null,
      } as AsyncFields<ProjectConfig>,
    });

    const task = (async () => {
      try {
        const cfg = await apiFetchProjectConfig(projectId);
        if (get().selectedProject !== projectId) return;
        set({
          projectConfig: {
            status: cfg ? 'ready' : 'empty',
            data: cfg,
            error: null,
            refreshing: false,
          },
        });
      } catch (error) {
        console.error('[projectConfigSlice] fetchProjectConfig failed:', error);
        if (get().selectedProject !== projectId) return;
        set({
          projectConfig: {
            status: 'error',
            data: null,
            error: error instanceof Error ? error : new Error(String(error)),
            refreshing: false,
          },
        });
      } finally {
        inFlight.delete(projectId);
      }
    })();

    inFlight.set(projectId, task);
    return task;
  },

  createProjectConfig: async (projectId, backendMode) => {
    if (!projectId) return;
    const created = await apiCreateProjectConfig(projectId, backendMode);
    if (get().selectedProject !== projectId) return;
    set({
      projectConfig: {
        status: 'ready',
        data: created,
        error: null,
        refreshing: false,
      },
    });
  },

  updateProjectConfig: async (projectId, config) => {
    if (!projectId) {
      return { success: false, error: 'No project selected' };
    }
    const current = get().projectConfig as AsyncFields<ProjectConfig>;
    set({
      projectConfig: { ...current, refreshing: true, error: null },
    });
    try {
      const saved = await apiUpdateProjectConfig(projectId, config);
      if (get().selectedProject !== projectId) {
        // Project changed mid-save — drop result to avoid stale data.
        return { success: true };
      }
      set({
        projectConfig: {
          status: 'ready',
          data: saved ?? config,
          error: null,
          refreshing: false,
        },
      });
      // Pull fresh git status/changes so disk flags reflect the new config.
      const { selectedFeature, fetchGitAll } = get() as any;
      if (typeof fetchGitAll === 'function') {
        fetchGitAll(projectId, selectedFeature || undefined);
      }
      return { success: true };
    } catch (error) {
      console.error('[projectConfigSlice] updateProjectConfig failed:', error);
      const err = error instanceof Error ? error : new Error(String(error));
      // Keep existing data visible; surface error via slice but don't blow
      // away the form the user is editing.
      if (get().selectedProject === projectId) {
        set({
          projectConfig: {
            ...(get().projectConfig as AsyncFields<ProjectConfig>),
            refreshing: false,
            error: err,
          },
        });
      }
      return { success: false, error: err.message };
    }
  },

  clearProjectConfig: () => {
    set({ projectConfig: initialAsyncFields<ProjectConfig>() });
  },
});
