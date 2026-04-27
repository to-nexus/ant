import { describe, it, expect, beforeAll } from 'vitest';
import { buildTriagePrompt } from '../src/agents/common/graph/nodes/triage/index';
import { AgentRegistry } from '../src/agents/common/graph/nodes/triage/AgentRegistry';
import type { WorkspaceState } from '../src/agents/common/graph/nodes/triage/types';

function makeWs(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    hasPrd: false,
    hasDirective: true,
    hasAssets: false,
    hasFigmaConfig: false,
    hasSystemDesignDoc: false,
    hasUiDocs: false,
    hasEvals: false,
    hasSpecDocs: false,
    hasDesignDoc: false,
    hasCodebase: false,
    ...overrides,
  };
}

describe('buildTriagePrompt', () => {
  beforeAll(async () => {
    await AgentRegistry.initialize();
  });

  it('returns system and user messages separately', () => {
    const { system, user } = buildTriagePrompt({
      userInput: 'Build an API',
      currentJob: 'code',
      currentAgent: 'architect',
      workspaceState: makeWs(),
      jobCapabilities: AgentRegistry.generatePromptContext(),
    });

    // system = rules.md content (classification protocol)
    expect(system).toContain('# TRIAGE RULES');
    expect(system).toContain('## CLASSIFICATION PROTOCOL');
    expect(system).toContain('## CRITICAL REMINDERS');

    // user = base.md rendered (data to analyze)
    expect(user).toContain('# TRIAGE');
    expect(user).toContain('## USER INPUT');
    expect(user).toContain('## WORKSPACE STATE');
    expect(user).toContain('## AVAILABLE JOBS');
    expect(user).toContain('## RESPONSE FORMAT');

    // AGENT CAPABILITIES section removed — agent info now in job headers
    expect(user).not.toContain('## AGENT CAPABILITIES');
    expect(user).toContain('(agent: architect)');
    expect(user).toContain('(agent: planner)');
  });

  it('injects user input and session info correctly', () => {
    const { user } = buildTriagePrompt({
      userInput: 'Create a system design',
      currentJob: 'design',
      currentAgent: 'architect',
      workspaceState: makeWs({ hasPrd: true, prdPath: '/path/to/prd.md' }),
      jobCapabilities: AgentRegistry.generatePromptContext(),
    });

    expect(user).toContain('Create a system design');
    expect(user).toContain('design');
    expect(user).toContain('architect');
    expect(user).toContain('PRD');
  });

  it('snapshot: full prompt structure for code job', () => {
    const result = buildTriagePrompt({
      userInput: 'Build an API',
      currentJob: 'code',
      currentAgent: 'architect',
      workspaceState: makeWs(),
      jobCapabilities: AgentRegistry.generatePromptContext(),
    });

    expect(result).toMatchSnapshot();
  });

  describe('Step 6.2 RAC-aware multi-boundary signal', () => {
    it('renders pinned-absent line when actionMetadata is missing', () => {
      const { user } = buildTriagePrompt({
        userInput: 'Fix the rotate-device overlay and resolve the iframe runtime error',
        currentJob: 'code',
        currentAgent: 'architect',
        workspaceState: makeWs({ hasSystemDesignDoc: true, hasDesignDoc: true }),
        jobCapabilities: AgentRegistry.generatePromptContext(),
      });

      expect(user).toContain('## USER-PINNED REFERENCES');
      expect(user).toContain('User has not pinned any reference document for this turn');
      expect(user).not.toMatch(/User explicitly pinned \d+ reference document/);
    });

    it('renders pinned-absent line when actionMetadata exists but refs/context are empty', () => {
      const { user } = buildTriagePrompt({
        userInput: 'Refactor the auth module',
        currentJob: 'code',
        currentAgent: 'architect',
        workspaceState: makeWs(),
        jobCapabilities: AgentRegistry.generatePromptContext(),
        actionMetadata: { explicit: false, refs: [], context: [] },
      });

      expect(user).toContain('User has not pinned any reference document for this turn');
    });

    it('renders pinned-present line and count when refs are populated', () => {
      const { user } = buildTriagePrompt({
        userInput: 'Refactor the auth module',
        currentJob: 'code',
        currentAgent: 'architect',
        workspaceState: makeWs(),
        jobCapabilities: AgentRegistry.generatePromptContext(),
        actionMetadata: {
          explicit: false,
          refs: ['outputs/design/spec/spec-auth.md'],
          context: ['outputs/design/system/be-system-auth.md'],
        },
      });

      expect(user).toContain('User explicitly pinned 2 reference document(s)');
    });

    it('counts refs and context together', () => {
      const { user } = buildTriagePrompt({
        userInput: 'Hook up the new flow end-to-end',
        currentJob: 'code',
        currentAgent: 'architect',
        workspaceState: makeWs(),
        jobCapabilities: AgentRegistry.generatePromptContext(),
        actionMetadata: {
          explicit: false,
          refs: ['a.md', 'b.md', 'c.md'],
          context: ['d.md', 'e.md'],
        },
      });

      expect(user).toContain('User explicitly pinned 5 reference document(s)');
    });
  });

  describe('Step 6 Scope Routing rules content', () => {
    it('rules.md exposes Step 6 (Scope Routing) with 6.1/6.2 split', () => {
      const { system } = buildTriagePrompt({
        userInput: 'Build an API',
        currentJob: 'code',
        currentAgent: 'architect',
        workspaceState: makeWs(),
        jobCapabilities: AgentRegistry.generatePromptContext(),
      });

      expect(system).toContain('### Step 6: Scope Routing');
      expect(system).toContain('#### 6.1: Modification Intent Check');
      expect(system).toContain('#### 6.2: Scope Breadth + Source Adequacy');
      expect(system).toContain('| Multi-boundary | Pinned absent | `design`');
      expect(system).toContain('### Step 7: Agent Match');
      expect(system).toContain('### Step 8: Determine Status');
      expect(system).toContain('If Steps 4–6 set `redirect`, Step 8 MUST NOT override it');
    });
  });
});
