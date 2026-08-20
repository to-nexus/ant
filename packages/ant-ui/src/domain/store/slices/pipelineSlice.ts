import { StateCreator } from 'zustand';
import type {
  ActivePipelineInfo,
  PipelineActivationView,
  PipelineDef,
  PipelineEventData,
  PipelineListEntry,
  PipelinePendingApproval,
  PipelineRunSummary,
  PipelineScope,
  RunRecord,
} from '@ant/shared';
import { PIPELINE_DEF_VERSION } from '@ant/shared';
import {
  activatePipeline,
  createPipeline,
  deactivatePipeline,
  deletePipeline,
  disablePipeline,
  enablePipeline,
  fetchActivatableProjects,
  fetchActivePipeline,
  fetchPipeline,
  fetchPipelineApprovals,
  fetchPipelineRun,
  fetchPipelineRuns,
  fetchPipelines,
  promotePipeline,
  resolvePipelineApproval,
  runPipelineNow,
  updatePipeline,
  updatePipelineEditors,
} from '@/infrastructure/http/api/pipelines';

/**
 * pipelineSlice — FE state for the pipeline scheduler tab.
 *
 * Definitions are scoped TEMPLATES (user/org, agents precedent) with an
 * availability state machine: editable only while disabled, activatable only
 * while enabled. Activations are the scheduling unit — one per project, many
 * per pipeline (`entry.activations` includes org members' rows read-only).
 * Only `activePipelineByProject` (the chat surface's lock signal) is keyed by
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

/** One activation's run-history key: `${pipelineId}:${userId||'me'}:${projectId}`. */
export const activationRunsKey = (pipelineId: string, projectId: string, userId?: string): string =>
  `${pipelineId}:${userId ?? 'me'}:${projectId}`;

export interface PipelineSliceState {
  pipelines: PipelineListEntry[];
  pipelinesInvalid: Array<{ id: string; error: string; scope: PipelineScope }>;
  /** Own activations whose pinned definition no longer resolves (deactivate-only rows). */
  pipelineOrphanActivations: PipelineActivationView[];
  pipelinesLoading: boolean;
  pipelinesError: string | null;
  selectedPipelineId: string | null;
  /** null = nothing being edited; '' pipelineDraftIsNew = unsaved new draft. */
  pipelineDraft: PipelineDef | null;
  pipelineSavedDef: PipelineDef | null;
  pipelineDraftIsNew: boolean;
  pipelineSaveError: string | null;
  pipelinePanelView: 'editor' | 'execution';
  /**
   * Wiring view mode. 'view' = read-only canvas; 'edit' = mutable draft
   * (still gated by the BE availability machine — enabled/readonly lock it).
   * A NEW draft is forced-edit regardless of this flag.
   */
  pipelineWiringMode: 'view' | 'edit';
  /** Canvas selection — a step id, or the trigger pseudo-node. */
  selectedPipelineNodeId: string | null;
  /** Per-activation run history — see `activationRunsKey`. */
  pipelineRunsByActivation: Record<string, PipelineRunSummary[]>;
  pipelineRunDetail: PipelineRunPublic | null;
  pipelineApprovals: PipelinePendingApproval[];
  /** Per-project active-pipeline lock signal (chat surface). null = none. */
  activePipelineByProject: Record<string, ActivePipelineInfo | null>;
  /** Universal projects activatable by the caller (also the projectId→name map). */
  pipelineActivatableProjects: PipelineActivatableProject[];
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
  enablePipelineById: (pipelineId: string) => Promise<boolean>;
  disablePipelineById: (pipelineId: string) => Promise<boolean>;
  promotePipelineById: (pipelineId: string) => Promise<void>;
  savePipelineEditors: (pipelineId: string, editors: string[]) => Promise<void>;
  runPipelineNowById: (pipelineId: string, projectId: string) => Promise<string | null>;
  activatePipelineTo: (pipelineId: string, projectId: string) => Promise<boolean>;
  deactivatePipelineById: (pipelineId: string, projectId: string) => Promise<boolean>;
  loadActivatableProjects: () => Promise<void>;
  loadActivePipeline: (projectId: string) => Promise<void>;
  loadActivationRuns: (pipelineId: string, projectId: string, userId?: string) => Promise<void>;
  loadPipelineRunDetail: (runId: string, projectId: string) => Promise<void>;
  clearPipelineRunDetail: () => void;
  loadPipelineApprovals: () => Promise<void>;
  resolvePipelineApprovalById: (gateId: string, decision: 'approve' | 'reject') => Promise<void>;
  setPipelinePanelView: (view: 'editor' | 'execution') => void;
  setPipelineWiringMode: (mode: 'view' | 'edit') => void;
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
  pipelineOrphanActivations: [],
  pipelinesLoading: false,
  pipelinesError: null,
  selectedPipelineId: null,
  pipelineDraft: null,
  pipelineSavedDef: null,
  pipelineDraftIsNew: false,
  pipelineSaveError: null,
  pipelinePanelView: 'editor',
  pipelineWiringMode: 'view',
  selectedPipelineNodeId: null,
  pipelineRunsByActivation: {},
  pipelineRunDetail: null,
  pipelineApprovals: [],
  activePipelineByProject: {},
  pipelineActivatableProjects: [],
  pipelineActivationError: null,

  loadPipelines: async () => {
    set({ pipelinesLoading: true });
    try {
      const { pipelines, invalid, orphanActivations } = await fetchPipelines();
      set({
        pipelines,
        pipelinesInvalid: invalid ?? [],
        pipelineOrphanActivations: orphanActivations ?? [],
        pipelinesLoading: false,
        pipelinesError: null,
      });
      void get().loadPipelineApprovals();
    } catch (e) {
      set({ pipelinesLoading: false, pipelinesError: e instanceof Error ? e.message : String(e) });
    }
  },

  selectPipeline: async (pipelineId: string | null) => {
    if (pipelineId === null) {
      set({ selectedPipelineId: null, pipelineDraft: null, pipelineSavedDef: null, pipelineDraftIsNew: false, pipelineSaveError: null, pipelineWiringMode: 'view', selectedPipelineNodeId: null, pipelineRunDetail: null, pipelineActivationError: null });
      return;
    }
    // The current view survives selection — only a NEW draft forces the editor.
    set({ selectedPipelineId: pipelineId, pipelineDraftIsNew: false, pipelineSaveError: null, pipelineWiringMode: 'view', selectedPipelineNodeId: null, pipelineRunDetail: null, pipelineActivationError: null });
    try {
      const detail = await fetchPipeline(pipelineId);
      // Stale guard — the user may have clicked another pipeline meanwhile.
      if (get().selectedPipelineId !== pipelineId) return;
      set({
        pipelineDraft: detail.def,
        pipelineSavedDef: detail.def,
        pipelines: get().pipelines.map((p: PipelineListEntry) =>
          p.id === pipelineId
            ? { ...p, scope: detail.scope, readonly: detail.readonly, enabled: detail.enabled, org: detail.org, activations: detail.activations }
            : p,
        ),
      });
      for (const a of detail.activations.filter((v) => v.mine)) {
        void get().loadActivationRuns(pipelineId, a.projectId);
      }
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
      pipelineWiringMode: 'edit',
      selectedPipelineNodeId: 'trigger',
      pipelineRunDetail: null,
      pipelineActivationError: null,
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
    set({ pipelineWiringMode: 'view' });
    void get().loadPipelines();
  },

  enablePipelineById: async (pipelineId: string) => {
    try {
      await enablePipeline(pipelineId);
      set({
        pipelines: get().pipelines.map((p: PipelineListEntry) => (p.id === pipelineId ? { ...p, enabled: true } : p)),
        pipelineSaveError: null,
      });
      return true;
    } catch (e) {
      set({ pipelineSaveError: e instanceof Error ? e.message : String(e) });
      return false;
    }
  },

  disablePipelineById: async (pipelineId: string) => {
    try {
      await disablePipeline(pipelineId);
      set({
        pipelines: get().pipelines.map((p: PipelineListEntry) => (p.id === pipelineId ? { ...p, enabled: false } : p)),
        pipelineSaveError: null,
      });
      return true;
    } catch (e) {
      // 409 pipeline-has-activations rides the message (holders listed server-side).
      set({ pipelineSaveError: e instanceof Error ? e.message : String(e) });
      return false;
    }
  },

  promotePipelineById: async (pipelineId: string) => {
    await promotePipeline(pipelineId);
    await get().loadPipelines();
    // Anti-silent-failure (agentSettingsSlice.promoteAgent precedent): the
    // refetched entry must actually be org-scope, else surface the failure.
    const entry = get().pipelines.find((p: PipelineListEntry) => p.id === pipelineId);
    if (!entry || entry.scope !== 'org') {
      throw new Error(`Promote did not take effect for "${pipelineId}" — check server logs`);
    }
    if (get().selectedPipelineId === pipelineId) {
      await get().selectPipeline(pipelineId);
    }
  },

  savePipelineEditors: async (pipelineId: string, editors: string[]) => {
    const org = await updatePipelineEditors(pipelineId, editors);
    set({
      pipelines: get().pipelines.map((p: PipelineListEntry) => (p.id === pipelineId ? { ...p, org } : p)),
    });
  },

  runPipelineNowById: async (pipelineId: string, projectId: string) => {
    try {
      await runPipelineNow(pipelineId, projectId);
      return null;
    } catch (e: any) {
      return e?.message ?? 'run-now failed';
    }
  },

  activatePipelineTo: async (pipelineId: string, projectId: string) => {
    set({ pipelineActivationError: null });
    try {
      await activatePipeline(pipelineId, projectId);
      // Authoritative refresh — the entry's activations include the new row.
      if (get().selectedPipelineId === pipelineId) await get().selectPipeline(pipelineId);
      void get().loadPipelines();
      void get().loadActivatableProjects();
      void get().loadActivePipeline(projectId);
      return true;
    } catch (e) {
      set({ pipelineActivationError: e instanceof Error ? e.message : String(e) });
      return false;
    }
  },

  deactivatePipelineById: async (pipelineId: string, projectId: string) => {
    set({ pipelineActivationError: null });
    try {
      await deactivatePipeline(pipelineId, projectId);
      set({
        pipelines: get().pipelines.map((p: PipelineListEntry) =>
          p.id === pipelineId
            ? { ...p, activations: p.activations.filter((a) => !(a.mine && a.projectId === projectId)) }
            : p,
        ),
        pipelineOrphanActivations: get().pipelineOrphanActivations.filter(
          (a: PipelineActivationView) => !(a.pipelineId === pipelineId && a.projectId === projectId),
        ),
        activePipelineByProject: { ...get().activePipelineByProject, [projectId]: null },
      });
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

  loadActivationRuns: async (pipelineId: string, projectId: string, userId?: string) => {
    try {
      const { runs } = await fetchPipelineRuns(pipelineId, projectId, userId);
      set({
        pipelineRunsByActivation: {
          ...get().pipelineRunsByActivation,
          [activationRunsKey(pipelineId, projectId, userId)]: runs,
        },
      });
      if (!userId) {
        const live = runs.find((r) => r.status === 'running' || r.status === 'awaiting_human');
        if (live) void get().loadPipelineRunDetail(live.runId, projectId);
      }
    } catch {
      /* keeps last-good */
    }
  },

  loadPipelineRunDetail: async (runId: string, projectId: string) => {
    try {
      const { run } = await fetchPipelineRun(runId, projectId);
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

  setPipelineWiringMode: (mode) => set({ pipelineWiringMode: mode }),

  selectPipelineNode: (nodeId) => set({ selectedPipelineNodeId: nodeId }),

  applyPipelineEvent: (event: PipelineEventData) => {
    const state = get();
    switch (event.cause) {
      case 'runUpdate': {
        const { run } = event;
        const terminal = run.status !== 'running' && run.status !== 'awaiting_human';
        // Rail + activation-row projection (events arrive on the OWN channel,
        // so the touched activation row is always a `mine` row).
        set({
          pipelines: state.pipelines.map((p: PipelineListEntry) =>
            p.id === event.pipelineId
              ? {
                  ...p,
                  lastRun: { runId: run.runId, status: run.status, firedAt: run.startedAt },
                  pendingApprovalCount: run.steps.filter((s) => s.status === 'awaiting_gate').length,
                  activations: p.activations.map((a) =>
                    a.mine && a.projectId === event.projectId
                      ? {
                          ...a,
                          state: terminal
                            ? a.state === 'broken'
                              ? 'broken'
                              : 'waiting'
                            : run.status === 'awaiting_human'
                              ? 'awaiting_human'
                              : 'running',
                          currentRunId: terminal ? undefined : run.runId,
                          lastRun: { runId: run.runId, status: run.status, firedAt: run.startedAt },
                        }
                      : a,
                  ),
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
        // Per-activation runs projection.
        const runsKey = activationRunsKey(event.pipelineId, event.projectId);
        const runs = state.pipelineRunsByActivation[runsKey];
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
          set({ pipelineRunsByActivation: { ...get().pipelineRunsByActivation, [runsKey]: next } });
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
      case 'availabilityChanged': {
        set({
          pipelines: state.pipelines.map((p: PipelineListEntry) =>
            p.id === event.pipelineId ? { ...p, enabled: event.enabled } : p,
          ),
        });
        break;
      }
      case 'activationChanged': {
        // Own-channel event: fold the caller's own activation row in/out.
        set({
          pipelines: state.pipelines.map((p: PipelineListEntry) => {
            if (p.id !== event.pipelineId) return p;
            const without = p.activations.filter((a) => !(a.mine && a.projectId === event.projectId));
            const activations = event.activation
              ? [
                  {
                    pipelineId: event.pipelineId,
                    projectId: event.projectId,
                    activatedBy: event.activatedBy ?? event.activation.activatedBy ?? '',
                    activatedAt: event.activation.activatedAt,
                    mine: true,
                    state: 'waiting' as const,
                    ...(event.nextFireAt && { nextFireAt: event.nextFireAt }),
                  },
                  ...without,
                ]
              : without;
            return { ...p, activations, nextFireAt: event.nextFireAt };
          }),
          activePipelineByProject: {
            ...state.activePipelineByProject,
            [event.projectId]: event.activation
              ? {
                  pipelineId: event.pipelineId,
                  pipelineName:
                    state.pipelines.find((p: PipelineListEntry) => p.id === event.pipelineId)?.name ?? event.pipelineId,
                  state: 'waiting',
                  nextFireAt: event.nextFireAt,
                }
              : null,
          },
        });
        break;
      }
      case 'defChanged': {
        void get().loadPipelines();
        break;
      }
    }
  },
});
