/**
 * pipelineSlice activation axis — activate/deactivate round-trips, the SSE
 * activation folds, and the per-project lock selector the chat surface reads.
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
  fetchActivatableProjects: vi.fn().mockResolvedValue({ projects: [] }),
  fetchActivePipeline: vi.fn(),
  fetchPipelines: vi.fn().mockResolvedValue({ pipelines: [], invalid: [] }),
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

const ACTIVATION = { projectId: 'proj-a', activatedAt: '2026-08-20T00:00:00.000Z' };
const ENTRY = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  name: 'Digest',
  activation: null,
  cron: '0 9 * * 1',
  stepCount: 1,
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
  api.fetchPipelines.mockResolvedValue({ pipelines: [], invalid: [] });
  api.fetchPipelineApprovals.mockResolvedValue({ approvals: [] });
});

describe('activatePipelineTo / deactivatePipelineById', () => {
  it('activate folds the activation onto the rail entry and refreshes the chat lock', async () => {
    const useStore = buildStore();
    useStore.setState({ pipelines: [ENTRY()] });
    api.activatePipeline.mockResolvedValue({ id: 'p1', activation: ACTIVATION, nextFireAt: '2026-08-24T00:00:00.000Z' });
    api.fetchActivePipeline.mockResolvedValue({
      active: { pipelineId: 'p1', pipelineName: 'Digest', state: 'waiting', nextFireAt: '2026-08-24T00:00:00.000Z' },
    });

    const ok = await useStore.getState().activatePipelineTo('p1', 'proj-a');

    expect(ok).toBe(true);
    expect(api.activatePipeline).toHaveBeenCalledWith('p1', 'proj-a');
    const s = useStore.getState();
    expect(s.pipelines[0].activation).toEqual(ACTIVATION);
    expect(s.pipelineExecutionProjectId).toBe('proj-a');
    await vi.waitFor(() => {
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

  it('deactivate clears the entry activation AND the per-project lock', async () => {
    const useStore = buildStore();
    useStore.setState({
      pipelines: [ENTRY({ activation: ACTIVATION, nextFireAt: '2026-08-24T00:00:00.000Z' })],
      activePipelineByProject: { 'proj-a': { pipelineId: 'p1', pipelineName: 'Digest', state: 'waiting' } },
    });
    api.deactivatePipeline.mockResolvedValue({ success: true });

    const ok = await useStore.getState().deactivatePipelineById('p1');

    expect(ok).toBe(true);
    const s = useStore.getState();
    expect(s.pipelines[0].activation).toBeNull();
    expect(s.pipelines[0].nextFireAt).toBeUndefined();
    expect(s.activePipelineByProject['proj-a']).toBeNull();
  });
});

describe('applyPipelineEvent — activation folds', () => {
  it('activationChanged (set) binds the entry and the project lock as waiting', () => {
    const useStore = buildStore();
    useStore.setState({ pipelines: [ENTRY()] });

    useStore.getState().applyPipelineEvent({
      cause: 'activationChanged',
      pipelineId: 'p1',
      projectId: 'proj-a',
      activation: ACTIVATION,
      nextFireAt: '2026-08-24T00:00:00.000Z',
    } as any);

    const s = useStore.getState();
    expect(s.pipelines[0].activation).toEqual(ACTIVATION);
    expect(s.activePipelineByProject['proj-a']).toMatchObject({ pipelineId: 'p1', state: 'waiting' });
  });

  it('activationChanged (null) clears both — projectId names the PREVIOUS project', () => {
    const useStore = buildStore();
    useStore.setState({
      pipelines: [ENTRY({ activation: ACTIVATION })],
      activePipelineByProject: { 'proj-a': { pipelineId: 'p1', pipelineName: 'Digest', state: 'waiting' } },
    });

    useStore.getState().applyPipelineEvent({
      cause: 'activationChanged',
      pipelineId: 'p1',
      projectId: 'proj-a',
      activation: null,
    } as any);

    const s = useStore.getState();
    expect(s.pipelines[0].activation).toBeNull();
    expect(s.activePipelineByProject['proj-a']).toBeNull();
  });

  it('runUpdate flips the bound project waiting → running → waiting on terminal', () => {
    const useStore = buildStore();
    useStore.setState({
      pipelines: [ENTRY({ activation: ACTIVATION })],
      activePipelineByProject: { 'proj-a': { pipelineId: 'p1', pipelineName: 'Digest', state: 'waiting' } },
    });
    const run = (status: string) => ({
      cause: 'runUpdate',
      pipelineId: 'p1',
      projectId: 'proj-a',
      run: { runId: 'r1', pipelineId: 'p1', projectId: 'proj-a', firedBy: 'cron', fireEpoch: 0, status, steps: [], startedAt: 'now' },
    });

    useStore.getState().applyPipelineEvent(run('running') as any);
    expect(useStore.getState().activePipelineByProject['proj-a']).toMatchObject({ state: 'running', currentRunId: 'r1' });

    useStore.getState().applyPipelineEvent(run('completed') as any);
    const after = useStore.getState().activePipelineByProject['proj-a'];
    expect(after?.state).toBe('waiting');
    expect(after?.currentRunId).toBeUndefined();
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
