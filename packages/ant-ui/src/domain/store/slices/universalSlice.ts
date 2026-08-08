import { StateCreator } from 'zustand';
import { UNIVERSAL_FEATURE, type CustomAgentSummary } from '@ant/shared';
import type { ProjectConfig } from '@/infrastructure/http/api';
import { fetchCustomAgents } from '@/infrastructure/http/api/customAgents';

/**
 * universalSlice — FE state for the universal custom-agent runtime.
 *
 * `projectType` mirrors `config.json`'s `projectType` (SSOT on the BE;
 * absent = 'canonical'). It is written only by `syncProjectTypeFromConfig`,
 * which `projectConfigSlice` calls whenever a project config loads/saves, so
 * the sidebar/toolbar gates can never diverge from the persisted config.
 *
 * A workspace project has exactly ONE chat, riding the constant
 * `UNIVERSAL_FEATURE` feature slot. The composer's agent/job chips switch
 * the custom (agent, job) pair — each pair has its own LLM session on the
 * BE, mirroring canonical jobType switching within a feature chat.
 *
 * Selection state (`selectedCustomAgentId` / `selectedCustomJobId`) is
 * deliberately memory-only — `loadCustomAgents` restores a valid selection
 * on every project entry.
 */

export type ProjectType = 'canonical' | 'universal';

export interface UniversalState {
  projectType: ProjectType;
  customAgents: CustomAgentSummary[];
  selectedCustomAgentId: string | undefined;
  selectedCustomJobId: string | undefined;
  /**
   * Explicit `@intent:` / `@ctx:` mentions accumulated for the NEXT send —
   * applies to that run only. Reset on job switch and after send.
   */
  universalTurnMeta: { intents: string[]; context: string[] };
}

export interface UniversalActions {
  setProjectType: (projectType: ProjectType) => void;
  /** Mirror `config.json` → store. Called by projectConfigSlice on every config load/save. */
  syncProjectTypeFromConfig: (config: ProjectConfig | null | undefined) => void;
  setCustomAgents: (agents: CustomAgentSummary[]) => void;
  /** Select a custom job (agent + job pair). */
  selectCustomJob: (agentId: string, jobId: string) => void;
  /** Fetch the agent list and repair/auto-select the (agent, job) pair. */
  loadCustomAgents: (projectId: string) => Promise<void>;
  clearUniversalSelection: () => void;
  /** Accumulate an `@intent:` mention (multiple allowed, deduped). */
  addUniversalIntentMention: (intentId: string) => void;
  removeUniversalIntentMention: (intentId: string) => void;
  /** Accumulate an `@ctx:` artifact-path mention (deduped). */
  addUniversalContextMention: (path: string) => void;
  removeUniversalContextMention: (path: string) => void;
  resetUniversalTurnMeta: () => void;
}

export type UniversalSlice = UniversalState & UniversalActions;

export const createUniversalSlice: StateCreator<any, [], [], UniversalSlice> = (set, get) => ({
  projectType: 'canonical',
  customAgents: [],
  selectedCustomAgentId: undefined,
  selectedCustomJobId: undefined,
  universalTurnMeta: { intents: [], context: [] },

  setProjectType: (projectType) => {
    const changed = get().projectType !== projectType;
    if (changed) set({ projectType });
    if (!changed && projectType === 'canonical') return;
    const state = get();
    if (projectType === 'universal') {
      // Runs on every universal config load (not only on type flips) so that
      // switching between two universal projects reloads the agent list.
      // Universal identity: SSE job param + stop path key off jobType
      // 'universal'; the chat/session container rides the constant feature.
      if (typeof state.applyJobIdentity === 'function' && (
        state.selectedJobType !== 'universal' || state.selectedAgent !== 'universal'
      )) {
        state.applyJobIdentity({ jobType: 'universal', agent: 'universal' });
      }
      if (typeof state.setSelectedFeature === 'function' && state.selectedFeature !== UNIVERSAL_FEATURE) {
        state.setSelectedFeature(UNIVERSAL_FEATURE);
      }
      if (state.selectedProject) {
        void get().loadCustomAgents(state.selectedProject);
      }
    } else {
      state.clearUniversalSelection();
      // Purge a persisted 'universal' identity leaking into a canonical project.
      if (state.selectedJobType === 'universal' && typeof state.applyJobIdentity === 'function') {
        state.applyJobIdentity({ jobType: 'plan', agent: 'planner' });
      }
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
      // Mentions are job-scoped vocabulary — a job switch invalidates them.
      universalTurnMeta: { intents: [], context: [] },
    });
  },

  loadCustomAgents: async (projectId) => {
    try {
      const { agents } = await fetchCustomAgents(projectId);
      set({ customAgents: agents });
      const { selectedCustomAgentId, selectedCustomJobId } = get();
      const current = agents.find((a) => a.id === selectedCustomAgentId);
      const currentJobValid = current?.jobs.some((j) => j.id === selectedCustomJobId) ?? false;
      if (!currentJobValid) {
        const firstAgent = agents.find((a) => a.jobs.length > 0);
        set({
          selectedCustomAgentId: firstAgent?.id,
          selectedCustomJobId: firstAgent?.jobs[0]?.id,
        });
      }
    } catch (e) {
      console.warn('[universalSlice] Failed to load custom agents:', e);
    }
  },

  clearUniversalSelection: () =>
    set({
      selectedCustomAgentId: undefined,
      selectedCustomJobId: undefined,
      customAgents: [],
      universalTurnMeta: { intents: [], context: [] },
    }),

  addUniversalIntentMention: (intentId) => {
    const meta = get().universalTurnMeta;
    if (meta.intents.includes(intentId)) return;
    set({ universalTurnMeta: { ...meta, intents: [...meta.intents, intentId] } });
  },

  removeUniversalIntentMention: (intentId) => {
    const meta = get().universalTurnMeta;
    if (!meta.intents.includes(intentId)) return;
    set({ universalTurnMeta: { ...meta, intents: meta.intents.filter((i: string) => i !== intentId) } });
  },

  addUniversalContextMention: (path) => {
    const meta = get().universalTurnMeta;
    if (meta.context.includes(path)) return;
    set({ universalTurnMeta: { ...meta, context: [...meta.context, path] } });
  },

  removeUniversalContextMention: (path) => {
    const meta = get().universalTurnMeta;
    if (!meta.context.includes(path)) return;
    set({ universalTurnMeta: { ...meta, context: meta.context.filter((p: string) => p !== path) } });
  },

  resetUniversalTurnMeta: () => {
    const meta = get().universalTurnMeta;
    if (meta.intents.length === 0 && meta.context.length === 0) return;
    set({ universalTurnMeta: { intents: [], context: [] } });
  },
});
