import { StateCreator } from 'zustand';
import type { CustomAgentSummary } from '@ant/shared';
import type { ProjectConfig } from '@/infrastructure/http/api';

/**
 * universalSlice — FE state for the universal custom-agent runtime (Phase 1).
 *
 * `projectType` mirrors `config.json`'s `projectType` (SSOT on the BE;
 * absent = 'canonical'). It is written only by `syncProjectTypeFromConfig`,
 * which `projectConfigSlice` calls whenever a project config loads/saves, so
 * the sidebar/toolbar gates can never diverge from the persisted config.
 *
 * Selection state (`selectedCustomAgentId` / `selectedCustomJobId` /
 * `selectedThreadId`) is deliberately memory-only in Phase 1 — no
 * localStorage persistence.
 *
 * `selectThread` is the identity glue: the universal runtime reuses the
 * feature-shaped plumbing (`:feature` URL slot, chat stream keying, SSE
 * connection) with the threadId in the feature slot, so selecting a thread
 * also drives `setSelectedFeature(threadId)` + `applyJobIdentity('universal')`.
 */

export type ProjectType = 'canonical' | 'universal';

export interface UniversalState {
  projectType: ProjectType;
  customAgents: CustomAgentSummary[];
  selectedCustomAgentId: string | undefined;
  selectedCustomJobId: string | undefined;
  selectedThreadId: string | undefined;
}

export interface UniversalActions {
  setProjectType: (projectType: ProjectType) => void;
  /** Mirror `config.json` → store. Called by projectConfigSlice on every config load/save. */
  syncProjectTypeFromConfig: (config: ProjectConfig | null | undefined) => void;
  setCustomAgents: (agents: CustomAgentSummary[]) => void;
  /** Select a custom job. Clears the thread selection (threads are per-job). */
  selectCustomJob: (agentId: string, jobId: string) => void;
  /** Select (or clear) a conversation thread of the selected custom job. */
  selectThread: (threadId: string | undefined) => void;
  clearUniversalSelection: () => void;
}

export type UniversalSlice = UniversalState & UniversalActions;

export const createUniversalSlice: StateCreator<any, [], [], UniversalSlice> = (set, get) => ({
  projectType: 'canonical',
  customAgents: [],
  selectedCustomAgentId: undefined,
  selectedCustomJobId: undefined,
  selectedThreadId: undefined,

  setProjectType: (projectType) => {
    if (get().projectType === projectType) return;
    set({ projectType });
    if (projectType !== 'universal') {
      get().clearUniversalSelection();
    }
  },

  syncProjectTypeFromConfig: (config) => {
    get().setProjectType(config?.projectType === 'universal' ? 'universal' : 'canonical');
  },

  setCustomAgents: (agents) => set({ customAgents: agents }),

  selectCustomJob: (agentId, jobId) => {
    const state = get();
    if (state.selectedCustomAgentId === agentId && state.selectedCustomJobId === jobId) return;
    set({
      selectedCustomAgentId: agentId,
      selectedCustomJobId: jobId,
      selectedThreadId: undefined,
    });
  },

  selectThread: (threadId) => {
    set({ selectedThreadId: threadId });
    const state = get();
    if (!threadId) return;
    // Point the SSE job param + stop path at the universal runtime FIRST, so
    // the session load triggered by the feature switch below already keys off
    // jobType 'universal'.
    if (typeof state.applyJobIdentity === 'function' && (
      state.selectedJobType !== 'universal' || state.selectedAgent !== 'universal'
    )) {
      state.applyJobIdentity({ jobType: 'universal', agent: 'universal' });
    }
    // Thread rides the feature slot: chat stream, SSE connection, and the
    // `/execute` URL are all keyed by (project, feature=threadId).
    if (typeof state.setSelectedFeature === 'function' && state.selectedFeature !== threadId) {
      state.setSelectedFeature(threadId);
    }
  },

  clearUniversalSelection: () =>
    set({
      selectedCustomAgentId: undefined,
      selectedCustomJobId: undefined,
      selectedThreadId: undefined,
      customAgents: [],
    }),
});
