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
