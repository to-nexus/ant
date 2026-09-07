/**
 * pipelineSlice unified-dirty axis — the ONE ChangedBar covers three drafts
 * (definition / org editors / per-activation approvers): `selectPipelineDirty`
 * truth table, `savePipelineAll` ordering + first-failure stop, and the
 * resets that keep a stale draft from leaking across selections.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create } from 'zustand';
import { createPipelineSlice, selectPipelineDirty } from '../../src/domain/store/slices/pipelineSlice';

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

const DEF = { version: 2, name: 'Digest', on: { schedule: { cron: '0 9 * * 1' } }, steps: [] };
const activation = (projectId: string, over: Record<string, unknown> = {}) => ({
  pipelineId: 'p1',
  projectId,
  activatedBy: 'me@x.io',
  activatedAt: '2026-08-20T00:00:00.000Z',
  mine: true,
  state: 'waiting' as const,
  ...over,
});
const ENTRY = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  name: 'Digest',
  cron: '0 9 * * 1',
  stepCount: 1,
  scope: 'org' as const,
  readonly: false,
  enabled: false,
  org: { owner: 'me@x.io', canEdit: true, canManageEditors: true, editors: ['a@x.io', 'b@x.io'] },
  activations: [activation('proj-a', { approvers: { g1: ['x@x.io'] } }), activation('proj-b', { mine: false, activatedBy: 'other@x.io' })],
  pendingApprovalCount: 0,
  ...over,
});

function buildStore() {
  return create<any>((set, get, store) => ({
    selectedProject: 'proj-a',
    ...createPipelineSlice(set as any, get as any, store as any),
  }));
}

/** A selected, saved, clean pipeline. */
function seeded() {
  const useStore = buildStore();
  useStore.setState({ pipelines: [ENTRY()], selectedPipelineId: 'p1', pipelineDraft: DEF, pipelineSavedDef: DEF });
  return useStore;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchPipelines.mockResolvedValue({ pipelines: [], invalid: [], orphanActivations: [] });
  api.fetchPipelineApprovals.mockResolvedValue({ approvals: [] });
  api.fetchPipelineRuns.mockResolvedValue({ runs: [] });
  api.fetchActivatableProjects.mockResolvedValue({ projects: [] });
});

describe('selectPipelineDirty', () => {
  it('clean → null', () => {
    expect(selectPipelineDirty(seeded().getState())).toBeNull();
  });

  it('definition-only', () => {
    const useStore = seeded();
    useStore.getState().setPipelineDraft({ ...DEF, name: 'Renamed' });
    expect(selectPipelineDirty(useStore.getState())).toEqual({ definition: true, editors: false, approvers: [], count: 1 });
  });

  it('editors — order-insensitive against the saved list', () => {
    const useStore = seeded();
    useStore.getState().setPipelineEditorsDraft(['b@x.io', 'a@x.io']);
    expect(selectPipelineDirty(useStore.getState())).toBeNull();
    useStore.getState().setPipelineEditorsDraft(['a@x.io']);
    expect(selectPipelineDirty(useStore.getState())?.editors).toBe(true);
  });

  it('approvers — per project, own activations only', () => {
    const useStore = seeded();
    // Same roster, different key/list order → clean.
    useStore.getState().setPipelineApproversDraft('proj-a', { g1: ['x@x.io'] });
    expect(selectPipelineDirty(useStore.getState())).toBeNull();
    // Empty gates are dropped server-side, so they never count.
    useStore.getState().setPipelineApproversDraft('proj-a', { g1: ['x@x.io'], g2: [] });
    expect(selectPipelineDirty(useStore.getState())).toBeNull();
    useStore.getState().setPipelineApproversDraft('proj-a', { g1: ['y@x.io'] });
    expect(selectPipelineDirty(useStore.getState())?.approvers).toEqual(['proj-a']);
    // A `mine:false` row is another member's activation — never dirty here.
    useStore.getState().setPipelineApproversDraft('proj-b', { g1: ['z@x.io'] });
    expect(selectPipelineDirty(useStore.getState())?.approvers).toEqual(['proj-a']);
    // null clears a project's draft.
    useStore.getState().setPipelineApproversDraft('proj-a', null);
    expect(selectPipelineDirty(useStore.getState())).toBeNull();
  });

  it('count sums the three legs', () => {
    const useStore = seeded();
    useStore.getState().setPipelineDraft({ ...DEF, name: 'Renamed' });
    useStore.getState().setPipelineEditorsDraft([]);
    useStore.getState().setPipelineApproversDraft('proj-a', {});
    expect(selectPipelineDirty(useStore.getState())?.count).toBe(3);
  });

  it('editors/approvers drafts on a NEW draft (no entry) never count', () => {
    const useStore = buildStore();
    useStore.getState().newPipelineDraft();
    useStore.getState().setPipelineEditorsDraft(['a@x.io']);
    useStore.getState().setPipelineApproversDraft('proj-a', { g1: ['x@x.io'] });
    expect(selectPipelineDirty(useStore.getState())).toEqual({ definition: true, editors: false, approvers: [], count: 1 });
  });
});

describe('savePipelineAll', () => {
  it('writes definition → editors → approvers and clears every draft', async () => {
    const useStore = seeded();
    useStore.getState().setPipelineDraft({ ...DEF, name: 'Renamed' });
    useStore.getState().setPipelineEditorsDraft(['a@x.io']);
    useStore.getState().setPipelineApproversDraft('proj-a', { g1: ['y@x.io'] });
    api.updatePipeline.mockResolvedValue({});
    api.updatePipelineEditors.mockResolvedValue({ owner: 'me@x.io', canEdit: true, canManageEditors: true, editors: ['a@x.io'] });
    api.updateActivationApprovers.mockResolvedValue({ projectId: 'proj-a', approvers: { g1: ['y@x.io'] } });

    const ok = await useStore.getState().savePipelineAll();

    expect(ok).toBe(true);
    expect(api.updatePipeline).toHaveBeenCalledWith('p1', { ...DEF, name: 'Renamed' });
    expect(api.updatePipelineEditors).toHaveBeenCalledWith('p1', ['a@x.io']);
    expect(api.updateActivationApprovers).toHaveBeenCalledWith('proj-a', { g1: ['y@x.io'] });
    const order = [api.updatePipeline, api.updatePipelineEditors, api.updateActivationApprovers].map((m) => m.mock.invocationCallOrder[0]);
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
    const s = useStore.getState();
    expect(s.pipelineEditorsDraft).toBeNull();
    expect(s.pipelineApproversDraft).toEqual({});
    expect(s.pipelineSavedDef).toEqual({ ...DEF, name: 'Renamed' });
    expect(s.pipelineSaving).toBe(false);
    expect(selectPipelineDirty(s)).toBeNull();
  });

  it('stops at the editors failure — approvers untouched, both drafts survive', async () => {
    const useStore = seeded();
    useStore.getState().setPipelineEditorsDraft(['a@x.io']);
    useStore.getState().setPipelineApproversDraft('proj-a', { g1: ['y@x.io'] });
    api.updatePipelineEditors.mockRejectedValue(new Error('editors-refused'));

    const ok = await useStore.getState().savePipelineAll();

    expect(ok).toBe(false);
    expect(api.updateActivationApprovers).not.toHaveBeenCalled();
    const s = useStore.getState();
    expect(s.pipelineSaveError).toBe('editors-refused');
    expect(s.pipelineEditorsDraft).toEqual(['a@x.io']);
    expect(s.pipelineApproversDraft).toEqual({ 'proj-a': { g1: ['y@x.io'] } });
    expect(s.pipelineSaving).toBe(false);
  });

  it('a refused definition stops before editors', async () => {
    const useStore = seeded();
    useStore.getState().setPipelineDraft({ ...DEF, name: 'Renamed' });
    useStore.getState().setPipelineEditorsDraft(['a@x.io']);
    api.updatePipeline.mockRejectedValue(new Error('pipeline-enabled'));

    expect(await useStore.getState().savePipelineAll()).toBe(false);
    expect(api.updatePipelineEditors).not.toHaveBeenCalled();
    expect(useStore.getState().pipelineSaveError).toBe('pipeline-enabled');
    expect(useStore.getState().pipelineEditorsDraft).toEqual(['a@x.io']);
  });

  it('an approvers failure mirrors the activation error into pipelineSaveError and keeps that draft', async () => {
    const useStore = seeded();
    useStore.getState().setPipelineApproversDraft('proj-a', { g1: ['y@x.io'] });
    api.updateActivationApprovers.mockRejectedValue(new Error('not-activator'));

    expect(await useStore.getState().savePipelineAll()).toBe(false);
    expect(useStore.getState().pipelineSaveError).toBe('not-activator');
    expect(useStore.getState().pipelineApproversDraft).toEqual({ 'proj-a': { g1: ['y@x.io'] } });
  });

  it('nothing dirty is a no-op success', async () => {
    const useStore = seeded();
    expect(await useStore.getState().savePipelineAll()).toBe(true);
    expect(api.updatePipeline).not.toHaveBeenCalled();
    expect(api.updatePipelineEditors).not.toHaveBeenCalled();
  });
});

describe('draft resets', () => {
  const dirtyAll = (useStore: ReturnType<typeof seeded>) => {
    useStore.getState().setPipelineDraft({ ...DEF, name: 'Renamed' });
    useStore.getState().setPipelineEditorsDraft(['a@x.io']);
    useStore.getState().setPipelineApproversDraft('proj-a', { g1: ['y@x.io'] });
    expect(selectPipelineDirty(useStore.getState())?.count).toBe(3);
  };

  it('discardPipelineAll restores the definition and clears both drafts', () => {
    const useStore = seeded();
    dirtyAll(useStore);
    useStore.getState().discardPipelineAll();
    const s = useStore.getState();
    expect(s.pipelineDraft).toEqual(DEF);
    expect(s.pipelineEditorsDraft).toBeNull();
    expect(s.pipelineApproversDraft).toEqual({});
    expect(selectPipelineDirty(s)).toBeNull();
  });

  it('selectPipeline resets the editors/approvers drafts', async () => {
    const useStore = seeded();
    dirtyAll(useStore);
    api.fetchPipeline.mockResolvedValue({ id: 'p2', def: DEF, scope: 'user', readonly: false, enabled: false, activations: [] });
    await useStore.getState().selectPipeline('p2');
    expect(useStore.getState().pipelineEditorsDraft).toBeNull();
    expect(useStore.getState().pipelineApproversDraft).toEqual({});
  });

  it('newPipelineDraft resets the drafts and opens with no node selected', () => {
    const useStore = seeded();
    dirtyAll(useStore);
    useStore.getState().newPipelineDraft();
    const s = useStore.getState();
    expect(s.pipelineEditorsDraft).toBeNull();
    expect(s.pipelineApproversDraft).toEqual({});
    expect(s.selectedPipelineNodeId).toBeNull();
    expect(s.pipelineDraftIsNew).toBe(true);
  });

  it('the wiring edit-mode state machine is gone (editable derives from the BE gate)', () => {
    const s = buildStore().getState();
    expect(s).not.toHaveProperty('pipelineWiringMode');
    expect(s).not.toHaveProperty('setPipelineWiringMode');
  });
});
