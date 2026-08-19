import { StateCreator } from 'zustand';
import type {
  PipelineDef,
  PipelineEventData,
  PipelineListEntry,
  PipelinePendingApproval,
  PipelineRunSummary,
  RunRecord,
} from '@ant/shared';
import {
  createPipeline,
  deletePipeline,
  fetchPipeline,
  fetchPipelineApprovals,
  fetchPipelineRun,
  fetchPipelineRuns,
  fetchPipelines,
  resolvePipelineApproval,
  runPipelineNow,
  setPipelineEnabled,
  updatePipeline,
} from '@/infrastructure/http/api/pipelines';

/**
 * pipelineSlice — FE state for the pipeline scheduler tab.
 *
 * Dirty-buffer doctrine: `pipelineDraft` (the object every editor surface —
 * canvas, inspector, header — writes) vs `pipelineSavedDef` (server truth).
 * Dirty = deep-unequal. Discard = one assignment. The canvas, the inspector
 * and the header are three views over ONE draft, never three buffers.
 *
 * Everything transient (runs, approvals, run detail) is a projection the
 * `pipeline` SSE event keeps fresh via `applyPipelineEvent`; REST fetches are
 * the bootstrap/refresh path only.
 */

export type PipelineRunPublic = Omit<RunRecord, 'defSnapshot'>;

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
  pipelineEditorView: 'editor' | 'runs';
  /** Canvas selection — a step id, or the trigger pseudo-node. */
  selectedPipelineNodeId: string | null;
  pipelineRunsById: Record<string, PipelineRunSummary[]>;
  pipelineRunDetail: PipelineRunPublic | null;
  pipelineApprovals: PipelinePendingApproval[];
}

export interface PipelineSliceActions {
  loadPipelines: (projectId?: string) => Promise<void>;
  selectPipeline: (pipelineId: string | null) => Promise<void>;
  newPipelineDraft: () => void;
  setPipelineDraft: (def: PipelineDef) => void;
  discardPipelineDraft: () => void;
  savePipelineDraft: () => Promise<boolean>;
  togglePipelineEnabled: (pipelineId: string, enabled: boolean) => Promise<void>;
  deletePipelineById: (pipelineId: string) => Promise<void>;
  runPipelineNowById: (pipelineId: string) => Promise<string | null>;
  loadPipelineRuns: (pipelineId: string) => Promise<void>;
  loadPipelineRunDetail: (runId: string, pipelineId: string) => Promise<void>;
  clearPipelineRunDetail: () => void;
  loadPipelineApprovals: () => Promise<void>;
  resolvePipelineApprovalById: (gateId: string, decision: 'approve' | 'reject') => Promise<void>;
  setPipelineEditorView: (view: 'editor' | 'runs') => void;
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
  pipelineEditorView: 'editor',
  selectedPipelineNodeId: null,
  pipelineRunsById: {},
  pipelineRunDetail: null,
  pipelineApprovals: [],

  loadPipelines: async (projectId?: string) => {
    const project = projectId ?? get().selectedProject;
    if (!project) return;
    set({ pipelinesLoading: true });
    try {
      const { pipelines, invalid } = await fetchPipelines(project);
      set({ pipelines, pipelinesInvalid: invalid ?? [], pipelinesLoading: false, pipelinesError: null });
      void get().loadPipelineApprovals();
    } catch (e) {
      set({ pipelinesLoading: false, pipelinesError: e instanceof Error ? e.message : String(e) });
    }
  },

  selectPipeline: async (pipelineId: string | null) => {
    if (pipelineId === null) {
      set({ selectedPipelineId: null, pipelineDraft: null, pipelineSavedDef: null, pipelineDraftIsNew: false, pipelineSaveError: null, selectedPipelineNodeId: null, pipelineRunDetail: null });
      return;
    }
    const project = get().selectedProject;
    if (!project) return;
    set({ selectedPipelineId: pipelineId, pipelineDraftIsNew: false, pipelineSaveError: null, pipelineEditorView: 'editor', selectedPipelineNodeId: null, pipelineRunDetail: null });
    try {
      const { def } = await fetchPipeline(project, pipelineId);
      // Stale guard — the user may have clicked another pipeline meanwhile.
      if (get().selectedPipelineId !== pipelineId) return;
      set({ pipelineDraft: def, pipelineSavedDef: def });
      void get().loadPipelineRuns(pipelineId);
    } catch (e) {
      if (get().selectedPipelineId !== pipelineId) return;
      set({ pipelinesError: e instanceof Error ? e.message : String(e) });
    }
  },

  newPipelineDraft: () => {
    const project = get().selectedProject;
    if (!project) return;
    const draft: PipelineDef = {
      version: 1,
      name: 'New pipeline',
      enabled: false,
      projectId: project,
      on: { schedule: { cron: '0 9 * * *', tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } },
      steps: [],
    };
    set({
      selectedPipelineId: null,
      pipelineDraft: draft,
      pipelineSavedDef: null,
      pipelineDraftIsNew: true,
      pipelineSaveError: null,
      pipelineEditorView: 'editor',
      selectedPipelineNodeId: 'trigger',
      pipelineRunDetail: null,
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
    const { pipelineDraft, pipelineDraftIsNew, selectedPipelineId, selectedProject } = get();
    if (!pipelineDraft || !selectedProject) return false;
    try {
      if (pipelineDraftIsNew) {
        const { id } = await createPipeline(selectedProject, pipelineDraft);
        set({ pipelineDraftIsNew: false, selectedPipelineId: id, pipelineSavedDef: pipelineDraft, pipelineSaveError: null });
      } else if (selectedPipelineId) {
        await updatePipeline(selectedProject, selectedPipelineId, pipelineDraft);
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

  togglePipelineEnabled: async (pipelineId: string, enabled: boolean) => {
    const project = get().selectedProject;
    if (!project) return;
    // Optimistic rail flip; the fetch below reconciles.
    set({ pipelines: get().pipelines.map((p: PipelineListEntry) => (p.id === pipelineId ? { ...p, enabled } : p)) });
    try {
      const { entry } = await setPipelineEnabled(project, pipelineId, enabled);
      set({ pipelines: get().pipelines.map((p: PipelineListEntry) => (p.id === pipelineId ? entry : p)) });
      if (get().selectedPipelineId === pipelineId) {
        const saved = get().pipelineSavedDef;
        if (saved) {
          const next = { ...saved, enabled };
          const dirty = pipelineDraftIsDirty(get().pipelineDraft, saved);
          set({ pipelineSavedDef: next, ...(dirty ? {} : { pipelineDraft: next }) });
        }
      }
    } catch {
      void get().loadPipelines();
    }
  },

  deletePipelineById: async (pipelineId: string) => {
    const project = get().selectedProject;
    if (!project) return;
    await deletePipeline(project, pipelineId);
    if (get().selectedPipelineId === pipelineId) {
      await get().selectPipeline(null);
    }
    void get().loadPipelines();
  },

  runPipelineNowById: async (pipelineId: string) => {
    const project = get().selectedProject;
    if (!project) return null;
    try {
      await runPipelineNow(project, pipelineId);
      return null;
    } catch (e: any) {
      return e?.message ?? 'run-now failed';
    }
  },

  loadPipelineRuns: async (pipelineId: string) => {
    const project = get().selectedProject;
    if (!project) return;
    try {
      const { runs } = await fetchPipelineRuns(project, pipelineId);
      set({ pipelineRunsById: { ...get().pipelineRunsById, [pipelineId]: runs } });
      const live = runs.find((r) => r.status === 'running' || r.status === 'awaiting_human');
      if (live) void get().loadPipelineRunDetail(live.runId, pipelineId);
    } catch {
      /* rail keeps last-good */
    }
  },

  loadPipelineRunDetail: async (runId: string, pipelineId: string) => {
    const project = get().selectedProject;
    if (!project) return;
    try {
      const { run } = await fetchPipelineRun(project, runId, pipelineId);
      set({ pipelineRunDetail: run });
    } catch {
      /* keep previous */
    }
  },

  clearPipelineRunDetail: () => set({ pipelineRunDetail: null }),

  loadPipelineApprovals: async () => {
    const project = get().selectedProject;
    if (!project) return;
    try {
      const { approvals } = await fetchPipelineApprovals(project);
      set({ pipelineApprovals: approvals });
    } catch {
      /* keep last-good */
    }
  },

  resolvePipelineApprovalById: async (gateId: string, decision: 'approve' | 'reject') => {
    const project = get().selectedProject;
    if (!project) return;
    await resolvePipelineApproval(project, gateId, decision);
    // Optimistic removal; the approvalResolved SSE event is the durable fold.
    set({ pipelineApprovals: get().pipelineApprovals.filter((a: PipelinePendingApproval) => a.gateId !== gateId) });
  },

  setPipelineEditorView: (view) => set({ pipelineEditorView: view }),

  selectPipelineNode: (nodeId) => set({ selectedPipelineNodeId: nodeId }),

  applyPipelineEvent: (event: PipelineEventData) => {
    const state = get();
    switch (event.cause) {
      case 'runUpdate': {
        const { run } = event;
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
        // Runs list projection.
        const runs = state.pipelineRunsById[event.pipelineId];
        if (runs) {
          const summary: PipelineRunSummary = {
            runId: run.runId,
            pipelineId: event.pipelineId,
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
        if (run.status !== 'running' && run.status !== 'awaiting_human') {
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
      case 'defChanged': {
        if (state.selectedProject === event.projectId) void get().loadPipelines();
        break;
      }
    }
  },
});
