import i18next from 'i18next';
import { StateCreator } from 'zustand';
import type {
  ActivePipelineInfo,
  PipelineActivationView,
  PipelineAdvisoryCode,
  PipelineAdvisoryResolution,
  PipelineDef,
  PipelineEventData,
  PipelineListEntry,
  PipelineLiveRun,
  PipelineLiveState,
  PipelinePendingApproval,
  PipelineClarifyAnswerOutcome,
  PipelineRunSummary,
  PipelineScope,
  RunRecord,
} from '@ant/shared';
import { parsePipelineDuration, PIPELINE_DEF_VERSION, activationStateOf, foldLiveRun, liveRunOf, runSummaryOf } from '@ant/shared';
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
  reassignPipelineGate,
  answerPipelineClarify,
  runPipelineNow,
  updateActivationApprovers,
  updatePipeline,
  updatePipelineEditors,
} from '@/infrastructure/http/api/pipelines';
import { ApiError } from '@/infrastructure/http/api/client';
import { editorsEqual } from '@/presentation/components/shared/org/editors';
import { withAcknowledgement, withoutAcknowledgement } from '@/presentation/components/Pipelines/draft';

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
 * canvas, inspector, settings panel — writes) vs `pipelineSavedDef` (server
 * truth). Dirty = deep-unequal. Discard = one assignment. The canvas, the
 * inspector and the panel are three views over ONE draft, never three buffers.
 * Two more drafts ride the same ChangedBar — `pipelineEditorsDraft` (org
 * editors) and `pipelineApproversDraft` (per-activation gate rosters) —
 * reported together by `selectPipelineDirty` and written in one ordered pass
 * by `savePipelineAll`.
 *
 * Everything transient (runs, approvals, run detail, activations) is a
 * projection the `pipeline` SSE event keeps fresh via `applyPipelineEvent`;
 * REST fetches are the bootstrap path, and `resyncPipelineProjections` is the
 * ONE refresh — run on every SSE reconnect, it re-reads exactly what is held
 * (a `pipeline` event missed while the stream was down is otherwise lost until
 * a page reload, because the server pushes no pipeline snapshot on open).
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

/** Inverse of `activationRunsKey` — pipeline ids are validated slugs and project ids single segments, so neither carries `:`. */
export const parseActivationRunsKey = (key: string): { pipelineId: string; projectId: string; userId?: string } => {
  const first = key.indexOf(':');
  const last = key.lastIndexOf(':');
  const user = key.slice(first + 1, last);
  return { pipelineId: key.slice(0, first), projectId: key.slice(last + 1), ...(user !== 'me' && { userId: user }) };
};

const SEALED_RUNS_KEPT = 32;
const APPROVAL_TOMBSTONES_KEPT = 64;

/** A REST approvals snapshot issued at `seqAtRequest` predates every inbox fold after it — those rows must not come back. */
const removedSince =
  (tombstones: ReadonlyArray<{ gateId: string; seq: number }>, seqAtRequest: number) =>
  (gateId: string): boolean =>
    tombstones.some((t) => t.gateId === gateId && t.seq > seqAtRequest);

/**
 * The ONE inbox removal. Every fold that drops rows (a decision, an answer,
 * an SSE resolve, a runUpdate reconcile) records a tombstone on the shared
 * fold clock, so a refetch that was in flight when the row died cannot
 * re-install it (the answered card came back empty — 2026-09-21 report).
 */
function foldApprovalsOut(
  s: Pick<PipelineSliceState, 'pipelineApprovals' | 'pipelineApprovalTombstones' | 'pipelineSealSeq'>,
  dead: (a: PipelinePendingApproval) => boolean,
): Partial<PipelineSliceState> {
  const gone = s.pipelineApprovals.filter(dead);
  if (gone.length === 0) return {};
  const seq = s.pipelineSealSeq + 1;
  return {
    pipelineApprovals: s.pipelineApprovals.filter((a) => !dead(a)),
    pipelineSealSeq: seq,
    pipelineApprovalTombstones: [...s.pipelineApprovalTombstones, ...gone.map((a) => ({ gateId: a.gateId, seq }))].slice(
      -APPROVAL_TOMBSTONES_KEPT,
    ),
  };
}

/**
 * Does the run's step still hold this inbox row? Gate and tool rows park the
 * step `awaiting_gate` on an undecided gate; clarify rows park it
 * `awaiting_clarify` on the round the row names. Anything else — the step
 * re-dispatched, decided, or moved on — is a dead row.
 */
const stepHoldsRow = (run: PipelineRunPublic, row: PipelinePendingApproval): boolean => {
  const step = run.steps.find((st) => st.stepId === row.stepId);
  if (!step) return false;
  return row.kind === 'clarify'
    ? step.status === 'awaiting_clarify' && step.clarify?.clarifyId === row.gateId
    : step.status === 'awaiting_gate' && step.gate?.gateId === row.gateId && !step.gate.decision;
};

/** A REST snapshot issued at `seqAtRequest` predates every seal folded after it — those runs must not come back live. */
const sealedSince =
  (sealed: ReadonlyArray<{ runId: string; seq: number }>, seqAtRequest: number) =>
  (runId: string): boolean =>
    sealed.some((e) => e.runId === runId && e.seq > seqAtRequest);

function reconcileLiveRuns<T extends { state: PipelineLiveState | 'broken'; liveRuns?: PipelineLiveRun[] }>(
  row: T,
  isSealed: (runId: string) => boolean,
): T {
  const before = row.liveRuns ?? [];
  const liveRuns = before.filter((r) => !isSealed(r.runId));
  if (liveRuns.length === before.length) return row;
  return { ...row, liveRuns, state: row.state === 'broken' ? 'broken' : activationStateOf(liveRuns) } as T;
}

/**
 * The wire strips captured step answers (they ride the runs API only), so a
 * `runUpdate` fold must not erase what a fetch already showed. Same
 * `capturedAt` = same capture; a re-captured round carries a new stamp and wins.
 */
const mergeHeldAnswers = (incoming: PipelineRunPublic, held: PipelineRunPublic | undefined): PipelineRunPublic => {
  if (!held) return incoming;
  return {
    ...incoming,
    steps: incoming.steps.map((step) => {
      const prev = held.steps.find((h) => h.stepId === step.stepId);
      if (!prev?.output?.answer || !step.output || step.output.answer || prev.output.capturedAt !== step.output.capturedAt) return step;
      return {
        ...step,
        output: {
          ...step.output,
          answer: prev.output.answer,
          ...(prev.output.answerTruncated !== undefined && { answerTruncated: prev.output.answerTruncated }),
        },
      };
    }),
  };
};

export interface PipelineSliceState {
  pipelines: PipelineListEntry[];
  pipelinesInvalid: Array<{ id: string; error: string; scope: PipelineScope }>;
  /** Own activations whose pinned definition no longer resolves (deactivate-only rows). */
  pipelineOrphanActivations: PipelineActivationView[];
  /**
   * Whether `pipelines` is a real answer. An empty list is ambiguous on its own
   * — "no pipelines" and "never fetched" render identically — so the `_pipelines`
   * picker graft reads this, not the array length, to decide whether to fetch.
   */
  pipelinesStatus: 'idle' | 'loading' | 'ready' | 'error';
  pipelinesError: string | null;
  selectedPipelineId: string | null;
  /** null = nothing being edited; '' pipelineDraftIsNew = unsaved new draft. */
  pipelineDraft: PipelineDef | null;
  pipelineSavedDef: PipelineDef | null;
  pipelineDraftIsNew: boolean;
  pipelineSaveError: string | null;
  /**
   * The server's judgement of the selected pipeline against the caller's
   * catalog — from the GET that opened it and from every save since. Held,
   * not recomputed: the FE's live resolution over the draft is the primary
   * view; this fills what the FE catalog cannot see (an empty `accountAgents`).
   */
  pipelineServerJudgement: { catalogWarnings: string[]; advisories: PipelineAdvisoryResolution | null };
  pipelinePanelView: 'editor' | 'execution';
  /** Org editors draft for the selected pipeline — null = untouched. */
  pipelineEditorsDraft: string[] | null;
  /** Per-activation gate-roster drafts keyed by projectId — absent key = untouched. */
  pipelineApproversDraft: Record<string, Record<string, string[]>>;
  /** `savePipelineAll` in flight. */
  pipelineSaving: boolean;
  /** Canvas selection — a step id, or the trigger pseudo-node. */
  selectedPipelineNodeId: string | null;
  /** Per-activation run history — see `activationRunsKey`. */
  pipelineRunsByActivation: Record<string, PipelineRunSummary[]>;
  /** Fetch state of each activation's history — an empty list and a failed fetch must not look alike. */
  pipelineRunsStatus: Record<string, { status: 'loading' | 'ready' | 'error'; error?: string }>;
  /** Run detail keyed by runId — two activations can be watched at once. */
  pipelineRunDetails: Record<string, PipelineRunPublic>;
  /** The run a person opened in each activation's history (`activationRunsKey` → runId). */
  pipelineSelectedRunByActivation: Record<string, string>;
  /** Monotonic count of terminal `runUpdate` folds — a refetch captures it before issuing. */
  pipelineSealSeq: number;
  /** Runs sealed by a live fold and the seq they sealed at (bounded, oldest first). */
  pipelineSealedRuns: Array<{ runId: string; seq: number }>;
  pipelineApprovals: PipelinePendingApproval[];
  /** Inbox rows removed by a live fold and the seq they died at (bounded, oldest first) — the approvals refetch filters through it. */
  pipelineApprovalTombstones: Array<{ gateId: string; seq: number }>;
  /**
   * Approver context panel (slideover) — self-contained on run data: an
   * approver never enters the owner's project or definition surfaces.
   */
  approverPanel: PipelinePendingApproval | null;
  approverPanelRun: PipelineRunPublic | null;
  /** Per-project active-pipeline lock signal (chat surface). null = none. */
  activePipelineByProject: Record<string, ActivePipelineInfo | null>;
  /** Universal projects activatable by the caller (also the projectId→name map). */
  pipelineActivatableProjects: PipelineActivatableProject[];
  pipelineActivationError: string | null;
}

export interface PipelineSliceActions {
  loadPipelines: () => Promise<void>;
  /** Fetch the list once — no-op while loading or when a real answer is held. */
  ensurePipelinesLoaded: () => Promise<void>;
  selectPipeline: (pipelineId: string | null) => Promise<void>;
  newPipelineDraft: () => void;
  setPipelineDraft: (def: PipelineDef) => void;
  /** Record an advisory as by-design in the draft (`acknowledged:`) — a definition edit, saved with the pipeline. */
  acknowledgePipelineAdvisory: (code: PipelineAdvisoryCode, step: string, reason: string) => void;
  removePipelineAcknowledgement: (code: PipelineAdvisoryCode, step: string) => void;
  discardPipelineDraft: () => void;
  savePipelineDraft: () => Promise<boolean>;
  setPipelineEditorsDraft: (editors: string[] | null) => void;
  setPipelineApproversDraft: (projectId: string, roster: Record<string, string[]> | null) => void;
  /** Definition → editors → approvers; stops at the first failure so the rest stays dirty for a retry. */
  savePipelineAll: () => Promise<boolean>;
  discardPipelineAll: () => void;
  deletePipelineById: (pipelineId: string) => Promise<void>;
  enablePipelineById: (pipelineId: string) => Promise<boolean>;
  disablePipelineById: (pipelineId: string) => Promise<boolean>;
  promotePipelineById: (pipelineId: string) => Promise<void>;
  savePipelineEditors: (pipelineId: string, editors: string[]) => Promise<void>;
  runPipelineNowById: (pipelineId: string, projectId: string) => Promise<string | null>;
  activatePipelineTo: (pipelineId: string, projectId: string, approvers?: Record<string, string[]>) => Promise<boolean>;
  /** Activator-only per-gate roster edit (S9 — live from the next resolve on). */
  updateActivationApproversTo: (
    pipelineId: string,
    projectId: string,
    approvers: Record<string, string[]>,
  ) => Promise<boolean>;
  openApproverPanel: (approval: PipelinePendingApproval) => void;
  closeApproverPanel: () => void;
  deactivatePipelineById: (pipelineId: string, projectId: string) => Promise<boolean>;
  /** Authoritative re-read of every activation surface after the server refused a binding change (stale rows). */
  resyncActivationViews: (pipelineId: string, projectId: string) => Promise<void>;
  loadActivatableProjects: () => Promise<void>;
  loadActivePipeline: (projectId: string) => Promise<void>;
  loadActivationRuns: (pipelineId: string, projectId: string, userId?: string) => Promise<void>;
  loadPipelineRunDetail: (runId: string, projectId: string) => Promise<void>;
  /** Open (or close with null) one run in an activation's history; loads its detail. */
  selectActivationRun: (activationKey: string, runId: string | null, projectId: string) => void;
  loadPipelineApprovals: () => Promise<void>;
  resolvePipelineApprovalById: (gateId: string, decision: 'approve' | 'reject', note?: string) => Promise<void>;
  /** Route one run's armed gate to a candidate (`null` = everyone) — a candidate's routing hint, never authority. */
  reassignPipelineGateTo: (approval: PipelinePendingApproval, userId: string | null) => Promise<void>;
  answerPipelineClarifyById: (clarifyId: string, runId: string, stepId: string, answer: string) => Promise<PipelineClarifyAnswerOutcome>;
  /** The ONE reconnect refresh — re-reads every held projection (list → approvals, histories, live details, chat lock). */
  resyncPipelineProjections: () => void;
  setPipelinePanelView: (view: 'editor' | 'execution') => void;
  selectPipelineNode: (nodeId: string | null) => void;
  applyPipelineEvent: (event: PipelineEventData) => void;
}

export type PipelineSlice = PipelineSliceState & PipelineSliceActions;

export const pipelineDraftIsDirty = (draft: PipelineDef | null, saved: PipelineDef | null): boolean => {
  if (!draft) return false;
  if (!saved) return true;
  return JSON.stringify(draft) !== JSON.stringify(saved);
};

/** Roster identity ignores key order and empty gates (the server drops both). */
const normalizeRoster = (roster: Record<string, string[]> | undefined): string =>
  JSON.stringify(
    Object.entries(roster ?? {})
      .filter(([, list]) => list.length > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([gateId, list]) => [gateId, [...list].sort()]),
  );

export interface PipelineDirtyReport {
  definition: boolean;
  editors: boolean;
  /** Project ids whose own-activation roster draft differs from the saved one. */
  approvers: string[];
  count: number;
}

type PipelineDirtyState = Pick<
  PipelineSliceState,
  'pipelines' | 'selectedPipelineId' | 'pipelineDraft' | 'pipelineSavedDef' | 'pipelineEditorsDraft' | 'pipelineApproversDraft'
>;

/** The ChangedBar's one signal across the three drafts — null when nothing is dirty. */
export const selectPipelineDirty = (s: PipelineDirtyState): PipelineDirtyReport | null => {
  const definition = pipelineDraftIsDirty(s.pipelineDraft, s.pipelineSavedDef);
  const entry = s.selectedPipelineId ? s.pipelines.find((p) => p.id === s.selectedPipelineId) : undefined;
  const editors = !!entry && s.pipelineEditorsDraft != null && !editorsEqual(s.pipelineEditorsDraft, entry.org?.editors ?? []);
  const approvers: string[] = [];
  if (entry) {
    for (const [projectId, roster] of Object.entries(s.pipelineApproversDraft)) {
      const own = entry.activations.find((a) => a.mine && a.projectId === projectId);
      if (own && normalizeRoster(roster) !== normalizeRoster(own.approvers)) approvers.push(projectId);
    }
  }
  const count = (definition ? 1 : 0) + (editors ? 1 : 0) + approvers.length;
  return count === 0 ? null : { definition, editors, approvers, count };
};

const NO_JUDGEMENT = { catalogWarnings: [] as string[], advisories: null as PipelineAdvisoryResolution | null };
const CLEAN_DRAFTS = { pipelineEditorsDraft: null, pipelineApproversDraft: {}, pipelineServerJudgement: NO_JUDGEMENT } as const;

export const createPipelineSlice: StateCreator<any, [], [], PipelineSlice> = (set, get) => ({
  pipelines: [],
  pipelinesInvalid: [],
  pipelineOrphanActivations: [],
  pipelinesStatus: 'idle',
  pipelinesError: null,
  selectedPipelineId: null,
  pipelineDraft: null,
  pipelineSavedDef: null,
  pipelineDraftIsNew: false,
  pipelineSaveError: null,
  pipelineServerJudgement: NO_JUDGEMENT,
  pipelinePanelView: 'editor',
  pipelineEditorsDraft: null,
  pipelineApproversDraft: {},
  pipelineSaving: false,
  selectedPipelineNodeId: null,
  pipelineRunsByActivation: {},
  pipelineRunsStatus: {},
  pipelineRunDetails: {},
  pipelineSelectedRunByActivation: {},
  pipelineSealSeq: 0,
  pipelineSealedRuns: [],
  pipelineApprovals: [],
  pipelineApprovalTombstones: [],
  approverPanel: null,
  approverPanelRun: null,
  activePipelineByProject: {},
  pipelineActivatableProjects: [],
  pipelineActivationError: null,

  loadPipelines: async () => {
    set({ pipelinesStatus: 'loading' });
    const seqAtRequest = get().pipelineSealSeq;
    try {
      const { pipelines, invalid, orphanActivations } = await fetchPipelines();
      const isSealed = sealedSince(get().pipelineSealedRuns, seqAtRequest);
      set({
        pipelines: pipelines.map((p) => ({ ...p, activations: p.activations.map((a) => reconcileLiveRuns(a, isSealed)) })),
        pipelinesInvalid: invalid ?? [],
        pipelineOrphanActivations: orphanActivations ?? [],
        pipelinesStatus: 'ready',
        pipelinesError: null,
      });
      void get().loadPipelineApprovals();
    } catch (e) {
      set({ pipelinesStatus: 'error', pipelinesError: e instanceof Error ? e.message : String(e) });
    }
  },

  ensurePipelinesLoaded: async () => {
    const status = get().pipelinesStatus as PipelineSliceState['pipelinesStatus'];
    if (status === 'loading' || status === 'ready') return;
    await get().loadPipelines();
  },

  selectPipeline: async (pipelineId: string | null) => {
    if (pipelineId === null) {
      set({ selectedPipelineId: null, pipelineDraft: null, pipelineSavedDef: null, pipelineDraftIsNew: false, pipelineSaveError: null, selectedPipelineNodeId: null, pipelineSelectedRunByActivation: {}, pipelineActivationError: null, ...CLEAN_DRAFTS });
      return;
    }
    // The current view survives selection — only a NEW draft forces the editor.
    set({ selectedPipelineId: pipelineId, pipelineDraftIsNew: false, pipelineSaveError: null, selectedPipelineNodeId: null, pipelineSelectedRunByActivation: {}, pipelineActivationError: null, ...CLEAN_DRAFTS });
    try {
      const detail = await fetchPipeline(pipelineId);
      // Stale guard — the user may have clicked another pipeline meanwhile.
      if (get().selectedPipelineId !== pipelineId) return;
      set({
        pipelineDraft: detail.def,
        pipelineSavedDef: detail.def,
        pipelineServerJudgement: { catalogWarnings: detail.catalogWarnings ?? [], advisories: detail.advisories ?? null },
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
      // The app's i18n bootstrap initializes the default i18next instance; a
      // store built without it (tests) keeps the English fallback.
      name: i18next.isInitialized ? i18next.t('pipelines:editor.defaultName', 'New pipeline') : 'New pipeline',
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
      // No node selected: the inspector slot opens on the settings panel (name lives there).
      selectedPipelineNodeId: null,
      pipelineSelectedRunByActivation: {},
      pipelineActivationError: null,
      ...CLEAN_DRAFTS,
    });
  },

  setPipelineDraft: (def: PipelineDef) => set({ pipelineDraft: def }),

  acknowledgePipelineAdvisory: (code, step, reason) => {
    const draft = get().pipelineDraft as PipelineDef | null;
    if (draft) set({ pipelineDraft: withAcknowledgement(draft, code, step, reason) });
  },

  removePipelineAcknowledgement: (code, step) => {
    const draft = get().pipelineDraft as PipelineDef | null;
    if (draft) set({ pipelineDraft: withoutAcknowledgement(draft, code, step) });
  },

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
        const { id, catalogWarnings, advisories } = await createPipeline(pipelineDraft);
        set({ pipelineDraftIsNew: false, selectedPipelineId: id, pipelineSavedDef: pipelineDraft, pipelineSaveError: null, pipelineServerJudgement: { catalogWarnings: catalogWarnings ?? [], advisories: advisories ?? null } });
      } else if (selectedPipelineId) {
        const { catalogWarnings, advisories } = await updatePipeline(selectedPipelineId, pipelineDraft);
        set({ pipelineSavedDef: pipelineDraft, pipelineSaveError: null, pipelineServerJudgement: { catalogWarnings: catalogWarnings ?? [], advisories: advisories ?? null } });
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

  setPipelineEditorsDraft: (editors) => set({ pipelineEditorsDraft: editors }),

  setPipelineApproversDraft: (projectId, roster) => {
    const { [projectId]: _dropped, ...rest } = get().pipelineApproversDraft;
    set({ pipelineApproversDraft: roster ? { ...rest, [projectId]: roster } : rest });
  },

  savePipelineAll: async () => {
    const dirty = selectPipelineDirty(get());
    if (!dirty) return true;
    set({ pipelineSaving: true, pipelineSaveError: null });
    try {
      // Definition first: it is the only leg that mints an id (create) and the
      // only one the enabled gate refuses; the other two need an existing id.
      if (dirty.definition && !(await get().savePipelineDraft())) return false;
      const pipelineId = get().selectedPipelineId;
      if (!pipelineId) return false;
      if (dirty.editors) {
        try {
          await get().savePipelineEditors(pipelineId, get().pipelineEditorsDraft ?? []);
          set({ pipelineEditorsDraft: null });
        } catch (e) {
          set({ pipelineSaveError: e instanceof Error ? e.message : String(e) });
          return false;
        }
      }
      for (const projectId of dirty.approvers) {
        const roster = get().pipelineApproversDraft[projectId] ?? {};
        if (!(await get().updateActivationApproversTo(pipelineId, projectId, roster))) {
          set({ pipelineSaveError: get().pipelineActivationError });
          return false;
        }
        get().setPipelineApproversDraft(projectId, null);
      }
      return true;
    } finally {
      set({ pipelineSaving: false });
    }
  },

  discardPipelineAll: () => {
    get().discardPipelineDraft();
    set({ ...CLEAN_DRAFTS });
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
    set({ ...CLEAN_DRAFTS });
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

  activatePipelineTo: async (pipelineId: string, projectId: string, approvers?: Record<string, string[]>) => {
    set({ pipelineActivationError: null });
    try {
      if (approvers && Object.keys(approvers).length > 0) await activatePipeline(pipelineId, projectId, approvers);
      else await activatePipeline(pipelineId, projectId);
      // Authoritative refresh — the entry's activations include the new row.
      if (get().selectedPipelineId === pipelineId) await get().selectPipeline(pipelineId);
      void get().loadPipelines();
      void get().loadActivatableProjects();
      void get().loadActivePipeline(projectId);
      return true;
    } catch (e) {
      set({ pipelineActivationError: e instanceof Error ? e.message : String(e) });
      // A refused binding change means this view's rows are stale — re-read them.
      if (e instanceof ApiError && (e.status === 404 || e.status === 409)) void get().resyncActivationViews(pipelineId, projectId);
      return false;
    }
  },

  resyncActivationViews: async (pipelineId: string, projectId: string) => {
    void get().loadPipelines();
    void get().loadActivatableProjects();
    void get().loadActivePipeline(projectId);
    if (get().selectedPipelineId === pipelineId) await get().selectPipeline(pipelineId);
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
      if (e instanceof ApiError && (e.status === 404 || e.status === 409)) void get().resyncActivationViews(pipelineId, projectId);
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
    const seqAtRequest = get().pipelineSealSeq;
    try {
      const { active } = await fetchActivePipeline(projectId);
      const isSealed = sealedSince(get().pipelineSealedRuns, seqAtRequest);
      set({ activePipelineByProject: { ...get().activePipelineByProject, [projectId]: active && reconcileLiveRuns(active, isSealed) } });
    } catch {
      /* chat lock signal keeps last-good; SSE folds correct it */
    }
  },

  loadActivationRuns: async (pipelineId: string, projectId: string, userId?: string) => {
    const key = activationRunsKey(pipelineId, projectId, userId);
    set({ pipelineRunsStatus: { ...get().pipelineRunsStatus, [key]: { status: 'loading' } } });
    const seqAtRequest = get().pipelineSealSeq;
    try {
      const { runs: fetched } = await fetchPipelineRuns(pipelineId, projectId, userId);
      // A run sealed after this request was issued keeps its held (sealed) row — the snapshot predates the seal.
      const isSealed = sealedSince(get().pipelineSealedRuns, seqAtRequest);
      const held: PipelineRunSummary[] = get().pipelineRunsByActivation[key] ?? [];
      const runs = fetched.map((r) => (isSealed(r.runId) ? held.find((h) => h.runId === r.runId) ?? r : r));
      set({
        pipelineRunsByActivation: { ...get().pipelineRunsByActivation, [key]: runs },
        pipelineRunsStatus: { ...get().pipelineRunsStatus, [key]: { status: 'ready' } },
      });
      if (!userId) {
        // The NEWEST live run opens itself when nothing is open yet — the person
        // did not click it, so a run they DID open is never displaced.
        const live = runs
          .filter((r) => r.status === 'running' || r.status === 'awaiting_human')
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
        if (live && !get().pipelineSelectedRunByActivation[key]) get().selectActivationRun(key, live.runId, projectId);
      }
    } catch (e) {
      // The list keeps its last-good value; the failure is recorded, not swallowed
      // into an empty state that reads as "no runs yet".
      set({ pipelineRunsStatus: { ...get().pipelineRunsStatus, [key]: { status: 'error', error: e instanceof Error ? e.message : String(e) } } });
    }
  },

  loadPipelineRunDetail: async (runId: string, projectId: string) => {
    try {
      const { run } = await fetchPipelineRun(runId, projectId);
      set({ pipelineRunDetails: { ...get().pipelineRunDetails, [run.runId]: run } });
    } catch {
      /* keep previous */
    }
  },

  selectActivationRun: (activationKey, runId, projectId) => {
    const next = { ...get().pipelineSelectedRunByActivation };
    if (runId === null) delete next[activationKey];
    else next[activationKey] = runId;
    set({ pipelineSelectedRunByActivation: next });
    if (runId !== null) void get().loadPipelineRunDetail(runId, projectId);
  },

  loadPipelineApprovals: async () => {
    const seqAtRequest = get().pipelineSealSeq;
    try {
      const { approvals } = await fetchPipelineApprovals();
      // The snapshot is the refill (a reconnect's only source of rows armed
      // while offline) — never dropped; only rows folded out since the
      // request began are filtered, so a stale response cannot resurrect them.
      const dead = removedSince(get().pipelineApprovalTombstones, seqAtRequest);
      set({ pipelineApprovals: approvals.filter((a) => !dead(a.gateId)) });
    } catch {
      /* keep last-good */
    }
  },

  resolvePipelineApprovalById: async (gateId: string, decision: 'approve' | 'reject', note?: string) => {
    try {
      await resolvePipelineApproval(gateId, decision, note);
    } catch (e) {
      // 409 (someone else decided — S7) and 404 (authority revoked — S6) both
      // mean this row is dead: fold it, then rethrow so the surface can name why.
      if (e instanceof ApiError && (e.status === 409 || e.status === 404)) {
        set((s: PipelineSliceState) => foldApprovalsOut(s, (a) => a.gateId === gateId));
      }
      throw e;
    }
    // Success removal is NOT optimistic — the server resolved; the
    // approvalResolved SSE event is the durable fold for other surfaces.
    set((s: PipelineSliceState) => foldApprovalsOut(s, (a) => a.gateId === gateId));
    // A panel open on this gate refreshes to show the landed decision.
    const panel = get().approverPanel;
    if (panel?.gateId === gateId) {
      try {
        const { run } = await fetchPipelineRun(panel.runId, panel.projectId);
        set({ approverPanelRun: run });
      } catch {
        /* panel keeps last-good */
      }
    }
  },

  updateActivationApproversTo: async (pipelineId: string, projectId: string, approvers: Record<string, string[]>) => {
    set({ pipelineActivationError: null });
    try {
      const { approvers: saved } = await updateActivationApprovers(projectId, approvers);
      set({
        pipelines: get().pipelines.map((p: PipelineListEntry) =>
          p.id === pipelineId
            ? {
                ...p,
                activations: p.activations.map((a) =>
                  a.mine && a.projectId === projectId
                    ? { ...a, approvers: Object.keys(saved).length > 0 ? saved : undefined }
                    : a,
                ),
              }
            : p,
        ),
      });
      return true;
    } catch (e) {
      set({ pipelineActivationError: e instanceof Error ? e.message : String(e) });
      return false;
    }
  },

  openApproverPanel: (approval: PipelinePendingApproval) => {
    set({ approverPanel: approval, approverPanelRun: null });
    void (async () => {
      try {
        const { run } = await fetchPipelineRun(approval.runId, approval.projectId);
        if (get().approverPanel?.gateId === approval.gateId) set({ approverPanelRun: run });
      } catch {
        /* the panel shows its retry affordance on null run */
      }
    })();
  },

  closeApproverPanel: () => set({ approverPanel: null, approverPanelRun: null }),

  reassignPipelineGateTo: async (approval: PipelinePendingApproval, userId: string | null) => {
    const gateId = approval.gateId;
    let assignees: string[];
    try {
      ({ assignees } = await reassignPipelineGate(approval.runId, approval.stepId, userId));
    } catch (e) {
      // 409 (decided meanwhile) / 404 (gate gone or authority revoked): the row is dead.
      if (e instanceof ApiError && (e.status === 409 || e.status === 404)) {
        set((s: PipelineSliceState) => foldApprovalsOut(s, (a) => a.gateId === gateId));
      }
      throw e;
    }
    // Local fold; the server's re-fired approvalRequested upserts every other holder's row.
    const patch = (a: PipelinePendingApproval): PipelinePendingApproval => {
      if (a.gateId !== gateId) return a;
      const { assignees: _prev, ...rest } = a;
      return assignees.length > 0 ? { ...rest, assignees } : rest;
    };
    set({ pipelineApprovals: get().pipelineApprovals.map(patch) });
    const panel = get().approverPanel;
    if (panel?.gateId === gateId) set({ approverPanel: patch(panel) });
  },

  answerPipelineClarifyById: async (clarifyId: string, runId: string, stepId: string, answer: string) => {
    const fold = () => set((s: PipelineSliceState) => foldApprovalsOut(s, (a) => a.gateId === clarifyId));
    let outcome: PipelineClarifyAnswerOutcome;
    try {
      ({ clarify: outcome } = await answerPipelineClarify(runId, stepId, answer));
    } catch (e) {
      // Gate parity: 409 (already answered / run cancelled) and 404 (run gone)
      // both mean this row is dead — fold it, then rethrow so the form names why.
      if (e instanceof ApiError && (e.status === 409 || e.status === 404)) fold();
      throw e;
    }
    // Removal after the server accepted; the clarifyAnswered SSE event folds
    // every other surface, and the run's own runUpdate moves the canvas.
    fold();
    return outcome;
  },

  resyncPipelineProjections: () => {
    const s = get();
    if (s.pipelinesStatus === 'ready') void s.loadPipelines();
    else void s.loadPipelineApprovals();
    for (const key of Object.keys(s.pipelineRunsByActivation as Record<string, PipelineRunSummary[]>)) {
      const { pipelineId, projectId, userId } = parseActivationRunsKey(key);
      void s.loadActivationRuns(pipelineId, projectId, userId);
    }
    for (const run of Object.values(s.pipelineRunDetails as Record<string, PipelineRunPublic>)) {
      if (run.status === 'running' || run.status === 'awaiting_human') void s.loadPipelineRunDetail(run.runId, run.projectId);
    }
    const panel = s.approverPanel as PipelinePendingApproval | null;
    if (panel) {
      fetchPipelineRun(panel.runId, panel.projectId)
        .then(({ run }) => {
          if (get().approverPanel?.gateId === panel.gateId) set({ approverPanelRun: run });
        })
        .catch(() => {
          /* panel keeps last-good */
        });
    }
    if (s.selectedProject) void s.loadActivePipeline(s.selectedProject);
  },

  setPipelinePanelView: (view) => set({ pipelinePanelView: view }),

  selectPipelineNode: (nodeId) => set({ selectedPipelineNodeId: nodeId }),

  applyPipelineEvent: (event: PipelineEventData) => {
    const state = get();
    switch (event.cause) {
      case 'runUpdate': {
        const { run } = event;
        const terminal = liveRunOf(run) === null;
        const lastRun = { runId: run.runId, status: run.status, firedAt: run.startedAt };
        // One functional update: every projection reads the SAME snapshot, and
        // both live-set holders (activation row, chat lock signal) go through
        // the ONE fold + state rule — N live runs stay N until each seals.
        set((s: PipelineSliceState) => {
          const patch: Partial<PipelineSliceState> = {};
          // Rail + activation-row projection (events arrive on the OWN channel,
          // so the touched activation row is always a `mine` row).
          patch.pipelines = s.pipelines.map((p) =>
            p.id === event.pipelineId
              ? {
                  ...p,
                  lastRun,
                  activations: p.activations.map((a) => {
                    if (!(a.mine && a.projectId === event.projectId)) return a;
                    const liveRuns = foldLiveRun(a.liveRuns ?? [], run);
                    return { ...a, state: a.state === 'broken' ? 'broken' : activationStateOf(liveRuns), liveRuns, lastRun };
                  }),
                }
              : p,
          );
          // Chat lock signal: the bound project's state follows its live set.
          const activeInfo = s.activePipelineByProject[event.projectId];
          if (activeInfo?.pipelineId === event.pipelineId || (!activeInfo && !terminal)) {
            const entry = s.pipelines.find((p) => p.id === event.pipelineId);
            const liveRuns = foldLiveRun(activeInfo?.liveRuns ?? [], run);
            patch.activePipelineByProject = {
              ...s.activePipelineByProject,
              [event.projectId]: {
                pipelineId: event.pipelineId,
                pipelineName: entry?.name ?? activeInfo?.pipelineName ?? event.pipelineId,
                state: activationStateOf(liveRuns),
                nextFireAt: entry?.nextFireAt ?? activeInfo?.nextFireAt,
                liveRuns,
              },
            };
          }
          // Per-activation history row — the shared summary shape, so a run
          // never changes shape between its live row and its sealed line.
          const runsKey = activationRunsKey(event.pipelineId, event.projectId);
          const runs = s.pipelineRunsByActivation[runsKey];
          if (runs) {
            const summary = runSummaryOf(run);
            patch.pipelineRunsByActivation = {
              ...s.pipelineRunsByActivation,
              [runsKey]: runs.some((r) => r.runId === run.runId)
                ? runs.map((r) => (r.runId === run.runId ? summary : r))
                : [summary, ...runs],
            };
          }
          // Run detail follows live for every run already held, and for the
          // selected pipeline's runs (the design-view overlay reads them).
          const held = s.pipelineRunDetails[run.runId];
          if (held || s.selectedPipelineId === event.pipelineId) {
            patch.pipelineRunDetails = { ...s.pipelineRunDetails, [run.runId]: mergeHeldAnswers(run, held) };
          }
          // Inbox rows follow the STEP STATE on every runUpdate — the one
          // durable publisher — so a lost best-effort clarifyAnswered /
          // approvalResolved, or a stale approvals refetch, never leaves a row
          // whose step already moved on. Approver rows ride another owner's
          // run and never receive its runUpdate; a terminal run holds no row.
          Object.assign(
            patch,
            foldApprovalsOut(s, (a) => a.role !== 'approver' && a.runId === run.runId && !stepHoldsRow(run, a)),
          );
          if (terminal) {
            // A terminal run leaves the selection so the next live run can
            // open itself (`loadActivationRuns`).
            if (s.pipelineSelectedRunByActivation[runsKey] === run.runId) {
              patch.pipelineSelectedRunByActivation = Object.fromEntries(
                Object.entries(s.pipelineSelectedRunByActivation).filter(([k]) => k !== runsKey),
              );
            }
            const seq = (patch.pipelineSealSeq ?? s.pipelineSealSeq) + 1;
            patch.pipelineSealSeq = seq;
            patch.pipelineSealedRuns = [...s.pipelineSealedRuns, { runId: run.runId, seq }].slice(-SEALED_RUNS_KEPT);
          }
          return patch;
        });
        break;
      }
      case 'approvalRequested': {
        // Upsert: a reminder or a reassign re-fires the same gateId with fresher
        // routing (`assignees`) — the held row takes it in place, never a duplicate.
        const exists = state.pipelineApprovals.some((a: PipelinePendingApproval) => a.gateId === event.approval.gateId);
        set({
          pipelineApprovals: exists
            ? state.pipelineApprovals.map((a: PipelinePendingApproval) => (a.gateId === event.approval.gateId ? { ...a, ...event.approval } : a))
            : [event.approval, ...state.pipelineApprovals],
        });
        const panel = state.approverPanel;
        if (panel?.gateId === event.approval.gateId) set({ approverPanel: { ...panel, ...event.approval } });
        break;
      }
      case 'approvalResolved': {
        set((s: PipelineSliceState) => foldApprovalsOut(s, (a) => a.gateId === event.gateId));
        // An open approver panel on this gate refreshes to show the decision.
        const panel = state.approverPanel;
        if (panel?.gateId === event.gateId) {
          void (async () => {
            try {
              const { run } = await fetchPipelineRun(panel.runId, panel.projectId);
              if (get().approverPanel?.gateId === event.gateId) set({ approverPanelRun: run });
            } catch {
              /* keep last-good */
            }
          })();
        }
        break;
      }
      // Clarify rows ride the same inbox list — gateId/cardId carry the clarifyId.
      case 'clarifyRequested': {
        const exists = state.pipelineApprovals.some((a: PipelinePendingApproval) => a.gateId === event.clarify.gateId);
        if (!exists) set({ pipelineApprovals: [event.clarify, ...state.pipelineApprovals] });
        break;
      }
      case 'clarifyAnswered': {
        set((s: PipelineSliceState) => foldApprovalsOut(s, (a) => a.gateId === event.clarifyId));
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
                    liveRuns: [],
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
                  liveRuns: [],
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
      case 'fetchPolled': {
        // Own-channel telemetry: the activation row's lastPoll and its next poll (polledAt + every).
        set({
          pipelines: state.pipelines.map((p: PipelineListEntry) => {
            if (p.id !== event.pipelineId) return p;
            const everyMs = parsePipelineDuration(p.every);
            const nextFireAt = everyMs ? new Date(Date.parse(event.lastPoll.polledAt) + everyMs).toISOString() : undefined;
            return {
              ...p,
              ...(nextFireAt && { nextFireAt }),
              activations: p.activations.map((a) =>
                a.mine && a.projectId === event.projectId ? { ...a, lastPoll: event.lastPoll, ...(nextFireAt && { nextFireAt }) } : a,
              ),
            };
          }),
        });
        break;
      }
    }
  },
});
