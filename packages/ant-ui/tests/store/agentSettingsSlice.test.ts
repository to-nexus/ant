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
  promoteAccountAgent: vi.fn(),
};
vi.mock('@/infrastructure/http/api/accountAgents', () => ({
  fetchAccountAgents: (...a: unknown[]) => apiMock.fetchAccountAgents(...a),
  fetchDefinitionTree: (...a: unknown[]) => apiMock.fetchDefinitionTree(...a),
  fetchDefinitionFile: (...a: unknown[]) => apiMock.fetchDefinitionFile(...a),
  saveDefinitionFile: (...a: unknown[]) => apiMock.saveDefinitionFile(...a),
  promoteAccountAgent: (...a: unknown[]) => apiMock.promoteAccountAgent(...a),
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
  {
    id: 'ops',
    name: 'Ops',
    scope: 'user',
    readonly: false,
    jobs: [
      {
        id: 'weekly',
        name: 'Weekly',
        description: '',
        intents: [{ id: 'review', description: 'review things' }],
      },
    ],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.fetchAccountAgents.mockResolvedValue({
    agents: AGENTS,
    builtinToolPreset: ['read_file', 'write_file'],
    mutatingBuiltinTools: ['run_command'],
  });
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
    expect(s.getState().mutatingBuiltinTools).toEqual(['run_command']);
  });

  it('drops a selection whose agent disappeared', async () => {
    const s = makeStore();
    s.getState().selectAgentSettingsNode('ghost');
    await s.getState().loadAccountAgents();
    expect(s.getState().agentSettingsSelection).toEqual({ agentId: undefined, jobId: undefined, intentId: undefined });
  });

  it('prunes level-by-level: stale jobId and stale intentId drop, valid ancestors survive', async () => {
    const s = makeStore();
    s.getState().selectAgentSettingsNode('ops', 'ghost-job');
    await s.getState().loadAccountAgents();
    expect(s.getState().agentSettingsSelection).toEqual({ agentId: 'ops', jobId: undefined, intentId: undefined });

    s.getState().selectAgentSettingsNode('ops', 'weekly', 'ghost-intent');
    await s.getState().loadAccountAgents();
    expect(s.getState().agentSettingsSelection).toEqual({ agentId: 'ops', jobId: 'weekly', intentId: undefined });

    s.getState().selectAgentSettingsNode('ops', 'weekly', 'review');
    await s.getState().loadAccountAgents();
    expect(s.getState().agentSettingsSelection).toEqual({ agentId: 'ops', jobId: 'weekly', intentId: 'review' });
  });

  // A failure must be distinguishable from "this account has no agents" —
  // swallowing it made a 404 on /api/account/agents render as an empty tree,
  // i.e. as missing builtin agents rather than as a dead endpoint.
  it('records a 404 as endpoint-missing, not as an empty agent list', async () => {
    const s = makeStore();
    apiMock.fetchAccountAgents.mockRejectedValue(
      Object.assign(new Error('HTTP 404'), { status: 404 }),
    );

    await s.getState().loadAccountAgents();

    expect(s.getState().accountAgents).toEqual([]);
    expect(s.getState().accountAgentsError).toEqual({ kind: 'endpoint-missing', message: 'HTTP 404' });
  });

  it('records any other failure as unknown', async () => {
    const s = makeStore();
    apiMock.fetchAccountAgents.mockRejectedValue(
      Object.assign(new Error('HTTP 500'), { status: 500 }),
    );

    await s.getState().loadAccountAgents();

    expect(s.getState().accountAgentsError).toEqual({ kind: 'unknown', message: 'HTTP 500' });
  });

  it('starts with no error and clears a previous one on a later success', async () => {
    const s = makeStore();
    expect(s.getState().accountAgentsError).toBeNull();

    apiMock.fetchAccountAgents.mockRejectedValueOnce(
      Object.assign(new Error('HTTP 404'), { status: 404 }),
    );
    await s.getState().loadAccountAgents();
    expect(s.getState().accountAgentsError).not.toBeNull();

    await s.getState().loadAccountAgents();
    expect(s.getState().accountAgentsError).toBeNull();
    expect(s.getState().accountAgents).toHaveLength(1);
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

  it('intent selection changes the selection without refetching the tree (same agent)', async () => {
    const s = makeStore();
    s.getState().selectAgentSettingsNode('ops');
    await vi.waitFor(() => expect(s.getState().definitionTree).toHaveLength(1));
    apiMock.fetchDefinitionTree.mockClear();
    s.getState().selectAgentSettingsNode('ops', 'weekly', 'review');
    expect(s.getState().agentSettingsSelection).toEqual({ agentId: 'ops', jobId: 'weekly', intentId: 'review' });
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

describe('promoteAgent', () => {
  it('promotes, refetches, and passes when the agent flipped to org scope', async () => {
    apiMock.promoteAccountAgent.mockResolvedValue({ id: 'ops', scope: 'org', owner: 'probe@to.nexus' });
    apiMock.fetchAccountAgents.mockResolvedValue({
      agents: [{ ...AGENTS[0], scope: 'org', readonly: false, org: { owner: 'probe@to.nexus', canEdit: true, canManageEditors: true, editors: [] } }],
      builtinToolPreset: [],
      mutatingBuiltinTools: [],
    });
    const s = makeStore();
    await s.getState().promoteAgent('ops');
    expect(apiMock.promoteAccountAgent).toHaveBeenCalledWith('ops');
    expect(s.getState().accountAgents[0].scope).toBe('org');
  });

  // A promote POST that "succeeds" while the refetched list still says
  // user-scope must throw — silently pretending is how the cloud failure
  // read as "promotion made my agent readonly".
  it('throws when the refetched agent is still user-scope', async () => {
    apiMock.promoteAccountAgent.mockResolvedValue({ id: 'ops', scope: 'org', owner: 'probe@to.nexus' });
    const s = makeStore();
    await expect(s.getState().promoteAgent('ops')).rejects.toThrow(/did not take effect/);
  });

  it('propagates a promote refusal (403 membership) to the caller', async () => {
    apiMock.promoteAccountAgent.mockRejectedValue(new Error('You are not a member of this organization.'));
    const s = makeStore();
    await expect(s.getState().promoteAgent('ops')).rejects.toThrow(/not a member/);
    expect(apiMock.fetchAccountAgents).not.toHaveBeenCalled();
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
