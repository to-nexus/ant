import { describe, it, expect, beforeAll } from 'vitest';
import { buildTriagePrompt } from '../src/agents/common/graph/nodes/triage/index';
import { AgentRegistry } from '../src/agents/common/graph/nodes/triage/AgentRegistry';
import type { WorkspaceState } from '../src/agents/common/graph/nodes/triage/types';

function makeWs(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    hasPrd: false,
    hasDirective: true,
    hasScreens: false,
    hasComponents: false,
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
});
