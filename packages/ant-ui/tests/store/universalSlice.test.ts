/**
 * universalSlice — projectType mirror + universal identity wiring.
 *
 * A workspace (universal) project has exactly ONE chat riding the constant
 * `UNIVERSAL_FEATURE` feature slot; entering it applies the universal job
 * identity and loads the custom-agent list. Leaving to a canonical project
 * clears the selection and repairs a leaked persisted 'universal' jobType.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create } from 'zustand';
import { UNIVERSAL_FEATURE } from '@ant/shared';

const fetchCustomAgentsMock = vi.fn();
vi.mock('@/infrastructure/http/api/customAgents', () => ({
  fetchCustomAgents: (...args: unknown[]) => fetchCustomAgentsMock(...args),
}));

import { createUniversalSlice, type UniversalSlice } from '../../src/domain/store/slices/universalSlice';

interface HostState extends UniversalSlice {
  selectedProject?: string;
  selectedFeature?: string;
  selectedJobType?: string;
  selectedAgent?: string;
  applyJobIdentity: (p: { jobType: string; agent?: string }) => void;
  setSelectedFeature: (f: string) => void;
}

function makeStore(seed?: Partial<HostState>) {
  return create<HostState>()((set, get, store) => ({
    ...createUniversalSlice(set as any, get as any, store as any),
    selectedProject: 'proj-1',
    selectedFeature: undefined,
    selectedJobType: 'plan',
    selectedAgent: 'planner',
    applyJobIdentity: ({ jobType, agent }) => set({ selectedJobType: jobType, selectedAgent: agent ?? jobType } as any),
    setSelectedFeature: (f) => set({ selectedFeature: f } as any),
    ...seed,
  }));
}

const AGENTS = [
  { id: 'empty-agent', name: 'Empty', description: '', scope: 'user', readonly: false, jobs: [] },
  {
    id: 'researcher',
    name: 'Researcher',
    description: '',
    scope: 'builtin',
    readonly: true,
    jobs: [
      { id: 'brief', name: 'Brief', description: '' },
      { id: 'quick', name: 'Quick', description: '' },
    ],
  },
];

beforeEach(() => {
  fetchCustomAgentsMock.mockReset();
  fetchCustomAgentsMock.mockResolvedValue({ agents: AGENTS });
});

describe('syncProjectTypeFromConfig → universal', () => {
  it('applies the universal identity, sets the constant feature, and loads agents', async () => {
    const s = makeStore();
    s.getState().syncProjectTypeFromConfig({ projectType: 'universal' } as any);
    expect(s.getState().projectType).toBe('universal');
    expect(s.getState().selectedJobType).toBe('universal');
    expect(s.getState().selectedFeature).toBe(UNIVERSAL_FEATURE);
    await vi.waitFor(() => expect(s.getState().customAgents).toHaveLength(2));
    // Auto-select skips the job-less agent: first agent WITH jobs wins.
    expect(s.getState().selectedCustomAgentId).toBe('researcher');
    expect(s.getState().selectedCustomJobId).toBe('brief');
  });

  it('reloads agents on every universal config sync (project switch)', async () => {
    const s = makeStore();
    s.getState().syncProjectTypeFromConfig({ projectType: 'universal' } as any);
    s.getState().syncProjectTypeFromConfig({ projectType: 'universal' } as any);
    await vi.waitFor(() => expect(fetchCustomAgentsMock).toHaveBeenCalledTimes(2));
  });
});

describe('syncProjectTypeFromConfig → canonical', () => {
  it('clears the selection and repairs a leaked universal jobType', () => {
    const s = makeStore({ selectedJobType: 'universal', selectedAgent: 'universal' });
    s.getState().setProjectType('universal');
    s.getState().syncProjectTypeFromConfig({ projectType: 'canonical' } as any);
    expect(s.getState().projectType).toBe('canonical');
    expect(s.getState().customAgents).toEqual([]);
    expect(s.getState().selectedCustomAgentId).toBeUndefined();
    expect(s.getState().selectedJobType).toBe('plan');
  });
});

describe('loadCustomAgents selection repair', () => {
  it('keeps a still-valid selection', async () => {
    const s = makeStore();
    s.getState().selectCustomJob('researcher', 'quick');
    await s.getState().loadCustomAgents('proj-1');
    expect(s.getState().selectedCustomAgentId).toBe('researcher');
    expect(s.getState().selectedCustomJobId).toBe('quick');
  });

  it('repairs a stale selection to the first agent with jobs', async () => {
    const s = makeStore();
    s.getState().selectCustomJob('deleted-agent', 'gone');
    await s.getState().loadCustomAgents('proj-1');
    expect(s.getState().selectedCustomAgentId).toBe('researcher');
    expect(s.getState().selectedCustomJobId).toBe('brief');
  });

  it('clears the selection when no agent has jobs', async () => {
    fetchCustomAgentsMock.mockResolvedValue({ agents: [AGENTS[0]] });
    const s = makeStore();
    s.getState().selectCustomJob('researcher', 'brief');
    await s.getState().loadCustomAgents('proj-1');
    expect(s.getState().selectedCustomAgentId).toBeUndefined();
    expect(s.getState().selectedCustomJobId).toBeUndefined();
  });
});

describe('universalTurnMeta — explicit @intent:/@ctx:/@plan mention accumulation', () => {
  it('accumulates + dedupes intents and context, removes individually', () => {
    const s = makeStore();
    s.getState().addUniversalIntentMention('research');
    s.getState().addUniversalIntentMention('cite');
    s.getState().addUniversalIntentMention('research'); // dedupe
    s.getState().addUniversalContextMention('plan/a.md');
    s.getState().addUniversalContextMention('plan/a.md'); // dedupe
    expect(s.getState().universalTurnMeta).toEqual({ intents: ['research', 'cite'], context: ['plan/a.md'], plan: false });

    s.getState().removeUniversalIntentMention('research');
    s.getState().removeUniversalContextMention('plan/a.md');
    expect(s.getState().universalTurnMeta).toEqual({ intents: ['cite'], context: [], plan: false });
  });

  it('resets on job switch (mentions are job-scoped vocabulary)', () => {
    const s = makeStore();
    s.getState().selectCustomJob('researcher', 'brief');
    s.getState().addUniversalIntentMention('research');
    s.getState().setUniversalPlanMention(true);
    s.getState().selectCustomJob('researcher', 'quick');
    expect(s.getState().universalTurnMeta).toEqual({ intents: [], context: [], plan: false });
  });

  it('resetUniversalTurnMeta clears after send; no-op keeps reference stability', () => {
    const s = makeStore();
    s.getState().addUniversalIntentMention('research');
    s.getState().resetUniversalTurnMeta();
    expect(s.getState().universalTurnMeta).toEqual({ intents: [], context: [], plan: false });
    const ref = s.getState().universalTurnMeta;
    s.getState().resetUniversalTurnMeta();
    expect(s.getState().universalTurnMeta).toBe(ref);
  });

  it('@plan is a per-turn boolean: toggles, resets after send, no-op set keeps reference', () => {
    const s = makeStore();
    s.getState().setUniversalPlanMention(true);
    expect(s.getState().universalTurnMeta.plan).toBe(true);
    const ref = s.getState().universalTurnMeta;
    s.getState().setUniversalPlanMention(true); // no-op
    expect(s.getState().universalTurnMeta).toBe(ref);
    s.getState().resetUniversalTurnMeta();
    expect(s.getState().universalTurnMeta.plan).toBe(false);
    s.getState().setUniversalPlanMention(true);
    s.getState().setUniversalPlanMention(false);
    expect(s.getState().universalTurnMeta.plan).toBe(false);
  });

  it('chip survival: selecting the SAME job keeps accumulated mentions', () => {
    const s = makeStore();
    s.getState().selectCustomJob('researcher', 'brief');
    s.getState().addUniversalIntentMention('research');
    s.getState().selectCustomJob('researcher', 'brief'); // no-op selection
    expect(s.getState().universalTurnMeta.intents).toEqual(['research']);
  });
});
