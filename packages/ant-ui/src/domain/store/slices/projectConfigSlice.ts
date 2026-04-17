import { StateCreator } from 'zustand';
import {
  fetchProjectConfig as apiFetchProjectConfig,
  createProjectConfig as apiCreateProjectConfig,
  ProjectConfig,
} from '@/infrastructure/http/api';

/**
 * projectConfigSlice — holds the currently-selected project's `ProjectConfig`
 * (the `.ant/config.json` contents).
 *
 * Previously this lived as a local useState inside `ProjectSection`, which
 * meant other components (notably `ActionButton` / `GitStatusButton`) couldn't
 * read `githubRepo` and had to fall back on `gitStatus.remoteUrl` — a
 * different and sometimes contradicting source of truth. Consolidating here
 * removes that ambiguity.
 *
 * Kept separate from the system-wide `configSlice` (mode/port/recursionLimit)
 * because scope differs: this slice is per-project and changes on project
 * switch, whereas configSlice is global.
 */

export interface ProjectConfigState {
  projectConfig: ProjectConfig | null;
  /**
   * null  — not yet checked / loading
   * true  — config.json exists
   * false — confirmed missing (404)
   *
   * Tri-state is intentional — the previous `configExists === false` guard
   * depended on the distinction between "loading" and "absent" to avoid a
   * spurious orange warning banner flash.
   */
  projectConfigExists: boolean | null;
}

export interface ProjectConfigActions {
  fetchProjectConfig: (projectId: string) => Promise<void>;
  createProjectConfig: (
    projectId: string,
    backendMode: 'local' | 'cloud'
  ) => Promise<void>;
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
> = (set, _get) => ({
  projectConfig: null,
  projectConfigExists: null,

  fetchProjectConfig: async (projectId) => {
    if (!projectId) return;

    const existing = inFlight.get(projectId);
    if (existing) return existing;

    const task = (async () => {
      try {
        const cfg = await apiFetchProjectConfig(projectId);
        // Guard against stale resolution when project changes mid-flight.
        if (_get().selectedProject !== projectId) return;
        set({
          projectConfig: cfg,
          projectConfigExists: cfg !== null,
        });
      } catch (error) {
        console.error('[projectConfigSlice] fetchProjectConfig failed:', error);
        if (_get().selectedProject !== projectId) return;
        set({ projectConfig: null, projectConfigExists: false });
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
    if (_get().selectedProject !== projectId) return;
    set({ projectConfig: created, projectConfigExists: true });
  },

  clearProjectConfig: () => {
    set({ projectConfig: null, projectConfigExists: null });
  },
});
