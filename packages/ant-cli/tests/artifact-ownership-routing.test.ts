/**
 * Artifact Ownership Routing Tests
 *
 * Validates routing rules for ask vs explain boundary:
 * - Rubric-referenced requests → ask
 * - Content analysis without rubric → explain (routed to owning job)
 * - Prerequisite guard validates target job input materials
 * - LLM-based evaluation detection via <eval> tag parsing
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { buildTriagePrompt, hasTargetJobPrerequisites } from '../src/agents/common/graph/nodes/triage/index';
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

describe('Artifact Ownership Routing', () => {
  beforeAll(async () => {
    await AgentRegistry.initialize();
  });

  describe('Triage rules.md contains required routing signals', () => {
    it('contains Step 2.5: Explain Intent Detection', () => {
      const { system } = buildTriagePrompt({
        userInput: 'test',
        currentJob: 'design',
        currentAgent: 'architect',
        workspaceState: makeWs(),
        jobCapabilities: AgentRegistry.generatePromptContext(),
      });

      expect(system).toContain('Step 2.5: Explain Intent Detection');
      expect(system).toContain('Explain intent');
      expect(system).toContain('Modification intent');
    });

    it('defines rubric-referenced ask boundary', () => {
      const { system } = buildTriagePrompt({
        userInput: 'test',
        currentJob: 'design',
        currentAgent: 'architect',
        workspaceState: makeWs(),
        jobCapabilities: AgentRegistry.generatePromptContext(),
      });

      expect(system).toContain('rubric reference vs. content analysis');
      expect(system).toContain('rubric/eval criteria');
    });

    it('defines artifact ownership routing via AVAILABLE JOBS outputs', () => {
      const { system } = buildTriagePrompt({
        userInput: 'test',
        currentJob: 'design',
        currentAgent: 'architect',
        workspaceState: makeWs(),
        jobCapabilities: AgentRegistry.generatePromptContext(),
      });

      expect(system).toContain('Determine which job OWNS that artifact');
      expect(system).toContain('AVAILABLE JOBS');
    });

    it('CRITICAL REMINDERS include explain intent routing', () => {
      const { system } = buildTriagePrompt({
        userInput: 'test',
        currentJob: 'design',
        currentAgent: 'architect',
        workspaceState: makeWs(),
        jobCapabilities: AgentRegistry.generatePromptContext(),
      });

      expect(system).toContain('Explain intent routes to the artifact-owning job');
      expect(system).toContain('Rubric-referenced = ASK');
    });

    it('ask scope includes rubric-referenced requests', () => {
      const { system } = buildTriagePrompt({
        userInput: 'test',
        currentJob: 'design',
        currentAgent: 'architect',
        workspaceState: makeWs(),
        jobCapabilities: AgentRegistry.generatePromptContext(),
      });

      expect(system).toContain('Questions referencing rubric or evaluation criteria');
    });
  });

  describe('Prerequisite guard: plan target always passes', () => {
    it('allows redirect to plan even when no PRD exists (generate mode)', () => {
      expect(hasTargetJobPrerequisites('plan', makeWs())).toBe(true);
    });

    it('allows redirect to plan when PRD exists (explain/refine mode)', () => {
      expect(hasTargetJobPrerequisites('plan', makeWs({ hasPrd: true }))).toBe(true);
    });

    it('allows redirect to code when directive provided (modification mode)', () => {
      // makeWs() defaults to hasDirective: true → matches code.yaml modification mode prereq
      expect(hasTargetJobPrerequisites('code', makeWs())).toBe(true);
    });

    it('blocks redirect to code when neither directive nor design exists', () => {
      expect(hasTargetJobPrerequisites('code', makeWs({ hasDirective: false }))).toBe(false);
    });

    it('allows redirect to design when PRD exists', () => {
      expect(hasTargetJobPrerequisites('design', makeWs({ hasPrd: true }))).toBe(true);
    });

    it('allows redirect to design when only directive exists (spec mode regression guard)', () => {
      expect(hasTargetJobPrerequisites('design', makeWs())).toBe(true);
    });
  });

  describe('Prompt injects plan explain mode into job capabilities', () => {
    it('plan job capabilities include explain mode', () => {
      const { user } = buildTriagePrompt({
        userInput: 'PRD에 기술스택이 뭐가 있어?',
        currentJob: 'design',
        currentAgent: 'architect',
        workspaceState: makeWs({ hasPrd: true }),
        jobCapabilities: AgentRegistry.generatePromptContext(),
      });

      expect(user).toContain('explain');
      expect(user).toContain('plan');
    });
  });

  describe('design.yaml redirect signals include PRD analysis', () => {
    it('design job capabilities mention PRD explain redirect', () => {
      const { user } = buildTriagePrompt({
        userInput: 'PRD 분석해줘',
        currentJob: 'design',
        currentAgent: 'architect',
        workspaceState: makeWs({ hasPrd: true }),
        jobCapabilities: AgentRegistry.generatePromptContext(),
      });

      expect(user).toContain('to_plan');
      expect(user).toContain('explain intent targeting PRD');
    });
  });
});

describe('LLM-based evaluation detection (parseEvalTag)', () => {
  let parseEvalTag: (text: string) => { type: string } | null;

  beforeAll(async () => {
    const mod = await import('../src/agents/architect/graph/ask/nodes/agent');
    parseEvalTag = mod.parseEvalTag;
  });

  it('detects <eval type="prd" /> tag', () => {
    const text = '## PRD Evaluation Report\n...\n<eval type="prd" />';
    expect(parseEvalTag(text)).toEqual({ type: 'prd' });
  });

  it('detects <eval type="system-design"/> tag (no space before slash)', () => {
    const text = 'Report content\n<eval type="system-design"/>';
    expect(parseEvalTag(text)).toEqual({ type: 'system-design' });
  });

  it('detects <eval type="ui-design" />', () => {
    const text = 'Summary...\n<eval type="ui-design" />';
    expect(parseEvalTag(text)).toEqual({ type: 'ui-design' });
  });

  it('detects <eval type="code" />', () => {
    const text = 'Code analysis\n<eval type="code" />';
    expect(parseEvalTag(text)).toEqual({ type: 'code' });
  });

  it('detects <eval type="all" />', () => {
    const text = 'Full eval\n<eval type="all" />';
    expect(parseEvalTag(text)).toEqual({ type: 'all' });
  });

  it('returns null when no eval tag present', () => {
    expect(parseEvalTag('Just a normal response without evaluation')).toBeNull();
  });

  it('returns null for invalid eval type', () => {
    expect(parseEvalTag('<eval type="invalid" />')).toBeNull();
  });

  it('is case-insensitive for tag matching', () => {
    const text = '<EVAL TYPE="prd" />';
    expect(parseEvalTag(text)).toEqual({ type: 'prd' });
  });
});
