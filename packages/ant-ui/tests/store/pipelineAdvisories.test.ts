/**
 * Save-time advisories reach the author: the server's `catalogWarnings` are
 * kept on the slice (they used to be destructured away), and they are
 * scoped to the selection they were answered for.
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
const ENTRY = { id: 'p1', name: 'Notice', stepCount: 1, scope: 'user', readonly: false, enabled: false, activations: [], pendingApprovalCount: 0 };

function buildStore() {
  return create<any>((set, get, store) => ({ selectedProject: 'proj-a', ...createPipelineSlice(set as any, get as any, store as any) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchPipelines.mockResolvedValue({ pipelines: [ENTRY], invalid: [], orphanActivations: [] });
  api.fetchPipelineApprovals.mockResolvedValue({ approvals: [] });
});

describe('pipelineSaveWarnings — the save response\'s catalogWarnings reach the author', () => {
  it('create keeps the warnings; a clean save clears them', async () => {
    const useStore = buildStore();
    useStore.getState().newPipelineDraft();
    useStore.getState().setPipelineDraft(DEF);
    api.createPipeline.mockResolvedValue({ id: 'p1', entry: ENTRY, catalogWarnings: ['step "lookup" pins its own intent\'s stop artifact'] });
    expect(await useStore.getState().savePipelineDraft()).toBe(true);
    expect(useStore.getState().pipelineSaveWarnings).toEqual(['step "lookup" pins its own intent\'s stop artifact']);

    api.updatePipeline.mockResolvedValue({ id: 'p1', entry: ENTRY });
    useStore.getState().setPipelineDraft({ ...DEF, name: 'Notice v2' });
    expect(await useStore.getState().savePipelineDraft()).toBe(true);
    expect(useStore.getState().pipelineSaveWarnings).toEqual([]);
  });

  it('warnings belong to the selection — selecting another pipeline (or none) resets them', async () => {
    const useStore = buildStore();
    useStore.setState({ selectedPipelineId: 'p1', pipelineDraft: DEF, pipelineSavedDef: DEF, pipelines: [ENTRY] });
    api.updatePipeline.mockResolvedValue({ id: 'p1', entry: ENTRY, catalogWarnings: ['w'] });
    await useStore.getState().savePipelineDraft();
    expect(useStore.getState().pipelineSaveWarnings).toEqual(['w']);

    api.fetchPipeline.mockResolvedValue({ id: 'p2', def: DEF, scope: 'user', readonly: false, enabled: false, activations: [] });
    await useStore.getState().selectPipeline('p2');
    expect(useStore.getState().pipelineSaveWarnings).toEqual([]);

    api.updatePipeline.mockResolvedValue({ id: 'p2', entry: { ...ENTRY, id: 'p2' }, catalogWarnings: ['w2'] });
    await useStore.getState().savePipelineDraft();
    expect(useStore.getState().pipelineSaveWarnings).toEqual(['w2']);
    await useStore.getState().selectPipeline(null);
    expect(useStore.getState().pipelineSaveWarnings).toEqual([]);
  });

  it('a failed save keeps the previous warnings and records the error', async () => {
    const useStore = buildStore();
    useStore.setState({ selectedPipelineId: 'p1', pipelineDraft: DEF, pipelineSavedDef: DEF, pipelines: [ENTRY], pipelineSaveWarnings: ['old'] });
    api.updatePipeline.mockRejectedValue(new Error('invalid-pipeline-def'));
    expect(await useStore.getState().savePipelineDraft()).toBe(false);
    expect(useStore.getState().pipelineSaveError).toBe('invalid-pipeline-def');
    expect(useStore.getState().pipelineSaveWarnings).toEqual(['old']);
  });
});
