import { describe, it, expect, beforeAll } from 'vitest';
import { buildTriagePrompt } from '../../src/agents/common/graph/nodes/triage/index';
import { AgentRegistry } from '../../src/agents/common/graph/nodes/triage/AgentRegistry';
import type { WorkspaceState } from '../../src/agents/common/graph/nodes/triage/types';

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

  describe('rules.md structure (post pinnedRefCount removal)', () => {
    it('exposes Step 5 (Implementation Readiness) and renumbered Steps 6/7', () => {
      const { system } = buildTriagePrompt({
        userInput: 'Build an API',
        currentJob: 'code',
        currentAgent: 'architect',
        workspaceState: makeWs(),
        jobCapabilities: AgentRegistry.generatePromptContext(),
      });

      expect(system).toContain('### Step 5: Implementation Readiness');
      expect(system).toContain('### Step 6: Agent Match');
      expect(system).toContain('### Step 7: Determine Status');
      expect(system).toContain('If Steps 4–5 set `redirect`, Step 7 MUST NOT override it');
    });

    it('removes legacy pinnedRefCount / Step 6.2 surface from rules and base prompts', () => {
      const { system, user } = buildTriagePrompt({
        userInput: 'Refactor the auth module',
        currentJob: 'code',
        currentAgent: 'architect',
        workspaceState: makeWs(),
        jobCapabilities: AgentRegistry.generatePromptContext(),
      });

      expect(user).not.toContain('## USER-PINNED REFERENCES');
      expect(user).not.toContain('actionMetadata.refs');
      expect(user).not.toMatch(/User explicitly pinned \d+ reference document/);
      expect(user).not.toContain('Pinned absent');

      expect(system).not.toContain('Scope Routing');
      expect(system).not.toContain('Modification Intent Check');
      expect(system).not.toContain('Scope Breadth + Source Adequacy');
      expect(system).not.toContain('Pinned absent');
      expect(system).not.toContain('Multi-boundary modification requires user-pinned source');
    });
  });
});
