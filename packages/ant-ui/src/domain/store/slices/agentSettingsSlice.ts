import { StateCreator } from 'zustand';
import type { CustomAgentSummary, CustomAgentDefinitionFileNode, DefinitionValidationResult } from '@ant/shared';
import {
  fetchAccountAgents,
  fetchDefinitionTree,
  fetchDefinitionFile,
  saveDefinitionFile,
} from '@/infrastructure/http/api/accountAgents';

/**
 * agentSettingsSlice — state for the account-scoped Agent Settings screen
 * (profile menu → main panel tab). Fully independent from `universalSlice`
 * (which owns the composer's agent/job chips): after a mutation here, the
 * screen re-syncs the composer via `loadCustomAgents(selectedProject)` when a
 * universal project is selected.
 */

export interface AgentSettingsSelection {
  agentId: string | undefined;
  /** undefined = the agent itself; a job id = that job's detail. */
  jobId: string | undefined;
}

export interface AgentSettingsState {
  accountAgents: CustomAgentSummary[];
  builtinToolPreset: string[];
  agentSettingsSelection: AgentSettingsSelection;
  definitionTree: CustomAgentDefinitionFileNode[];
  definitionReadonly: boolean;
  /** Open definition file buffer (raw editor / form target). */
  openDefinitionFile: { path: string; content: string; savedContent: string } | null;
  /** Last save's semantic validation result (warnings surface in the UI). */
  definitionValidation: DefinitionValidationResult | null;
}

export interface AgentSettingsActions {
  loadAccountAgents: () => Promise<void>;
  selectAgentSettingsNode: (agentId: string | undefined, jobId?: string) => void;
  loadDefinitionTree: (agentId: string) => Promise<void>;
  openDefinitionFileBuffer: (agentId: string, path: string) => Promise<void>;
  setDefinitionFileContent: (content: string) => void;
  /** Save via the single write funnel; returns false when the 400 gate refused. */
  saveOpenDefinitionFile: () => Promise<boolean>;
  closeDefinitionFileBuffer: () => void;
  /** Re-sync the composer chips after a settings mutation (universal project selected). */
  syncComposerAgents: () => void;
}

export type AgentSettingsSlice = AgentSettingsState & AgentSettingsActions;

export const createAgentSettingsSlice: StateCreator<any, [], [], AgentSettingsSlice> = (set, get) => ({
  accountAgents: [],
  builtinToolPreset: [],
  agentSettingsSelection: { agentId: undefined, jobId: undefined },
  definitionTree: [],
  definitionReadonly: false,
  openDefinitionFile: null,
  definitionValidation: null,

  loadAccountAgents: async () => {
    try {
      const { agents, builtinToolPreset } = await fetchAccountAgents();
      set({ accountAgents: agents, builtinToolPreset });
      const { agentSettingsSelection } = get();
      if (agentSettingsSelection.agentId && !agents.some((a: CustomAgentSummary) => a.id === agentSettingsSelection.agentId)) {
        set({
          agentSettingsSelection: { agentId: undefined, jobId: undefined },
          definitionTree: [],
          openDefinitionFile: null,
          definitionValidation: null,
        });
      }
    } catch (e) {
      console.warn('[agentSettingsSlice] Failed to load account agents:', e);
    }
  },

  selectAgentSettingsNode: (agentId, jobId) => {
    const prev = get().agentSettingsSelection;
    if (prev.agentId === agentId && prev.jobId === jobId) return;
    set({
      agentSettingsSelection: { agentId, jobId },
      openDefinitionFile: null,
      definitionValidation: null,
    });
    if (agentId && agentId !== prev.agentId) {
      void get().loadDefinitionTree(agentId);
    }
  },

  loadDefinitionTree: async (agentId) => {
    try {
      const { tree, readonly } = await fetchDefinitionTree(agentId);
      set({ definitionTree: tree, definitionReadonly: readonly });
    } catch (e) {
      console.warn('[agentSettingsSlice] Failed to load definition tree:', e);
      set({ definitionTree: [], definitionReadonly: false });
    }
  },

  openDefinitionFileBuffer: async (agentId, path) => {
    try {
      const { content } = await fetchDefinitionFile(agentId, path);
      set({ openDefinitionFile: { path, content, savedContent: content }, definitionValidation: null });
    } catch (e) {
      console.warn('[agentSettingsSlice] Failed to open definition file:', e);
    }
  },

  setDefinitionFileContent: (content) => {
    const open = get().openDefinitionFile;
    if (!open) return;
    set({ openDefinitionFile: { ...open, content } });
  },

  saveOpenDefinitionFile: async () => {
    const { openDefinitionFile, agentSettingsSelection } = get();
    if (!openDefinitionFile || !agentSettingsSelection.agentId) return false;
    try {
      const { validation } = await saveDefinitionFile(
        agentSettingsSelection.agentId,
        openDefinitionFile.path,
        openDefinitionFile.content,
      );
      set({
        openDefinitionFile: { ...openDefinitionFile, savedContent: openDefinitionFile.content },
        definitionValidation: validation,
      });
      get().syncComposerAgents();
      return true;
    } catch (e) {
      console.warn('[agentSettingsSlice] Save refused:', e);
      throw e;
    }
  },

  closeDefinitionFileBuffer: () => set({ openDefinitionFile: null, definitionValidation: null }),

  syncComposerAgents: () => {
    const state = get();
    if (state.projectType === 'universal' && state.selectedProject && typeof state.loadCustomAgents === 'function') {
      void state.loadCustomAgents(state.selectedProject);
    }
  },
});
