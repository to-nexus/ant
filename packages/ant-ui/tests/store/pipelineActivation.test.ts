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
  selectPipelineViewerId,
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
  reassignPipelineGate: vi.fn(),
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
  liveRuns: [] as unknown[],
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

  // The control POSTs carry a client-side bound (`AbortSignal.timeout`): a
  // request that never answers used to lock the execution view with no
  // message. The bound firing is not a refusal — the server may have finished
  // after we stopped waiting — so the rows are re-read, never assumed.
  it('a deactivate that hits the client-side bound reports it and re-reads the rows', async () => {
    const useStore = buildStore();
    useStore.setState({
      pipelines: [ENTRY({ activations: [ACTIVATION_VIEW] })],
      activePipelineByProject: { 'proj-a': { pipelineId: 'p1', pipelineName: 'Digest', state: 'waiting' } },
    });
    api.deactivatePipeline.mockRejectedValue(Object.assign(new Error('signal timed out'), { name: 'TimeoutError' }));
    const resync = vi.fn(async () => {});
    useStore.setState({ resyncActivationViews: resync } as any);

    const ok = await useStore.getState().deactivatePipelineById('p1', 'proj-a');

    expect(ok).toBe(false);
    expect(useStore.getState().pipelineActivationError).toMatch(/did not finish in time/);
    expect(resync).toHaveBeenCalledWith('p1', 'proj-a');
    // Nothing is folded locally on a timeout — the re-read is the authority.
    expect(useStore.getState().pipelines[0].activations).toEqual([ACTIVATION_VIEW]);
    expect(useStore.getState().activePipelineByProject['proj-a']).not.toBeNull();
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

  // The live set is folded, never replaced: N runs stay N until each seals,
  // and BOTH holders (activation row, chat lock signal) pass the same fold.
  it('runUpdate folds the live SET — two runs stay two, awaiting wins, a terminal run leaves, the last terminal clears', () => {
    const useStore = buildStore();
    useStore.setState({
      pipelines: [ENTRY({ activations: [ACTIVATION_VIEW] })],
      activePipelineByProject: { 'proj-a': { pipelineId: 'p1', pipelineName: 'Digest', state: 'waiting', liveRuns: [] } },
    });
    const run = (runId: string, status: string, startedAt: string, steps: unknown[] = []) => ({
      cause: 'runUpdate',
      pipelineId: 'p1',
      projectId: 'proj-a',
      run: { runId, pipelineId: 'p1', projectId: 'proj-a', firedBy: 'manual', fireEpoch: 0, status, steps, startedAt },
    });
    const ids = (s: any) => s.activePipelineByProject['proj-a'].liveRuns.map((r: any) => r.runId);

    useStore.getState().applyPipelineEvent(run('r1', 'running', '2026-09-16T00:00:01.000Z', [{ stepId: 'a', status: 'running' }]) as any);
    useStore.getState().applyPipelineEvent(run('r2', 'running', '2026-09-16T00:00:02.000Z', [{ stepId: 'a', status: 'dispatched' }]) as any);
    let s = useStore.getState();
    expect(ids(s)).toEqual(['r2', 'r1']); // newest first
    expect(s.activePipelineByProject['proj-a']).toMatchObject({ state: 'running' });
    expect(s.pipelines[0].activations[0]).toMatchObject({ state: 'running' });
    expect(s.pipelines[0].activations[0].liveRuns.map((r: any) => r.runId)).toEqual(['r2', 'r1']);
    expect(s.pipelines[0].activations[0].liveRuns[1]).toMatchObject({ currentStepIds: ['a'], firedBy: 'manual' });

    // One run parks on a person — the activation reads awaiting, the other run keeps working.
    useStore.getState().applyPipelineEvent(run('r1', 'awaiting_human', '2026-09-16T00:00:01.000Z', [{ stepId: 'a', status: 'awaiting_gate' }]) as any);
    s = useStore.getState();
    expect(s.activePipelineByProject['proj-a'].state).toBe('awaiting_human');
    expect(ids(s)).toEqual(['r2', 'r1']);

    // The awaiting run seals — the survivor decides the state.
    useStore.getState().applyPipelineEvent(run('r1', 'completed', '2026-09-16T00:00:01.000Z') as any);
    s = useStore.getState();
    expect(ids(s)).toEqual(['r2']);
    expect(s.activePipelineByProject['proj-a'].state).toBe('running');
    expect(s.pipelines[0].activations[0]).toMatchObject({ state: 'running' });

    useStore.getState().applyPipelineEvent(run('r2', 'failed', '2026-09-16T00:00:02.000Z') as any);
    s = useStore.getState();
    expect(ids(s)).toEqual([]);
    expect(s.activePipelineByProject['proj-a'].state).toBe('waiting');
    expect(s.pipelines[0].activations[0]).toMatchObject({ state: 'waiting', liveRuns: [] });
  });

  it('selected run sealing clears the selection so the next live run auto-selects', async () => {
    const useStore = buildStore();
    const key = 'p1:me:proj-a';
    useStore.setState({
      pipelines: [ENTRY({ activations: [ACTIVATION_VIEW] })],
      pipelineRunsByActivation: { [key]: [] },
      pipelineSelectedRunByActivation: { [key]: 'r1', 'p2:me:proj-a': 'other' },
    });
    const run = (runId: string, status: string) => ({
      cause: 'runUpdate',
      pipelineId: 'p1',
      projectId: 'proj-a',
      run: { runId, pipelineId: 'p1', projectId: 'proj-a', firedBy: 'manual', fireEpoch: 0, status, steps: [], startedAt: `2026-09-16T00:00:0${runId.slice(1)}.000Z` },
    });
    // A live frame of the selected run, and a seal of some OTHER run, leave the selection alone.
    useStore.getState().applyPipelineEvent(run('r1', 'running') as any);
    useStore.getState().applyPipelineEvent(run('r9', 'completed') as any);
    expect(useStore.getState().pipelineSelectedRunByActivation[key]).toBe('r1');

    useStore.getState().applyPipelineEvent(run('r1', 'completed') as any);
    expect(useStore.getState().pipelineSelectedRunByActivation).toEqual({ 'p2:me:proj-a': 'other' });

    api.fetchPipelineRuns.mockResolvedValueOnce({ runs: [run('r2', 'running').run, run('r1', 'completed').run] });
    await useStore.getState().loadActivationRuns('p1', 'proj-a');
    expect(useStore.getState().pipelineSelectedRunByActivation[key]).toBe('r2');
  });

  it('a REST snapshot that lands after a fresh-stream seal cannot revive the sealed run as live', async () => {
    const useStore = buildStore();
    const key = 'p1:me:proj-a';
    const live = { runId: 'r1', status: 'running', startedAt: '2026-09-16T00:00:01.000Z', firedBy: 'manual', currentStepIds: ['a'] };
    const staleActive = { pipelineId: 'p1', pipelineName: 'Digest', state: 'running', liveRuns: [live] };
    useStore.setState({
      pipelines: [ENTRY({ activations: [{ ...ACTIVATION_VIEW, state: 'running', liveRuns: [live] }] })],
      activePipelineByProject: { 'proj-a': staleActive },
      pipelineRunsByActivation: { [key]: [{ runId: 'r1', pipelineId: 'p1', projectId: 'proj-a', status: 'running', firedBy: 'manual', fireEpoch: 0, startedAt: live.startedAt }] },
    });
    let releaseActive!: (v: unknown) => void;
    let releaseList!: (v: unknown) => void;
    let releaseRuns!: (v: unknown) => void;
    api.fetchActivePipeline.mockReturnValueOnce(new Promise((r) => { releaseActive = r; }));
    api.fetchPipelines.mockReturnValueOnce(new Promise((r) => { releaseList = r; }));
    api.fetchPipelineRuns.mockReturnValueOnce(new Promise((r) => { releaseRuns = r; }));
    useStore.setState({ pipelinesStatus: 'ready' });
    useStore.getState().resyncPipelineProjections();

    // The stream seals r1 while the refetches are in flight.
    useStore.getState().applyPipelineEvent({
      cause: 'runUpdate',
      pipelineId: 'p1',
      projectId: 'proj-a',
      run: { runId: 'r1', pipelineId: 'p1', projectId: 'proj-a', firedBy: 'manual', fireEpoch: 0, status: 'completed', steps: [], startedAt: live.startedAt, endedAt: '2026-09-16T00:00:05.000Z' },
    } as any);
    expect(useStore.getState().activePipelineByProject['proj-a'].liveRuns).toEqual([]);

    // The pre-seal snapshots land last — every projection keeps the seal.
    releaseActive({ active: staleActive });
    releaseList({ pipelines: [ENTRY({ activations: [{ ...ACTIVATION_VIEW, state: 'running', liveRuns: [live] }] })], invalid: [], orphanActivations: [] });
    releaseRuns({ runs: [{ runId: 'r1', pipelineId: 'p1', projectId: 'proj-a', status: 'running', firedBy: 'manual', fireEpoch: 0, startedAt: live.startedAt }] });
    await new Promise((r) => setTimeout(r, 0));
    const s = useStore.getState();
    expect(s.activePipelineByProject['proj-a']).toMatchObject({ state: 'waiting', liveRuns: [] });
    expect(s.pipelines[0].activations[0]).toMatchObject({ state: 'waiting', liveRuns: [] });
    expect(s.pipelineRunsByActivation[key][0]).toMatchObject({ runId: 'r1', status: 'completed' });
    expect(s.pipelineSelectedRunByActivation[key]).toBeUndefined();

    // A snapshot issued AFTER the seal is authoritative — the server may have re-fired.
    api.fetchActivePipeline.mockResolvedValueOnce({ active: staleActive });
    await useStore.getState().loadActivePipeline('proj-a');
    expect(useStore.getState().activePipelineByProject['proj-a'].liveRuns).toEqual([live]);
  });

  it('a broken activation row stays broken through run folds', () => {
    const useStore = buildStore();
    useStore.setState({ pipelines: [ENTRY({ activations: [{ ...ACTIVATION_VIEW, state: 'broken' }] })], activePipelineByProject: {} });
    useStore.getState().applyPipelineEvent({
      cause: 'runUpdate',
      pipelineId: 'p1',
      projectId: 'proj-a',
      run: { runId: 'r1', pipelineId: 'p1', projectId: 'proj-a', firedBy: 'cron', fireEpoch: 0, status: 'running', steps: [], startedAt: 'now' },
    } as any);
    expect(useStore.getState().pipelines[0].activations[0]).toMatchObject({ state: 'broken', liveRuns: [{ runId: 'r1' }] });
  });
});

describe('selectors — the chat lock derivation', () => {
  it('the roster viewer is the server-side id, never the IdP-cased email', () => {
    expect(selectPipelineViewerId({ userEmail: 'Me@X.io', userId: 'me@x.io' } as any)).toBe('me@x.io');
    expect(selectPipelineViewerId({ userEmail: 'Me@X.io', userId: undefined } as any)).toBeUndefined();
  });

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

describe('gate assignee — inbox rows fold routing, never duplicate (doc 46 §5a-ii)', () => {
  const ROW = {
    gateId: 'gate-r1-g',
    cardId: 'pipe-gate-r1-g',
    runId: 'r1',
    pipelineId: 'p1',
    pipelineName: 'Digest',
    projectId: 'proj-a',
    stepId: 'g',
    prompt: 'ok?',
    armedAt: '2026-09-16T00:00:00.000Z',
    candidates: ['me@x.io', 'bob@x.io'],
  };

  it('approvalRequested UPSERTS a held row — a reassign re-fire updates assignees in place', () => {
    const useStore = buildStore();
    useStore.setState({ pipelineApprovals: [ROW as any] });
    useStore.getState().applyPipelineEvent({ cause: 'approvalRequested', projectId: 'proj-a', approval: { ...ROW, assignees: ['bob@x.io'] } } as any);
    const rows = useStore.getState().pipelineApprovals;
    expect(rows).toHaveLength(1);
    expect(rows[0].assignees).toEqual(['bob@x.io']);
    // A fresh gate still prepends.
    useStore.getState().applyPipelineEvent({ cause: 'approvalRequested', projectId: 'proj-a', approval: { ...ROW, gateId: 'gate-r2-g', runId: 'r2' } } as any);
    expect(useStore.getState().pipelineApprovals.map((r) => r.gateId)).toEqual(['gate-r2-g', 'gate-r1-g']);
  });

  it('reassignPipelineGateTo PUTs and folds the row locally; null clears the hint', async () => {
    const useStore = buildStore();
    useStore.setState({ pipelineApprovals: [{ ...ROW, assignees: ['bob@x.io'] } as any] });
    api.reassignPipelineGate.mockResolvedValueOnce({ success: true, gateId: ROW.gateId, assignees: ['me@x.io'], candidates: ROW.candidates });
    await useStore.getState().reassignPipelineGateTo(ROW as any, 'me@x.io');
    expect(api.reassignPipelineGate).toHaveBeenCalledWith('r1', 'g', 'me@x.io');
    expect(useStore.getState().pipelineApprovals[0].assignees).toEqual(['me@x.io']);
    api.reassignPipelineGate.mockResolvedValueOnce({ success: true, gateId: ROW.gateId, assignees: [], candidates: ROW.candidates });
    await useStore.getState().reassignPipelineGateTo(ROW as any, null);
    expect(useStore.getState().pipelineApprovals[0]).not.toHaveProperty('assignees');
  });
});

// A clarify answer returned 200 while the screen kept the question (2026-09-21
// cloud report). Three FE gaps made "nothing changed" possible after a 200:
// the inbox row was folded only by a best-effort SSE event or its own action,
// a refetch in flight during the answer re-installed the row, and the fate the
// server reported was discarded. The rows below pin the closed shape.
describe('clarify inbox rows — answer fold, runUpdate reconcile, stale refetch', () => {
  const CLARIFY_ROW = (over: Record<string, unknown> = {}) => ({
    kind: 'clarify',
    gateId: 'clr-r1-s1-1',
    cardId: 'clr-r1-s1-1',
    runId: 'r1',
    pipelineId: 'p1',
    pipelineName: 'Digest',
    projectId: 'proj-a',
    stepId: 's1',
    prompt: 'code?',
    armedAt: '2026-09-21T00:00:00.000Z',
    jobId: 'j1',
    ...over,
  });
  const GATE_ROW = (over: Record<string, unknown> = {}) => ({
    gateId: 'gate-r1-g1',
    cardId: 'pipe-gate-r1-g1',
    runId: 'r1',
    pipelineId: 'p1',
    pipelineName: 'Digest',
    projectId: 'proj-a',
    stepId: 'g1',
    prompt: 'Approve?',
    armedAt: '2026-09-21T00:00:00.000Z',
    ...over,
  });
  const RUN = (steps: Array<Record<string, unknown>>, status = 'running') => ({
    runId: 'r1',
    pipelineId: 'p1',
    projectId: 'proj-a',
    firedBy: 'manual',
    fireEpoch: 1,
    status,
    startedAt: '2026-09-21T00:00:00.000Z',
    steps,
  });
  const runUpdate = (useStore: any, run: unknown) =>
    useStore.getState().applyPipelineEvent({ cause: 'runUpdate', pipelineId: 'p1', projectId: 'proj-a', run } as any);

  it('answer success folds the row and returns the fate; 409/404 fold + rethrow; a plain failure keeps the row', async () => {
    const useStore = buildStore();
    useStore.setState({ pipelineApprovals: [CLARIFY_ROW()] });
    api.answerPipelineClarify.mockResolvedValueOnce({ success: true, clarify: 'applied' });
    await expect(useStore.getState().answerPipelineClarifyById('clr-r1-s1-1', 'r1', 's1', 'PROBE')).resolves.toBe('applied');
    expect(api.answerPipelineClarify).toHaveBeenCalledWith('r1', 's1', 'PROBE');
    expect(useStore.getState().pipelineApprovals).toEqual([]);

    const { ApiError } = await import('../../src/infrastructure/http/api/client');
    for (const status of [409, 404]) {
      useStore.setState({ pipelineApprovals: [CLARIFY_ROW()] });
      api.answerPipelineClarify.mockRejectedValueOnce(new ApiError('dead', status));
      await expect(useStore.getState().answerPipelineClarifyById('clr-r1-s1-1', 'r1', 's1', 'x')).rejects.toMatchObject({ status });
      expect(useStore.getState().pipelineApprovals).toEqual([]);
    }

    useStore.setState({ pipelineApprovals: [CLARIFY_ROW()] });
    api.answerPipelineClarify.mockRejectedValueOnce(new ApiError('busy', 503, { code: 'clarify-retry' }));
    await expect(useStore.getState().answerPipelineClarifyById('clr-r1-s1-1', 'r1', 's1', 'x')).rejects.toMatchObject({ status: 503 });
    expect(useStore.getState().pipelineApprovals).toHaveLength(1);
  });

  it('runUpdate on a LIVE run drops the rows whose step left its wait state and keeps every other row', () => {
    const useStore = buildStore();
    const otherRun = CLARIFY_ROW({ gateId: 'clr-r2-s1-1', runId: 'r2' });
    const approverRow = GATE_ROW({ gateId: 'gate-r1-g2', stepId: 'g2', role: 'approver', ownerUserId: 'peer@x.io' });
    useStore.setState({ pipelineApprovals: [CLARIFY_ROW(), GATE_ROW(), otherRun, approverRow] });

    // Both steps still parked: nothing moves.
    runUpdate(useStore, RUN([
      { stepId: 's1', status: 'awaiting_clarify', clarify: { clarifyId: 'clr-r1-s1-1', jobId: 'j1', question: 'code?', round: 1, askedAt: 't' } },
      { stepId: 'g1', status: 'awaiting_gate', gate: { gateId: 'gate-r1-g1', cardId: 'c', prompt: 'Approve?', armedAt: 't' } },
    ], 'awaiting_human'));
    expect(useStore.getState().pipelineApprovals.map((r) => r.gateId)).toEqual(['clr-r1-s1-1', 'gate-r1-g1', 'clr-r2-s1-1', 'gate-r1-g2']);

    // The clarify step re-dispatched (answer applied elsewhere / event lost): its row dies, the gate row stays.
    runUpdate(useStore, RUN([
      { stepId: 's1', status: 'dispatched', clarify: { clarifyId: 'clr-r1-s1-1', jobId: 'j1', question: 'code?', round: 1, askedAt: 't', answeredAt: 't2' } },
      { stepId: 'g1', status: 'awaiting_gate', gate: { gateId: 'gate-r1-g1', cardId: 'c', prompt: 'Approve?', armedAt: 't' } },
    ]));
    expect(useStore.getState().pipelineApprovals.map((r) => r.gateId)).toEqual(['gate-r1-g1', 'clr-r2-s1-1', 'gate-r1-g2']);

    // A round-2 question is a NEW row (different clarifyId): the old one never matches.
    runUpdate(useStore, RUN([
      { stepId: 's1', status: 'awaiting_clarify', clarify: { clarifyId: 'clr-r1-s1-2', jobId: 'j2', question: 'code?', round: 2, askedAt: 't3' } },
      { stepId: 'g1', status: 'awaiting_gate', gate: { gateId: 'gate-r1-g1', cardId: 'c', prompt: 'Approve?', armedAt: 't', decision: 'approved' } },
    ], 'awaiting_human'));
    // The decided gate leaves; the approver row (another owner's run) and r2 are never touched.
    expect(useStore.getState().pipelineApprovals.map((r) => r.gateId)).toEqual(['clr-r2-s1-1', 'gate-r1-g2']);
  });

  it('a stale approvals refetch cannot re-install a row folded after the request began, and still refills the rest', async () => {
    const useStore = buildStore();
    useStore.setState({ pipelineApprovals: [CLARIFY_ROW()] });
    let release!: (v: { approvals: unknown[] }) => void;
    api.fetchPipelineApprovals.mockReturnValueOnce(new Promise((r) => (release = r)));
    const refetch = useStore.getState().loadPipelineApprovals();

    api.answerPipelineClarify.mockResolvedValueOnce({ success: true, clarify: 'applied' });
    await useStore.getState().answerPipelineClarifyById('clr-r1-s1-1', 'r1', 's1', 'PROBE');
    expect(useStore.getState().pipelineApprovals).toEqual([]);

    // The snapshot was taken before the answer: it still carries the dead row, plus a row armed meanwhile.
    const fresh = CLARIFY_ROW({ gateId: 'clr-r3-s1-1', runId: 'r3' });
    release({ approvals: [CLARIFY_ROW(), fresh] });
    await refetch;
    expect(useStore.getState().pipelineApprovals).toEqual([fresh]);

    // A refetch issued AFTER the fold trusts the server again (the tombstone predates it).
    api.fetchPipelineApprovals.mockResolvedValueOnce({ approvals: [CLARIFY_ROW()] });
    await useStore.getState().loadPipelineApprovals();
    expect(useStore.getState().pipelineApprovals).toEqual([CLARIFY_ROW()]);
  });
});
