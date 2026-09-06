/**
 * pipelineSlice activation axis — activate/deactivate round-trips (activation
 * is per PROJECT, N per pipeline), the SSE activation/availability folds, and
 * the per-project lock selector the chat surface reads.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create } from 'zustand';
import { createPipelineSlice } from '../../src/domain/store/slices/pipelineSlice';
import {
  selectActivationByProject,
  selectActivePipelineForSelectedProject,
} from '../../src/domain/store/selectors/pipelines';

const api = vi.hoisted(() => ({
  activatePipeline: vi.fn(),
  deactivatePipeline: vi.fn(),
  enablePipeline: vi.fn(),
  disablePipeline: vi.fn(),
  promotePipeline: vi.fn(),
  updatePipelineEditors: vi.fn(),
  fetchPipelineActivations: vi.fn(),
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

const ACTIVATION = {
  pipelineId: 'p1',
  pipelineScope: 'user' as const,
  projectId: 'proj-a',
  activatedAt: '2026-08-20T00:00:00.000Z',
  activatedBy: 'me@x.io',
};
const ACTIVATION_VIEW = {
  pipelineId: 'p1',
  projectId: 'proj-a',
  activatedBy: 'me@x.io',
  activatedAt: '2026-08-20T00:00:00.000Z',
  mine: true,
  state: 'waiting' as const,
};
const ENTRY = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  name: 'Digest',
  cron: '0 9 * * 1',
  stepCount: 1,
  scope: 'user' as const,
  readonly: false,
  enabled: true,
  activations: [] as unknown[],
  pendingApprovalCount: 0,
  ...over,
});

function buildStore() {
  return create<any>((set, get, store) => ({
    selectedProject: 'proj-a',
    ...createPipelineSlice(set as any, get as any, store as any),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchActivatableProjects.mockResolvedValue({ projects: [] });
  api.fetchPipelines.mockResolvedValue({ pipelines: [], invalid: [], orphanActivations: [] });
  api.fetchPipelineApprovals.mockResolvedValue({ approvals: [] });
  api.fetchPipelineRuns.mockResolvedValue({ runs: [] });
});

describe('activatePipelineTo / deactivatePipelineById', () => {
  it('activate refetches the selected detail and refreshes the chat lock', async () => {
    const useStore = buildStore();
    useStore.setState({ pipelines: [ENTRY()], selectedPipelineId: 'p1' });
    api.activatePipeline.mockResolvedValue({ id: 'p1', activation: ACTIVATION, nextFireAt: '2026-08-24T00:00:00.000Z' });
    api.fetchPipeline.mockResolvedValue({
      id: 'p1',
      def: { version: 2, name: 'Digest', on: { schedule: { cron: '0 9 * * 1' } }, steps: [] },
      scope: 'user',
      readonly: false,
      enabled: true,
      activations: [ACTIVATION_VIEW],
    });
    api.fetchActivePipeline.mockResolvedValue({
      active: { pipelineId: 'p1', pipelineName: 'Digest', state: 'waiting', nextFireAt: '2026-08-24T00:00:00.000Z' },
    });
    // The trailing background list refresh must serve the new activation too.
    api.fetchPipelines.mockResolvedValue({
      pipelines: [ENTRY({ activations: [ACTIVATION_VIEW] })],
      invalid: [],
      orphanActivations: [],
    });

    const ok = await useStore.getState().activatePipelineTo('p1', 'proj-a');

    expect(ok).toBe(true);
    expect(api.activatePipeline).toHaveBeenCalledWith('p1', 'proj-a');
    await vi.waitFor(() => {
      expect(useStore.getState().pipelines[0]?.activations).toEqual([ACTIVATION_VIEW]);
      expect(useStore.getState().activePipelineByProject['proj-a']?.pipelineId).toBe('p1');
    });
  });

  it('activate failure surfaces pipelineActivationError and returns false', async () => {
    const useStore = buildStore();
    useStore.setState({ pipelines: [ENTRY()] });
    api.activatePipeline.mockRejectedValue(new Error('project-has-live-job'));

    const ok = await useStore.getState().activatePipelineTo('p1', 'proj-a');

    expect(ok).toBe(false);
    expect(useStore.getState().pipelineActivationError).toMatch(/project-has-live-job/);
  });

  it('deactivate removes only the own row for THAT project and clears the lock', async () => {
    const other = { ...ACTIVATION_VIEW, projectId: 'proj-b', activatedBy: 'peer@x.io', mine: false };
    const useStore = buildStore();
    useStore.setState({
      pipelines: [ENTRY({ activations: [ACTIVATION_VIEW, other] })],
      activePipelineByProject: { 'proj-a': { pipelineId: 'p1', pipelineName: 'Digest', state: 'waiting' } },
    });
    api.deactivatePipeline.mockResolvedValue({ success: true });

    const ok = await useStore.getState().deactivatePipelineById('p1', 'proj-a');

    expect(ok).toBe(true);
    expect(api.deactivatePipeline).toHaveBeenCalledWith('p1', 'proj-a');
    const s = useStore.getState();
    expect(s.pipelines[0].activations).toEqual([other]);
    expect(s.activePipelineByProject['proj-a']).toBeNull();
  });
});

describe('applyPipelineEvent — activation / availability folds', () => {
  it('activationChanged (set) prepends an own row and binds the project lock as waiting', () => {
    const useStore = buildStore();
    useStore.setState({ pipelines: [ENTRY()] });

    useStore.getState().applyPipelineEvent({
      cause: 'activationChanged',
      pipelineId: 'p1',
      projectId: 'proj-a',
      activation: ACTIVATION,
      activatedBy: 'me@x.io',
      nextFireAt: '2026-08-24T00:00:00.000Z',
    } as any);

    const s = useStore.getState();
    expect(s.pipelines[0].activations).toHaveLength(1);
    expect(s.pipelines[0].activations[0]).toMatchObject({ projectId: 'proj-a', mine: true, state: 'waiting' });
    expect(s.activePipelineByProject['proj-a']).toMatchObject({ pipelineId: 'p1', state: 'waiting' });
  });

  it('activationChanged (null) drops the own row and clears the lock — members’ rows survive', () => {
    const other = { ...ACTIVATION_VIEW, projectId: 'proj-b', activatedBy: 'peer@x.io', mine: false };
    const useStore = buildStore();
    useStore.setState({
      pipelines: [ENTRY({ activations: [ACTIVATION_VIEW, other] })],
      activePipelineByProject: { 'proj-a': { pipelineId: 'p1', pipelineName: 'Digest', state: 'waiting' } },
    });

    useStore.getState().applyPipelineEvent({
      cause: 'activationChanged',
      pipelineId: 'p1',
      projectId: 'proj-a',
      activation: null,
    } as any);

    const s = useStore.getState();
    expect(s.pipelines[0].activations).toEqual([other]);
    expect(s.activePipelineByProject['proj-a']).toBeNull();
  });

  it('availabilityChanged flips the entry enabled flag', () => {
    const useStore = buildStore();
    useStore.setState({ pipelines: [ENTRY({ enabled: true })] });

    useStore.getState().applyPipelineEvent({ cause: 'availabilityChanged', pipelineId: 'p1', enabled: false } as any);

    expect(useStore.getState().pipelines[0].enabled).toBe(false);
  });

  it('runUpdate flips the bound project waiting → running → waiting on terminal', () => {
    const useStore = buildStore();
    useStore.setState({
      pipelines: [ENTRY({ activations: [ACTIVATION_VIEW] })],
      activePipelineByProject: { 'proj-a': { pipelineId: 'p1', pipelineName: 'Digest', state: 'waiting' } },
    });
    const run = (status: string) => ({
      cause: 'runUpdate',
      pipelineId: 'p1',
      projectId: 'proj-a',
      run: { runId: 'r1', pipelineId: 'p1', projectId: 'proj-a', firedBy: 'cron', fireEpoch: 0, status, steps: [], startedAt: 'now' },
    });

    useStore.getState().applyPipelineEvent(run('running') as any);
    let s = useStore.getState();
    expect(s.activePipelineByProject['proj-a']).toMatchObject({ state: 'running', currentRunId: 'r1' });
    expect(s.pipelines[0].activations[0]).toMatchObject({ state: 'running', currentRunId: 'r1' });

    useStore.getState().applyPipelineEvent(run('completed') as any);
    s = useStore.getState();
    expect(s.activePipelineByProject['proj-a']?.state).toBe('waiting');
    expect(s.activePipelineByProject['proj-a']?.currentRunId).toBeUndefined();
    expect(s.pipelines[0].activations[0]).toMatchObject({ state: 'waiting' });
  });
});

describe('selectors — the chat lock derivation', () => {
  it('resolves only the selected project, defensively on partial stores', () => {
    const state: any = {
      selectedProject: 'proj-a',
      activePipelineByProject: { 'proj-a': { pipelineId: 'p1', pipelineName: 'Digest', state: 'waiting' } },
    };
    expect(selectActivePipelineForSelectedProject(state)?.pipelineId).toBe('p1');
    expect(selectActivationByProject(state, 'other')).toBeNull();
    expect(selectActivationByProject({ selectedProject: null } as any, null)).toBeNull();
    expect(selectActivePipelineForSelectedProject({ selectedProject: 'x' } as any)).toBeNull();
  });
});

describe('approver rosters + role-aware inbox rows (doc 48 in-app approver)', () => {
  const GATE_ROW = (over: Record<string, unknown> = {}) => ({
    gateId: 'gate-r1-g1',
    cardId: 'pipe-gate-r1-g1',
    runId: 'r1',
    pipelineId: 'p1',
    pipelineName: 'Digest',
    projectId: 'proj-a',
    stepId: 'g1',
    prompt: 'Approve?',
    armedAt: '2026-09-06T00:00:00.000Z',
    ...over,
  });

  it('activate forwards a non-empty roster and keeps the 2-arg call shape without one', async () => {
    const useStore = buildStore();
    useStore.setState({ pipelines: [ENTRY()] });
    api.activatePipeline.mockResolvedValue({ id: 'p1', activation: ACTIVATION });
    api.fetchActivePipeline.mockResolvedValue({ active: null });
    await useStore.getState().activatePipelineTo('p1', 'proj-a', { g1: ['bob@x.io'] });
    expect(api.activatePipeline).toHaveBeenCalledWith('p1', 'proj-a', { g1: ['bob@x.io'] });
    await useStore.getState().activatePipelineTo('p1', 'proj-a', {});
    expect(api.activatePipeline).toHaveBeenLastCalledWith('p1', 'proj-a');
  });

  it('updateActivationApproversTo patches ONLY the own row of that project', async () => {
    const other = { ...ACTIVATION_VIEW, projectId: 'proj-b', activatedBy: 'peer@x.io', mine: false };
    const useStore = buildStore();
    useStore.setState({ pipelines: [ENTRY({ activations: [ACTIVATION_VIEW, other] })] });
    api.updateActivationApprovers.mockResolvedValue({ projectId: 'proj-a', approvers: { g1: ['bob@x.io'] } });
    const ok = await useStore.getState().updateActivationApproversTo('p1', 'proj-a', { g1: ['bob@x.io'] });
    expect(ok).toBe(true);
    const [mineRow, otherRow] = useStore.getState().pipelines[0].activations;
    expect(mineRow.approvers).toEqual({ g1: ['bob@x.io'] });
    expect(otherRow.approvers).toBeUndefined();
  });

  it('resolve success folds the row and passes the note through; a plain failure keeps the row', async () => {
    const useStore = buildStore();
    useStore.setState({ pipelineApprovals: [GATE_ROW()] });
    api.resolvePipelineApproval.mockResolvedValue({ success: true });
    await useStore.getState().resolvePipelineApprovalById('gate-r1-g1', 'reject', 'not this month');
    expect(api.resolvePipelineApproval).toHaveBeenCalledWith('gate-r1-g1', 'reject', 'not this month');
    expect(useStore.getState().pipelineApprovals).toEqual([]);

    useStore.setState({ pipelineApprovals: [GATE_ROW()] });
    api.resolvePipelineApproval.mockRejectedValue(new Error('network'));
    await expect(useStore.getState().resolvePipelineApprovalById('gate-r1-g1', 'approve')).rejects.toThrow('network');
    expect(useStore.getState().pipelineApprovals).toHaveLength(1);
  });

  it('409 (raced — S7) and 404 (authority revoked — S6) fold the dead row AND rethrow for the surface message', async () => {
    const { ApiError } = await import('../../src/infrastructure/http/api/client');
    for (const status of [409, 404]) {
      const useStore = buildStore();
      useStore.setState({ pipelineApprovals: [GATE_ROW()] });
      api.resolvePipelineApproval.mockRejectedValue(new ApiError('gate already resolved', status, { decidedBy: 'carol' }));
      await expect(useStore.getState().resolvePipelineApprovalById('gate-r1-g1', 'approve')).rejects.toMatchObject({ status });
      expect(useStore.getState().pipelineApprovals).toEqual([]);
    }
  });

  it('approvalRequested folds role-stamped approver rows idempotently (reminder re-fires dedupe on gateId)', () => {
    const useStore = buildStore();
    const row = GATE_ROW({ role: 'approver', ownerUserId: 'alice' });
    useStore.getState().applyPipelineEvent({ cause: 'approvalRequested', projectId: 'proj-a', approval: row } as any);
    useStore.getState().applyPipelineEvent({ cause: 'approvalRequested', projectId: 'proj-a', approval: row } as any);
    expect(useStore.getState().pipelineApprovals).toEqual([row]);
    // approvalResolved folds it for every audience member, decider or not.
    useStore.getState().applyPipelineEvent({
      cause: 'approvalResolved',
      projectId: 'proj-a',
      pipelineId: 'p1',
      runId: 'r1',
      gateId: 'gate-r1-g1',
      decision: 'approved',
      decidedBy: 'carol',
    } as any);
    expect(useStore.getState().pipelineApprovals).toEqual([]);
  });

  it('openApproverPanel loads the run context; close clears it', async () => {
    const useStore = buildStore();
    const run = { runId: 'r1', pipelineId: 'p1', projectId: 'proj-a', firedBy: 'cron', fireEpoch: 1, status: 'awaiting_human', startedAt: 'now', steps: [] };
    api.fetchPipelineRun.mockResolvedValue({ run });
    useStore.getState().openApproverPanel(GATE_ROW({ role: 'approver', ownerUserId: 'alice' }) as any);
    expect(useStore.getState().approverPanel?.gateId).toBe('gate-r1-g1');
    await vi.waitFor(() => expect(useStore.getState().approverPanelRun).toEqual(run));
    useStore.getState().closeApproverPanel();
    expect(useStore.getState().approverPanel).toBeNull();
    expect(useStore.getState().approverPanelRun).toBeNull();
  });
});
