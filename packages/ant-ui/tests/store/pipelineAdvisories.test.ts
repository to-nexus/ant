/**
 * The server's verdicts reach the author: `catalogWarnings` and the advisory
 * lifecycle are kept on the slice from the GET that opened the pipeline and
 * from every save, scoped to the selection they were answered for; an
 * acknowledgement is a draft edit.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create } from 'zustand';
import { createPipelineSlice } from '../../src/domain/store/slices/pipelineSlice';

const api = vi.hoisted(() => ({
  activatePipeline: vi.fn(),
  deactivatePipeline: vi.fn(),
  enablePipeline: vi.fn(),
  disablePipeline: vi.fn(),
  promotePipeline: vi.fn(),
  updatePipelineEditors: vi.fn(),
  fetchActivatableProjects: vi.fn().mockResolvedValue({ projects: [] }),
  fetchActivePipeline: vi.fn(),
  fetchPipelines: vi.fn().mockResolvedValue({ pipelines: [], invalid: [], orphanActivations: [] }),
  fetchPipeline: vi.fn(),
  createPipeline: vi.fn(),
  updatePipeline: vi.fn(),
  deletePipeline: vi.fn(),
  previewPipelineFires: vi.fn(),
  runPipelineNow: vi.fn(),
  fetchPipelineRuns: vi.fn().mockResolvedValue({ runs: [] }),
  fetchPipelineRun: vi.fn(),
  cancelPipelineRun: vi.fn(),
  fetchPipelineApprovals: vi.fn().mockResolvedValue({ approvals: [] }),
  resolvePipelineApproval: vi.fn(),
  answerPipelineClarify: vi.fn(),
  updateActivationApprovers: vi.fn(),
}));
vi.mock('@/infrastructure/http/api/pipelines', () => api);

const DEF = { version: 2, name: 'Notice', steps: [{ id: 'lookup', customJobRef: 'terms/notice', intent: 'lookup-period' }] };
const ENTRY = { id: 'p1', name: 'Notice', stepCount: 1, scope: 'user', readonly: false, enabled: false, activations: [], pendingApprovalCount: 0, openAdvisoryCount: 0 };

function buildStore() {
  return create<any>((set, get, store) => ({ selectedProject: 'proj-a', ...createPipelineSlice(set as any, get as any, store as any) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchPipelines.mockResolvedValue({ pipelines: [ENTRY], invalid: [], orphanActivations: [] });
  api.fetchPipelineApprovals.mockResolvedValue({ approvals: [] });
});

describe('pipelineServerJudgement — the server verdicts reach the author on save AND on open', () => {
  const OPEN = { open: [{ code: 'gate-waits-forever', stepId: 'sign', field: 'timeout', message: 'approval step "sign" waits forever' }], acknowledged: [], stale: [] };

  it('create keeps the judgement; a clean save clears it', async () => {
    const useStore = buildStore();
    useStore.getState().newPipelineDraft();
    useStore.getState().setPipelineDraft(DEF);
    api.createPipeline.mockResolvedValue({ id: 'p1', entry: ENTRY, catalogWarnings: ['agent "ghost" is not in your agent catalog'], advisories: OPEN });
    expect(await useStore.getState().savePipelineDraft()).toBe(true);
    expect(useStore.getState().pipelineServerJudgement).toEqual({ catalogWarnings: ['agent "ghost" is not in your agent catalog'], advisories: OPEN });

    api.updatePipeline.mockResolvedValue({ id: 'p1', entry: ENTRY });
    useStore.getState().setPipelineDraft({ ...DEF, name: 'Notice v2' });
    expect(await useStore.getState().savePipelineDraft()).toBe(true);
    expect(useStore.getState().pipelineServerJudgement).toEqual({ catalogWarnings: [], advisories: null });
  });

  it('opening a pipeline carries the GET judgement — a catalog change shows without a save', async () => {
    const useStore = buildStore();
    api.fetchPipeline.mockResolvedValue({ id: 'p2', def: DEF, scope: 'user', readonly: false, enabled: true, activations: [], advisories: OPEN });
    await useStore.getState().selectPipeline('p2');
    expect(useStore.getState().pipelineServerJudgement.advisories).toEqual(OPEN);
    // Selecting another pipeline (or none) resets it — the verdict belongs to the selection.
    api.fetchPipeline.mockResolvedValue({ id: 'p3', def: DEF, scope: 'user', readonly: false, enabled: false, activations: [] });
    await useStore.getState().selectPipeline('p3');
    expect(useStore.getState().pipelineServerJudgement).toEqual({ catalogWarnings: [], advisories: null });
    await useStore.getState().selectPipeline(null);
    expect(useStore.getState().pipelineServerJudgement).toEqual({ catalogWarnings: [], advisories: null });
  });

  it('a failed save keeps the previous judgement and records the error', async () => {
    const useStore = buildStore();
    useStore.setState({ selectedPipelineId: 'p1', pipelineDraft: DEF, pipelineSavedDef: DEF, pipelines: [ENTRY], pipelineServerJudgement: { catalogWarnings: ['old'], advisories: null } });
    api.updatePipeline.mockRejectedValue(new Error('invalid-pipeline-def'));
    expect(await useStore.getState().savePipelineDraft()).toBe(false);
    expect(useStore.getState().pipelineSaveError).toBe('invalid-pipeline-def');
    expect(useStore.getState().pipelineServerJudgement.catalogWarnings).toEqual(['old']);
  });

  it('acknowledging writes into the draft (a definition edit, saved with the pipeline); reopening removes the key', () => {
    const useStore = buildStore();
    useStore.setState({ selectedPipelineId: 'p1', pipelineDraft: DEF, pipelineSavedDef: DEF, pipelines: [ENTRY] });
    useStore.getState().acknowledgePipelineAdvisory('gate-waits-forever', 'lookup', 'inbox is watched daily');
    expect(useStore.getState().pipelineDraft.acknowledged).toEqual([{ code: 'gate-waits-forever', step: 'lookup', reason: 'inbox is watched daily' }]);
    expect(JSON.stringify(useStore.getState().pipelineDraft)).not.toBe(JSON.stringify(useStore.getState().pipelineSavedDef));
    useStore.getState().removePipelineAcknowledgement('gate-waits-forever', 'lookup');
    expect('acknowledged' in useStore.getState().pipelineDraft).toBe(false);
  });
});

describe('run history — per-run detail, per-activation selection, fetch status', () => {
  const RUN = (runId: string, status = 'completed') => ({ runId, pipelineId: 'p1', projectId: 'proj-a', status, firedBy: 'manual', fireEpoch: 1, startedAt: '2026-09-07T00:00:00.000Z' });
  const DETAIL = (runId: string, status = 'completed') => ({ ...RUN(runId, status), steps: [] });

  it('a failed history fetch is recorded as an error, never rendered as "no runs yet"', async () => {
    const useStore = buildStore();
    api.fetchPipelineRuns.mockRejectedValueOnce(new Error('boom'));
    await useStore.getState().loadActivationRuns('p1', 'proj-a');
    const key = 'p1:me:proj-a';
    expect(useStore.getState().pipelineRunsStatus[key]).toEqual({ status: 'error', error: 'boom' });
    expect(useStore.getState().pipelineRunsByActivation[key]).toBeUndefined();
  });

  it('opening a run in one activation does not evict another activation\'s live detail', async () => {
    const useStore = buildStore();
    api.fetchPipelineRun.mockImplementation(async (runId: string) => ({ run: DETAIL(runId, runId === 'live-b' ? 'running' : 'completed') }));
    useStore.getState().selectActivationRun('p1:me:proj-b', 'live-b', 'proj-b');
    useStore.getState().selectActivationRun('p1:me:proj-a', 'old-a', 'proj-a');
    await new Promise((r) => setTimeout(r, 0));
    const st = useStore.getState();
    expect(Object.keys(st.pipelineRunDetails).sort()).toEqual(['live-b', 'old-a']);
    expect(st.pipelineSelectedRunByActivation).toEqual({ 'p1:me:proj-b': 'live-b', 'p1:me:proj-a': 'old-a' });
    useStore.getState().selectActivationRun('p1:me:proj-a', null, 'proj-a');
    expect(useStore.getState().pipelineSelectedRunByActivation).toEqual({ 'p1:me:proj-b': 'live-b' });
  });

  it('a live run opens itself only while nothing is open in that activation', async () => {
    const useStore = buildStore();
    api.fetchPipelineRuns.mockResolvedValue({ runs: [RUN('live', 'running'), RUN('old')] });
    api.fetchPipelineRun.mockImplementation(async (runId: string) => ({ run: DETAIL(runId) }));
    await useStore.getState().loadActivationRuns('p1', 'proj-a');
    expect(useStore.getState().pipelineSelectedRunByActivation['p1:me:proj-a']).toBe('live');
    useStore.getState().selectActivationRun('p1:me:proj-a', 'old', 'proj-a');
    await useStore.getState().loadActivationRuns('p1', 'proj-a');
    expect(useStore.getState().pipelineSelectedRunByActivation['p1:me:proj-a']).toBe('old');
  });
});
