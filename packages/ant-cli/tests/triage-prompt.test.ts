import { describe, it, expect, beforeAll } from 'vitest';
import { buildTriagePrompt } from '../src/agents/common/nodes/triage/index';
import { AgentRegistry } from '../src/agents/common/nodes/triage/AgentRegistry';
import type { WorkspaceState } from '../src/agents/common/nodes/triage/types';

function makeWs(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    hasPrd: false,
    hasDirective: true,
    hasScreens: false,
    hasComponents: false,
    hasAssets: false,
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

  it('contains required structural sections', () => {
    const prompt = buildTriagePrompt({
      userInput: 'Build an API',
      currentJob: 'code',
      currentAgent: 'architect',
      workspaceState: makeWs(),
      jobCapabilities: AgentRegistry.generatePromptContext(),
    });

    expect(prompt).toContain('# TRIAGE');
    expect(prompt).toContain('## USER INPUT');
    expect(prompt).toContain('## WORKSPACE STATE');
    expect(prompt).toContain('## AVAILABLE JOBS');
    expect(prompt).toContain('## AGENT CAPABILITIES');
    expect(prompt).toContain('## RESPONSE FORMAT');
    expect(prompt).toContain('# TRIAGE RULES');
    expect(prompt).toContain('## CLASSIFICATION PROTOCOL');
    expect(prompt).toContain('## CRITICAL REMINDERS');
  });

  it('injects user input and session info correctly', () => {
    const prompt = buildTriagePrompt({
      userInput: 'Create a system design',
      currentJob: 'design',
      currentAgent: 'architect',
      workspaceState: makeWs({ hasPrd: true, prdPath: '/path/to/prd.md' }),
      jobCapabilities: AgentRegistry.generatePromptContext(),
    });

    expect(prompt).toContain('Create a system design');
    expect(prompt).toContain('design');
    expect(prompt).toContain('architect');
    expect(prompt).toContain('PRD');
  });

  it('snapshot: full prompt structure for code job', () => {
    const prompt = buildTriagePrompt({
      userInput: 'Build an API',
      currentJob: 'code',
      currentAgent: 'architect',
      workspaceState: makeWs(),
      jobCapabilities: AgentRegistry.generatePromptContext(),
    });

    expect(prompt).toMatchSnapshot();
  });
});
