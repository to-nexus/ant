import { StateCreator } from 'zustand';
import type { CustomAgentSummary, CustomAgentDefinitionFileNode, DefinitionValidationResult } from '@ant/shared';
import {
  fetchAccountAgents,
  fetchDefinitionTree,
  fetchDefinitionFile,
  promoteAccountAgent,
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
  /** An intent id inside the selected job = that intent's detail. */
  intentId: string | undefined;
}

export interface DefinitionTreeEntry {
  tree: CustomAgentDefinitionFileNode[];
  readonly: boolean;
}

export interface AgentSettingsState {
  accountAgents: CustomAgentSummary[];
  /**
   * Why the last `loadAccountAgents` failed, or null when it succeeded.
   *
   * An empty `accountAgents` is ambiguous on its own — "this account has no
   * agents" and "the request failed" render identically, which is how a 404 on
   * `/api/account/agents` read as a missing-agents bug. `kind` separates the
   * one cause the UI can explain precisely (the endpoint is absent, i.e. the
   * server predates it) from everything else.
   */
  accountAgentsError: { kind: 'endpoint-missing' | 'unknown'; message: string } | null;
  builtinToolPreset: string[];
  /** Tools whose approval defaults to 'always' (runtime SSOT, for form labels). */
  mutatingBuiltinTools: string[];
  agentSettingsSelection: AgentSettingsSelection;
  /** SELECTED agent's tree — mirror of `definitionTrees[selection.agentId]` kept for the detail pane's readers. */
  definitionTree: CustomAgentDefinitionFileNode[];
  definitionReadonly: boolean;
  /** Per-agent definition trees for the rail's file view; key = agentId. Absent = never loaded. */
  definitionTrees: Record<string, DefinitionTreeEntry>;
  /** Open prose (.md) buffer for the Prompts card editor — yaml is owned by its card. */
  openDefinitionFile: { path: string; content: string; savedContent: string } | null;
  /** Last save's semantic validation result (warnings surface in the UI). */
  definitionValidation: DefinitionValidationResult | null;
  /**
   * One-shot navigation request from OUTSIDE the screen (e.g. the universal
   * actions tab's "open in Agent Settings" links): the definition file to land
   * on. A PATH, not a card id — the screen already owns the one file→section
   * mapping (`handleOpenTreeFile`), so a second mapping here would drift.
   */
  agentSettingsOpenRequest: { agentId: string; path: string } | null;
}

export interface AgentSettingsActions {
  loadAccountAgents: () => Promise<void>;
  selectAgentSettingsNode: (agentId: string | undefined, jobId?: string, intentId?: string) => void;
  loadDefinitionTree: (agentId: string) => Promise<void>;
  /** Lazy per-agent tree load for the rail's file view — no-op when present or in flight. */
  ensureDefinitionTree: (agentId: string) => Promise<void>;
  openDefinitionFileBuffer: (agentId: string, path: string) => Promise<void>;
  setDefinitionFileContent: (content: string) => void;
  /** Save via the single write funnel; returns false when the 400 gate refused. */
  saveOpenDefinitionFile: () => Promise<boolean>;
  closeDefinitionFileBuffer: () => void;
  /** Re-sync the composer chips after a settings mutation (universal project selected). */
  syncComposerAgents: () => void;
  /** Ask the settings screen to land on one definition file (see the state field). */
  requestAgentSettingsFile: (agentId: string, path: string) => void;
  /** Consumed by the screen once the request has been honored. */
  clearAgentSettingsOpenRequest: () => void;
  /**
   * Promote a personal agent to the active team org (move + owner record),
   * then re-sync the list and the composer. Errors propagate to the caller
   * (the settings screen surfaces them through its own error strip).
   */
  promoteAgent: (agentId: string) => Promise<void>;
}

export type AgentSettingsSlice = AgentSettingsState & AgentSettingsActions;

export const createAgentSettingsSlice: StateCreator<any, [], [], AgentSettingsSlice> = (set, get) => {
  /** Dedupe concurrent lazy loads (per-agent, closure-scoped). */
  const treeLoadsInFlight = new Set<string>();

  return {
  accountAgents: [],
  accountAgentsError: null,
  builtinToolPreset: [],
  mutatingBuiltinTools: [],
  agentSettingsSelection: { agentId: undefined, jobId: undefined, intentId: undefined },
  definitionTree: [],
  definitionReadonly: false,
  definitionTrees: {},
  openDefinitionFile: null,
  definitionValidation: null,
  agentSettingsOpenRequest: null,

  loadAccountAgents: async () => {
    try {
      const { agents, builtinToolPreset, mutatingBuiltinTools } = await fetchAccountAgents();
      set({
        accountAgents: agents,
        accountAgentsError: null,
        builtinToolPreset,
        mutatingBuiltinTools: mutatingBuiltinTools ?? [],
      });
      // Prune the selection level-by-level when its target vanished.
      const sel = get().agentSettingsSelection as AgentSettingsSelection;
      const agent = agents.find((a: CustomAgentSummary) => a.id === sel.agentId);
      if (sel.agentId && !agent) {
        const trees = { ...(get().definitionTrees as Record<string, DefinitionTreeEntry>) };
        delete trees[sel.agentId];
        set({
          agentSettingsSelection: { agentId: undefined, jobId: undefined, intentId: undefined },
          definitionTree: [],
          definitionTrees: trees,
          openDefinitionFile: null,
          definitionValidation: null,
        });
        return;
      }
      const job = agent?.jobs.find((j) => j.id === sel.jobId);
      if (sel.jobId && !job) {
        set({ agentSettingsSelection: { agentId: sel.agentId, jobId: undefined, intentId: undefined } });
        return;
      }
      if (sel.intentId && !(job?.intents ?? []).some((i) => i.id === sel.intentId)) {
        set({ agentSettingsSelection: { agentId: sel.agentId, jobId: sel.jobId, intentId: undefined } });
      }
    } catch (e: any) {
      console.warn('[agentSettingsSlice] Failed to load account agents:', e);
      // A 404 here is not "no agents" — the route is unconditional in the BE, so
      // its absence means the server is older than the endpoint.
      const kind = e?.status === 404 ? 'endpoint-missing' : 'unknown';
      set({
        accountAgents: [],
        accountAgentsError: { kind, message: e?.message ? String(e.message) : String(e) },
      });
    }
  },

  selectAgentSettingsNode: (agentId, jobId, intentId) => {
    const prev = get().agentSettingsSelection;
    if (prev.agentId === agentId && prev.jobId === jobId && prev.intentId === intentId) return;
    set({
      agentSettingsSelection: { agentId, jobId, intentId },
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
      // Write the per-agent map AND — for the selected agent — the single
      // mirror slot the detail pane's readers consume.
      const trees = { ...(get().definitionTrees as Record<string, DefinitionTreeEntry>), [agentId]: { tree, readonly } };
      const mirror = get().agentSettingsSelection.agentId === agentId
        ? { definitionTree: tree, definitionReadonly: readonly }
        : {};
      set({ definitionTrees: trees, ...mirror });
    } catch (e) {
      console.warn('[agentSettingsSlice] Failed to load definition tree:', e);
      const trees = { ...(get().definitionTrees as Record<string, DefinitionTreeEntry>), [agentId]: { tree: [], readonly: false } };
      const mirror = get().agentSettingsSelection.agentId === agentId
        ? { definitionTree: [], definitionReadonly: false }
        : {};
      set({ definitionTrees: trees, ...mirror });
    }
  },

  ensureDefinitionTree: async (agentId) => {
    if ((get().definitionTrees as Record<string, DefinitionTreeEntry>)[agentId] || treeLoadsInFlight.has(agentId)) return;
    treeLoadsInFlight.add(agentId);
    try {
      await get().loadDefinitionTree(agentId);
    } finally {
      treeLoadsInFlight.delete(agentId);
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

  requestAgentSettingsFile: (agentId, path) => set({ agentSettingsOpenRequest: { agentId, path } }),

  clearAgentSettingsOpenRequest: () => set({ agentSettingsOpenRequest: null }),

  syncComposerAgents: () => {
    const state = get();
    if (state.projectType === 'universal' && state.selectedProject && typeof state.loadCustomAgents === 'function') {
      void state.loadCustomAgents(state.selectedProject);
    }
  },

  promoteAgent: async (agentId) => {
    await promoteAccountAgent(agentId);
    await get().loadAccountAgents();
    // The move is only real when the refetched summary says so — a promotion
    // that "succeeded" while the agent is still user-scope must surface, not
    // silently pretend (the promote POST and the list read different stores).
    const refetched = (get().accountAgents as CustomAgentSummary[]).find((a) => a.id === agentId);
    if (refetched && refetched.scope !== 'org') {
      throw new Error(`Promotion did not take effect: agent "${agentId}" is still ${refetched.scope}-scope after refresh`);
    }
    get().syncComposerAgents();
    // Re-read the tree if the promoted agent is the one on screen — its
    // scope root (and thus readonly) changed under the same id.
    if (get().agentSettingsSelection.agentId === agentId) {
      await get().loadDefinitionTree(agentId);
    }
  },
  };
};
