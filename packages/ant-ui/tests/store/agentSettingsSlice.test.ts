/**
 * agentSettingsSlice — account agent list, tree selection, definition file
 * buffer lifecycle, and the composer re-sync seam (universalSlice stays
 * independent; only `syncComposerAgents` bridges after a mutation).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create } from 'zustand';

const apiMock = {
  fetchAccountAgents: vi.fn(),
  fetchDefinitionTree: vi.fn(),
  fetchDefinitionFile: vi.fn(),
  saveDefinitionFile: vi.fn(),
};
vi.mock('@/infrastructure/http/api/accountAgents', () => ({
  fetchAccountAgents: (...a: unknown[]) => apiMock.fetchAccountAgents(...a),
  fetchDefinitionTree: (...a: unknown[]) => apiMock.fetchDefinitionTree(...a),
  fetchDefinitionFile: (...a: unknown[]) => apiMock.fetchDefinitionFile(...a),
  saveDefinitionFile: (...a: unknown[]) => apiMock.saveDefinitionFile(...a),
}));

import { createAgentSettingsSlice, type AgentSettingsSlice } from '../../src/domain/store/slices/agentSettingsSlice';

interface HostState extends AgentSettingsSlice {
  projectType: string;
  selectedProject?: string;
  loadCustomAgents: (projectId: string) => Promise<void>;
}

const loadCustomAgentsMock = vi.fn(async () => {});

function makeStore(seed?: Partial<HostState>) {
  return create<HostState>()((set, get, store) => ({
    ...createAgentSettingsSlice(set as any, get as any, store as any),
    projectType: 'canonical',
    selectedProject: undefined,
    loadCustomAgents: loadCustomAgentsMock,
    ...seed,
  }));
}

const AGENTS = [
  { id: 'ops', name: 'Ops', description: '', scope: 'user', readonly: false, jobs: [] },
];

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.fetchAccountAgents.mockResolvedValue({ agents: AGENTS, builtinToolPreset: ['read_file', 'write_file'] });
  apiMock.fetchDefinitionTree.mockResolvedValue({ tree: [{ name: 'agent.yaml', path: 'agent.yaml', type: 'file' }], scope: 'user', readonly: false });
  apiMock.fetchDefinitionFile.mockResolvedValue({ path: 'agent.yaml', content: 'id: ops\n' });
  apiMock.saveDefinitionFile.mockResolvedValue({ success: true, validation: { valid: true, errors: [] } });
});

describe('loadAccountAgents', () => {
  it('stores the list + builtinToolPreset (form vocabulary from the API, never hardcoded)', async () => {
    const s = makeStore();
    await s.getState().loadAccountAgents();
    expect(s.getState().accountAgents).toHaveLength(1);
    expect(s.getState().builtinToolPreset).toEqual(['read_file', 'write_file']);
  });

  it('drops a selection whose agent disappeared', async () => {
    const s = makeStore();
    s.getState().selectAgentSettingsNode('ghost');
    await s.getState().loadAccountAgents();
    expect(s.getState().agentSettingsSelection).toEqual({ agentId: undefined, jobId: undefined });
  });
});

describe('selection + file buffer', () => {
  it('selecting an agent loads its tree; re-selecting the same node is a no-op', async () => {
    const s = makeStore();
    s.getState().selectAgentSettingsNode('ops');
    await vi.waitFor(() => expect(s.getState().definitionTree).toHaveLength(1));
    apiMock.fetchDefinitionTree.mockClear();
    s.getState().selectAgentSettingsNode('ops');
    expect(apiMock.fetchDefinitionTree).not.toHaveBeenCalled();
  });

  it('open → edit → save round-trips through the single write funnel', async () => {
    const s = makeStore();
    s.getState().selectAgentSettingsNode('ops');
    await s.getState().openDefinitionFileBuffer('ops', 'agent.yaml');
    expect(s.getState().openDefinitionFile).toMatchObject({ path: 'agent.yaml', content: 'id: ops\n' });

    s.getState().setDefinitionFileContent('id: ops\nname: Ops\n');
    expect(s.getState().openDefinitionFile?.savedContent).toBe('id: ops\n');

    const ok = await s.getState().saveOpenDefinitionFile();
    expect(ok).toBe(true);
    expect(apiMock.saveDefinitionFile).toHaveBeenCalledWith('ops', 'agent.yaml', 'id: ops\nname: Ops\n');
    expect(s.getState().openDefinitionFile?.savedContent).toBe('id: ops\nname: Ops\n');
    expect(s.getState().definitionValidation).toEqual({ valid: true, errors: [] });
  });

  it('a refused save (400 gate) rethrows and leaves the buffer dirty', async () => {
    apiMock.saveDefinitionFile.mockRejectedValue(new Error('YAML syntax error'));
    const s = makeStore();
    s.getState().selectAgentSettingsNode('ops');
    await s.getState().openDefinitionFileBuffer('ops', 'agent.yaml');
    s.getState().setDefinitionFileContent('id: [broken');
    await expect(s.getState().saveOpenDefinitionFile()).rejects.toThrow(/YAML syntax/);
    expect(s.getState().openDefinitionFile?.savedContent).toBe('id: ops\n');
  });
});

describe('composer re-sync seam (universalSlice untouched otherwise)', () => {
  it('syncComposerAgents reloads the composer ONLY on a selected universal project', () => {
    const canonical = makeStore({ projectType: 'canonical', selectedProject: 'p' });
    canonical.getState().syncComposerAgents();
    expect(loadCustomAgentsMock).not.toHaveBeenCalled();

    const universal = makeStore({ projectType: 'universal', selectedProject: 'p' });
    universal.getState().syncComposerAgents();
    expect(loadCustomAgentsMock).toHaveBeenCalledWith('p');

    loadCustomAgentsMock.mockClear();
    const noProject = makeStore({ projectType: 'universal', selectedProject: undefined });
    noProject.getState().syncComposerAgents();
    expect(loadCustomAgentsMock).not.toHaveBeenCalled();
  });
});
