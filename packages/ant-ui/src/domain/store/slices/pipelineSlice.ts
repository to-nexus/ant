import { StateCreator } from 'zustand';
import type {
  ActivePipelineInfo,
  PipelineDef,
  PipelineEventData,
  PipelineListEntry,
  PipelinePendingApproval,
  PipelineRunSummary,
  RunRecord,
} from '@ant/shared';
import { PIPELINE_DEF_VERSION } from '@ant/shared';
import {
  activatePipeline,
  createPipeline,
  deactivatePipeline,
  deletePipeline,
  fetchActivatableProjects,
  fetchActivePipeline,
  fetchPipeline,
  fetchPipelineApprovals,
  fetchPipelineRun,
  fetchPipelineRuns,
  fetchPipelines,
  resolvePipelineApproval,
  runPipelineNow,
  updatePipeline,
} from '@/infrastructure/http/api/pipelines';

/**
 * pipelineSlice — FE state for the pipeline scheduler tab.
 *
 * Definitions are ACCOUNT-scoped (cross-project); the project binding is the
 * ACTIVATION record. The panel is therefore project-independent; only
 * `activePipelineByProject` (the chat surface's lock signal) is keyed by
 * project and loaded per selected project + folded by SSE.
 *
 * Dirty-buffer doctrine: `pipelineDraft` (the object every editor surface —
 * canvas, inspector, header — writes) vs `pipelineSavedDef` (server truth).
 * Dirty = deep-unequal. Discard = one assignment. The canvas, the inspector
 * and the header are three views over ONE draft, never three buffers.
 *
 * Everything transient (runs, approvals, run detail, activations) is a
 * projection the `pipeline` SSE event keeps fresh via `applyPipelineEvent`;
 * REST fetches are the bootstrap/refresh path only.
 */

export type PipelineRunPublic = Omit<RunRecord, 'defSnapshot'>;

export interface PipelineActivatableProject {
  id: string;
  name: string;
  activePipelineId: string | null;
}

export interface PipelineSliceState {
  pipelines: PipelineListEntry[];
  pipelinesInvalid: Array<{ id: string; error: string }>;
  pipelinesLoading: boolean;
  pipelinesError: string | null;
  selectedPipelineId: string | null;
  /** null = nothing being edited; '' pipelineDraftIsNew = unsaved new draft. */
  pipelineDraft: PipelineDef | null;
  pipelineSavedDef: PipelineDef | null;
  pipelineDraftIsNew: boolean;
  pipelineSaveError: string | null;
  pipelinePanelView: 'editor' | 'execution' | 'runs';
  /** Canvas selection — a step id, or the trigger pseudo-node. */
  selectedPipelineNodeId: string | null;
  pipelineRunsById: Record<string, PipelineRunSummary[]>;
  pipelineRunDetail: PipelineRunPublic | null;
  pipelineApprovals: PipelinePendingApproval[];
  /** Per-project active-pipeline lock signal (chat surface). null = none. */
  activePipelineByProject: Record<string, ActivePipelineInfo | null>;
  /** Universal projects the Execution view's picker offers. */
  pipelineActivatableProjects: PipelineActivatableProject[];
  /** Execution-view picker selection (defaults to the bound project). */
  pipelineExecutionProjectId: string | null;
  pipelineActivationError: string | null;
}

export interface PipelineSliceActions {
  loadPipelines: () => Promise<void>;
  selectPipeline: (pipelineId: string | null) => Promise<void>;
  newPipelineDraft: () => void;
  setPipelineDraft: (def: PipelineDef) => void;
  discardPipelineDraft: () => void;
  savePipelineDraft: () => Promise<boolean>;
  deletePipelineById: (pipelineId: string) => Promise<void>;
  runPipelineNowById: (pipelineId: string) => Promise<string | null>;
  activatePipelineTo: (pipelineId: string, projectId: string) => Promise<boolean>;
  deactivatePipelineById: (pipelineId: string) => Promise<boolean>;
  loadActivatableProjects: () => Promise<void>;
  loadActivePipeline: (projectId: string) => Promise<void>;
  setPipelineExecutionProject: (projectId: string | null) => void;
  loadPipelineRuns: (pipelineId: string) => Promise<void>;
  loadPipelineRunDetail: (runId: string, pipelineId: string) => Promise<void>;
  clearPipelineRunDetail: () => void;
  loadPipelineApprovals: () => Promise<void>;
  resolvePipelineApprovalById: (gateId: string, decision: 'approve' | 'reject') => Promise<void>;
  setPipelinePanelView: (view: 'editor' | 'execution' | 'runs') => void;
  selectPipelineNode: (nodeId: string | null) => void;
  applyPipelineEvent: (event: PipelineEventData) => void;
}

export type PipelineSlice = PipelineSliceState & PipelineSliceActions;

export const pipelineDraftIsDirty = (draft: PipelineDef | null, saved: PipelineDef | null): boolean => {
  if (!draft) return false;
  if (!saved) return true;
  return JSON.stringify(draft) !== JSON.stringify(saved);
};

export const createPipelineSlice: StateCreator<any, [], [], PipelineSlice> = (set, get) => ({
  pipelines: [],
  pipelinesInvalid: [],
  pipelinesLoading: false,
  pipelinesError: null,
  selectedPipelineId: null,
  pipelineDraft: null,
  pipelineSavedDef: null,
  pipelineDraftIsNew: false,
  pipelineSaveError: null,
  pipelinePanelView: 'editor',
  selectedPipelineNodeId: null,
  pipelineRunsById: {},
  pipelineRunDetail: null,
  pipelineApprovals: [],
  activePipelineByProject: {},
  pipelineActivatableProjects: [],
  pipelineExecutionProjectId: null,
  pipelineActivationError: null,

  loadPipelines: async () => {
    set({ pipelinesLoading: true });
    try {
      const { pipelines, invalid } = await fetchPipelines();
      set({ pipelines, pipelinesInvalid: invalid ?? [], pipelinesLoading: false, pipelinesError: null });
      void get().loadPipelineApprovals();
    } catch (e) {
      set({ pipelinesLoading: false, pipelinesError: e instanceof Error ? e.message : String(e) });
    }
  },

  selectPipeline: async (pipelineId: string | null) => {
    if (pipelineId === null) {
      set({ selectedPipelineId: null, pipelineDraft: null, pipelineSavedDef: null, pipelineDraftIsNew: false, pipelineSaveError: null, selectedPipelineNodeId: null, pipelineRunDetail: null, pipelineActivationError: null, pipelineExecutionProjectId: null });
      return;
    }
    set({ selectedPipelineId: pipelineId, pipelineDraftIsNew: false, pipelineSaveError: null, pipelinePanelView: 'editor', selectedPipelineNodeId: null, pipelineRunDetail: null, pipelineActivationError: null });
    try {
      const { def, activation } = await fetchPipeline(pipelineId);
      // Stale guard — the user may have clicked another pipeline meanwhile.
      if (get().selectedPipelineId !== pipelineId) return;
      set({
        pipelineDraft: def,
        pipelineSavedDef: def,
        pipelineExecutionProjectId: activation?.projectId ?? null,
        pipelines: get().pipelines.map((p: PipelineListEntry) => (p.id === pipelineId ? { ...p, activation } : p)),
      });
      void get().loadPipelineRuns(pipelineId);
    } catch (e) {
      if (get().selectedPipelineId !== pipelineId) return;
      set({ pipelinesError: e instanceof Error ? e.message : String(e) });
    }
  },

  newPipelineDraft: () => {
    const draft: PipelineDef = {
      version: PIPELINE_DEF_VERSION,
      name: 'New pipeline',
      on: { schedule: { cron: '0 9 * * *', tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } },
      steps: [],
    };
    set({
      selectedPipelineId: null,
      pipelineDraft: draft,
      pipelineSavedDef: null,
      pipelineDraftIsNew: true,
      pipelineSaveError: null,
      pipelinePanelView: 'editor',
      selectedPipelineNodeId: 'trigger',
      pipelineRunDetail: null,
      pipelineActivationError: null,
      pipelineExecutionProjectId: null,
    });
  },

  setPipelineDraft: (def: PipelineDef) => set({ pipelineDraft: def }),

  discardPipelineDraft: () => {
    const saved = get().pipelineSavedDef;
    if (saved) {
      set({ pipelineDraft: saved, pipelineSaveError: null });
    } else {
      set({ pipelineDraft: null, pipelineDraftIsNew: false, pipelineSaveError: null, selectedPipelineNodeId: null });
    }
  },

  savePipelineDraft: async () => {
    const { pipelineDraft, pipelineDraftIsNew, selectedPipelineId } = get();
    if (!pipelineDraft) return false;
    try {
      if (pipelineDraftIsNew) {
        const { id } = await createPipeline(pipelineDraft);
        set({ pipelineDraftIsNew: false, selectedPipelineId: id, pipelineSavedDef: pipelineDraft, pipelineSaveError: null });
      } else if (selectedPipelineId) {
        await updatePipeline(selectedPipelineId, pipelineDraft);
        set({ pipelineSavedDef: pipelineDraft, pipelineSaveError: null });
      } else {
        return false;
      }
      void get().loadPipelines();
      return true;
    } catch (e) {
      set({ pipelineSaveError: e instanceof Error ? e.message : String(e) });
      return false;
    }
  },

  deletePipelineById: async (pipelineId: string) => {
    try {
      await deletePipeline(pipelineId);
    } catch (e) {
      set({ pipelineSaveError: e instanceof Error ? e.message : String(e) });
      return;
    }
    if (get().selectedPipelineId === pipelineId) {
      await get().selectPipeline(null);
    }
    void get().loadPipelines();
  },

  runPipelineNowById: async (pipelineId: string) => {
    try {
      await runPipelineNow(pipelineId);
      return null;
    } catch (e: any) {
      return e?.message ?? 'run-now failed';
    }
  },

  activatePipelineTo: async (pipelineId: string, projectId: string) => {
    set({ pipelineActivationError: null });
    try {
      const { activation, nextFireAt } = await activatePipeline(pipelineId, projectId);
      set({
        pipelines: get().pipelines.map((p: PipelineListEntry) =>
          p.id === pipelineId ? { ...p, activation, nextFireAt } : p,
        ),
        pipelineExecutionProjectId: projectId,
      });
      void get().loadActivatableProjects();
      void get().loadActivePipeline(projectId);
      return true;
    } catch (e) {
      set({ pipelineActivationError: e instanceof Error ? e.message : String(e) });
      return false;
    }
  },

  deactivatePipelineById: async (pipelineId: string) => {
    set({ pipelineActivationError: null });
    const previous = get().pipelines.find((p: PipelineListEntry) => p.id === pipelineId)?.activation ?? null;
    try {
      await deactivatePipeline(pipelineId);
      set({
        pipelines: get().pipelines.map((p: PipelineListEntry) =>
          p.id === pipelineId ? { ...p, activation: null, nextFireAt: undefined } : p,
        ),
      });
      if (previous) {
        set({ activePipelineByProject: { ...get().activePipelineByProject, [previous.projectId]: null } });
      }
      void get().loadActivatableProjects();
      return true;
    } catch (e) {
      set({ pipelineActivationError: e instanceof Error ? e.message : String(e) });
      return false;
    }
  },

  loadActivatableProjects: async () => {
    try {
      const { projects } = await fetchActivatableProjects();
      set({ pipelineActivatableProjects: projects });
    } catch {
      /* picker keeps last-good */
    }
  },

  loadActivePipeline: async (projectId: string) => {
    try {
      const { active } = await fetchActivePipeline(projectId);
      set({ activePipelineByProject: { ...get().activePipelineByProject, [projectId]: active } });
    } catch {
      /* chat lock signal keeps last-good; SSE folds correct it */
    }
  },

  setPipelineExecutionProject: (projectId) => set({ pipelineExecutionProjectId: projectId }),

  loadPipelineRuns: async (pipelineId: string) => {
    try {
      const { runs } = await fetchPipelineRuns(pipelineId);
      set({ pipelineRunsById: { ...get().pipelineRunsById, [pipelineId]: runs } });
      const live = runs.find((r) => r.status === 'running' || r.status === 'awaiting_human');
      if (live) void get().loadPipelineRunDetail(live.runId, pipelineId);
    } catch {
      /* rail keeps last-good */
    }
  },

  loadPipelineRunDetail: async (runId: string, pipelineId: string) => {
    try {
      const { run } = await fetchPipelineRun(runId, pipelineId);
      set({ pipelineRunDetail: run });
    } catch {
      /* keep previous */
    }
  },

  clearPipelineRunDetail: () => set({ pipelineRunDetail: null }),

  loadPipelineApprovals: async () => {
    try {
      const { approvals } = await fetchPipelineApprovals();
      set({ pipelineApprovals: approvals });
    } catch {
      /* keep last-good */
    }
  },

  resolvePipelineApprovalById: async (gateId: string, decision: 'approve' | 'reject') => {
    await resolvePipelineApproval(gateId, decision);
    // Optimistic removal; the approvalResolved SSE event is the durable fold.
    set({ pipelineApprovals: get().pipelineApprovals.filter((a: PipelinePendingApproval) => a.gateId !== gateId) });
  },

  setPipelinePanelView: (view) => set({ pipelinePanelView: view }),

  selectPipelineNode: (nodeId) => set({ selectedPipelineNodeId: nodeId }),

  applyPipelineEvent: (event: PipelineEventData) => {
    const state = get();
    switch (event.cause) {
      case 'runUpdate': {
        const { run } = event;
        const terminal = run.status !== 'running' && run.status !== 'awaiting_human';
        // Rail projection.
        set({
          pipelines: state.pipelines.map((p: PipelineListEntry) =>
            p.id === event.pipelineId
              ? {
                  ...p,
                  lastRun: { runId: run.runId, status: run.status, firedAt: run.startedAt },
                  pendingApprovalCount: run.steps.filter((s) => s.status === 'awaiting_gate').length,
                }
              : p,
          ),
        });
        // Chat lock signal: the bound project's state follows the live run.
        const activeInfo = state.activePipelineByProject[event.projectId];
        if (activeInfo?.pipelineId === event.pipelineId || (!activeInfo && !terminal)) {
          const entry = state.pipelines.find((p: PipelineListEntry) => p.id === event.pipelineId);
          set({
            activePipelineByProject: {
              ...get().activePipelineByProject,
              [event.projectId]: {
                pipelineId: event.pipelineId,
                pipelineName: entry?.name ?? activeInfo?.pipelineName ?? event.pipelineId,
                state: terminal ? 'waiting' : run.status === 'awaiting_human' ? 'awaiting_human' : 'running',
                nextFireAt: entry?.nextFireAt ?? activeInfo?.nextFireAt,
                ...(terminal ? {} : { currentRunId: run.runId }),
              },
            },
          });
        }
        // Runs list projection.
        const runs = state.pipelineRunsById[event.pipelineId];
        if (runs) {
          const summary: PipelineRunSummary = {
            runId: run.runId,
            pipelineId: event.pipelineId,
            projectId: run.projectId,
            status: run.status,
            firedBy: run.firedBy,
            fireEpoch: run.fireEpoch,
            startedAt: run.startedAt,
            endedAt: run.endedAt,
          };
          const next = runs.some((r: PipelineRunSummary) => r.runId === run.runId)
            ? runs.map((r: PipelineRunSummary) => (r.runId === run.runId ? summary : r))
            : [summary, ...runs];
          set({ pipelineRunsById: { ...get().pipelineRunsById, [event.pipelineId]: next } });
        }
        // Open run detail (canvas overlay + timeline) follows live.
        if (state.pipelineRunDetail?.runId === run.runId || state.selectedPipelineId === event.pipelineId) {
          if (!state.pipelineRunDetail || state.pipelineRunDetail.runId === run.runId || state.pipelineRunDetail.status === 'completed') {
            set({ pipelineRunDetail: run });
          }
        }
        // A terminal run can not hold gates.
        if (terminal) {
          set({ pipelineApprovals: get().pipelineApprovals.filter((a: PipelinePendingApproval) => a.runId !== run.runId) });
        }
        break;
      }
      case 'approvalRequested': {
        const exists = state.pipelineApprovals.some((a: PipelinePendingApproval) => a.gateId === event.approval.gateId);
        if (!exists) set({ pipelineApprovals: [event.approval, ...state.pipelineApprovals] });
        break;
      }
      case 'approvalResolved': {
        set({ pipelineApprovals: state.pipelineApprovals.filter((a: PipelinePendingApproval) => a.gateId !== event.gateId) });
        break;
      }
      case 'activationChanged': {
        const entry = state.pipelines.find((p: PipelineListEntry) => p.id === event.pipelineId);
        set({
          pipelines: state.pipelines.map((p: PipelineListEntry) =>
            p.id === event.pipelineId ? { ...p, activation: event.activation, nextFireAt: event.nextFireAt } : p,
          ),
          activePipelineByProject: {
            ...state.activePipelineByProject,
            [event.projectId]: event.activation
              ? {
                  pipelineId: event.pipelineId,
                  pipelineName: entry?.name ?? event.pipelineId,
                  state: 'waiting',
                  nextFireAt: event.nextFireAt,
                }
              : null,
          },
        });
        if (state.selectedPipelineId === event.pipelineId) {
          set({ pipelineExecutionProjectId: event.activation?.projectId ?? get().pipelineExecutionProjectId });
        }
        break;
      }
      case 'defChanged': {
        void get().loadPipelines();
        break;
      }
    }
  },
});
