import { describe, it, expect, vi } from 'vitest';
import { parseTriageResponse } from '../src/agents/common/graph/nodes/triage/parser';
import { AgentRegistry } from '../src/agents/common/graph/nodes/triage/AgentRegistry';
import { WorkspaceState } from '../src/agents/common/graph/nodes/triage/types';

function wrap(json: Record<string, unknown>): string {
  return `<triage>${JSON.stringify(json)}</triage>`;
}

/** Minimal WorkspaceState factory */
function makeWorkspaceState(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    hasPrd: false,
    hasDirective: true,
    hasAssets: false,
    hasFigmaConfig: false,
    hasSystemDesignDoc: false,
    hasUiDocs: false,
    hasSpecDocs: false,
    hasCodebase: false,
    hasDesignDoc: false,
    hasEvals: false,
    ...overrides,
  };
}

describe('parseTriageResponse', () => {
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Format validation
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  describe('format validation', () => {
    it('returns null when no <triage> block exists', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(parseTriageResponse('no triage block here')).toBeNull();
      spy.mockRestore();
    });

    it('returns null for malformed JSON inside <triage>', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(parseTriageResponse('<triage>{bad json</triage>')).toBeNull();
      spy.mockRestore();
    });

    it('returns null when intent field is missing', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(parseTriageResponse(wrap({ workStatus: 'proceed' }))).toBeNull();
      spy.mockRestore();
    });

    // SSOT consolidation guard — `<triage>` body inherits prose-tolerance from
    // the shared LLM response parser. Pre-SSOT, trailing analytical prose
    // inside the tag would surface as a SyntaxError caught by the silent
    // `null` branch — the exact silent-failure surface §3.4 of the SSOT
    // handoff calls out.
    it('tolerates trailing prose inside <triage> (regression: prose-leak class)', () => {
      const input = [
        '<triage>',
        '{"intent":"work","workStatus":"proceed"}',
        '',
        '**Reasoning**: user requested code work, no redirect needed.',
        '</triage>',
      ].join('\n');
      const result = parseTriageResponse(input, 'code', 'architect');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('work');
      expect(result!.workStatus).toBe('proceed');
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Ask intent
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  describe('ask intent', () => {
    it('parses ask + inScope correctly', () => {
      const result = parseTriageResponse(wrap({
        intent: 'ask',
        inScope: true,
        askResponse: 'Here is the answer',
      }));
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('ask');
      expect(result!.inScope).toBe(true);
      expect(result!.askResponse).toBe('Here is the answer');
    });

    it('parses ask + out-of-scope correctly', () => {
      const result = parseTriageResponse(wrap({
        intent: 'ask',
        inScope: false,
        askResponse: 'This is out of scope',
      }));
      expect(result!.intent).toBe('ask');
      expect(result!.inScope).toBe(false);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Work - proceed
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  describe('work - proceed', () => {
    it('returns proceed for normal work request', () => {
      const result = parseTriageResponse(wrap({
        intent: 'work',
        workStatus: 'proceed',
      }), 'code', 'architect');
      expect(result!.intent).toBe('work');
      expect(result!.workStatus).toBe('proceed');
      expect(result!.needsChoice).toBeUndefined();
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Work - explicit redirect
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  describe('work - explicit redirect', () => {
    it('returns redirect with choice for code→design (defaults to spec label)', () => {
      // No workspaceState → falls back to spec mode
      const result = parseTriageResponse(wrap({
        intent: 'work',
        workStatus: 'redirect',
        suggestedJob: 'design',
        suggestedAgent: 'architect',
        redirectReason: 'Design artifact requested',
      }), 'code', 'architect');
      expect(result!.workStatus).toBe('redirect');
      expect(result!.suggestedJob).toBe('design');
      expect(result!.needsChoice).toBe(true);
      expect(result!.choiceOptions).toBeDefined();
      // no workspaceState → spec fallback
      expect(result!.choiceOptions!.positive.label).toBe('스펙 설계부터 시작');
    });

    it('returns redirect with normal labels for design→code', () => {
      const result = parseTriageResponse(wrap({
        intent: 'work',
        workStatus: 'redirect',
        suggestedJob: 'code',
        redirectReason: 'Code implementation requested',
      }), 'design', 'architect');
      expect(result!.workStatus).toBe('redirect');
      expect(result!.choiceOptions!.positive.label).toBe('전환');
    });

    it('returns redirect for plan→design (explicit)', () => {
      const result = parseTriageResponse(wrap({
        intent: 'work',
        workStatus: 'redirect',
        suggestedJob: 'design',
        suggestedAgent: 'architect',
        redirectReason: 'Design artifact explicitly requested',
      }), 'plan', 'planner');
      expect(result!.workStatus).toBe('redirect');
      expect(result!.suggestedJob).toBe('design');
      expect(result!.needsChoice).toBe(true);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Design mode-specific redirect labels
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  describe('design mode-specific redirect labels', () => {
    const designRedirectJson = {
      intent: 'work',
      workStatus: 'redirect',
      suggestedJob: 'design',
      suggestedAgent: 'architect',
      redirectReason: 'Design needed',
    };

    // AgentRegistry.detectMode returns YAML mode ids (`ui-design | system-design | spec`).
    // parser.ts maps them to intentGroup notation (`design-ui | design-system | design-spec`)
    // before label/displayName lookup. These tests mock the YAML mode id to verify the mapping.
    it('ui-design mode when figma config exists', () => {
      const spy = vi.spyOn(AgentRegistry, 'detectMode').mockReturnValue('ui-design');
      const ws = makeWorkspaceState({ hasFigmaConfig: true });
      const result = parseTriageResponse(wrap(designRedirectJson), 'code', 'architect', ws);
      expect(result!.choiceOptions!.positive.label).toBe('UI 디자인부터 시작');
      expect(result!.choiceOptions!.neutral.label).toBe('바로 진행');
      expect(result!.choiceOptions!.negative.label).toBe('취소');
      expect(result!.displayMessage).toContain('UI 디자인');
      spy.mockRestore();
    });

    it('system-design mode when PRD exists without screens', () => {
      const spy = vi.spyOn(AgentRegistry, 'detectMode').mockReturnValue('system-design');
      const ws = makeWorkspaceState({ hasPrd: true });
      const result = parseTriageResponse(wrap(designRedirectJson), 'code', 'architect', ws);
      expect(result!.choiceOptions!.positive.label).toBe('시스템 설계부터 시작');
      expect(result!.choiceOptions!.neutral.label).toBe('바로 진행');
      expect(result!.displayMessage).toContain('시스템 설계');
      spy.mockRestore();
    });

    it('spec mode when only directive exists', () => {
      const spy = vi.spyOn(AgentRegistry, 'detectMode').mockReturnValue('spec');
      const ws = makeWorkspaceState({ hasDirective: true });
      const result = parseTriageResponse(wrap(designRedirectJson), 'code', 'architect', ws);
      expect(result!.choiceOptions!.positive.label).toBe('스펙 설계부터 시작');
      expect(result!.choiceOptions!.neutral.label).toBe('바로 개발');
      expect(result!.displayMessage).toContain('스펙 설계');
      spy.mockRestore();
    });

    it('falls back to spec when workspaceState is not provided', () => {
      const result = parseTriageResponse(wrap(designRedirectJson), 'code', 'architect');
      expect(result!.choiceOptions!.positive.label).toBe('스펙 설계부터 시작');
      expect(result!.choiceOptions!.neutral.label).toBe('바로 개발');
    });

    it('non-design redirect still uses generic labels', () => {
      const result = parseTriageResponse(wrap({
        intent: 'work',
        workStatus: 'redirect',
        suggestedJob: 'plan',
        suggestedAgent: 'planner',
        redirectReason: 'PRD needed',
      }), 'code', 'architect', makeWorkspaceState());
      expect(result!.choiceOptions!.positive.label).toBe('전환');
      expect(result!.choiceOptions!.neutral.label).toBe('현재 모드로 진행');
      expect(result!.choiceOptions!.negative.label).toBe('Dismiss');
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // M1: redirect-to-same hallucination guard
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  describe('redirect-to-same guard (M1)', () => {
    it('converts redirect to proceed when suggestedJob equals current job', () => {
      const result = parseTriageResponse(wrap({
        intent: 'work',
        workStatus: 'redirect',
        suggestedJob: 'code',
        redirectReason: 'Same job',
      }), 'code', 'architect');
      expect(result!.workStatus).toBe('proceed');
      expect(result!.needsChoice).toBeUndefined();
    });

    it('converts redirect to proceed when suggestedJob is undefined', () => {
      const result = parseTriageResponse(wrap({
        intent: 'work',
        workStatus: 'redirect',
        redirectReason: 'Some reason',
      }), 'code', 'architect');
      expect(result!.workStatus).toBe('proceed');
    });

    it('converts redirect to proceed when both job and agent match current', () => {
      const result = parseTriageResponse(wrap({
        intent: 'work',
        workStatus: 'redirect',
        suggestedJob: 'design',
        suggestedAgent: 'architect',
        redirectReason: 'Same agent',
      }), 'design', 'architect');
      expect(result!.workStatus).toBe('proceed');
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // M3/M4: force-redirect (LLM confusion state)
  // Non-guarded boundaries: force-redirect triggers
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  describe('force-redirect on non-guarded boundary (M3/M4)', () => {
    it('force-redirects when proceed + suggestedJob mismatch + redirectReason', () => {
      const result = parseTriageResponse(wrap({
        intent: 'work',
        workStatus: 'proceed',
        suggestedJob: 'design',
        redirectReason: 'Design artifact update requested',
      }), 'code', 'architect');
      expect(result!.workStatus).toBe('redirect');
      expect(result!.suggestedJob).toBe('design');
      expect(result!.needsChoice).toBe(true);
    });

    it('force-redirects when proceed + suggestedAgent mismatch', () => {
      const result = parseTriageResponse(wrap({
        intent: 'work',
        workStatus: 'proceed',
        suggestedAgent: 'planner',
      }), 'code', 'architect');
      expect(result!.workStatus).toBe('redirect');
      expect(result!.suggestedAgent).toBe('planner');
      expect(result!.needsChoice).toBe(true);
    });

    it('force-redirects when proceed + suggestedJob mismatch even without redirectReason', () => {
      const result = parseTriageResponse(wrap({
        intent: 'work',
        workStatus: 'proceed',
        suggestedJob: 'design',
      }), 'code', 'architect');
      expect(result!.workStatus).toBe('redirect');
      expect(result!.suggestedJob).toBe('design');
      expect(result!.needsChoice).toBe(true);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Symmetrized behavior: force-redirect applies uniformly
  // (guarded boundary removed — all boundaries treated equally)
  // Design↔Plan leak prevention relies on prompt, not parser.
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  describe('symmetrized boundary behavior', () => {
    it('plan outbound: proceed + suggestedJob leak + redirectReason → redirect (uniform)', () => {
      const result = parseTriageResponse(wrap({
        intent: 'work',
        workStatus: 'proceed',
        suggestedJob: 'design',
        suggestedAgent: 'architect',
        redirectReason: 'Architecture design mentioned',
      }), 'plan', 'planner');
      // SYMMETRIZED: force-redirect applies uniformly (no guarded exception)
      expect(result!.workStatus).toBe('redirect');
      expect(result!.suggestedJob).toBe('design');
      expect(result!.needsChoice).toBe(true);
    });

    it('design→plan: proceed + suggestedJob leak + redirectReason → redirect (uniform)', () => {
      const result = parseTriageResponse(wrap({
        intent: 'work',
        workStatus: 'proceed',
        suggestedJob: 'plan',
        suggestedAgent: 'planner',
        redirectReason: 'Requirements refinement mentioned',
      }), 'design', 'architect');
      // SYMMETRIZED: force-redirect applies uniformly
      expect(result!.workStatus).toBe('redirect');
      expect(result!.suggestedJob).toBe('plan');
      expect(result!.needsChoice).toBe(true);
    });

    it('plan outbound: proceed + suggestedJob leak WITHOUT redirectReason → redirect', () => {
      const result = parseTriageResponse(wrap({
        intent: 'work',
        workStatus: 'proceed',
        suggestedJob: 'design',
      }), 'plan', 'planner');
      expect(result!.workStatus).toBe('redirect');
      expect(result!.suggestedJob).toBe('design');
      expect(result!.needsChoice).toBe(true);
    });

    it('design→plan: proceed + suggestedJob leak WITHOUT redirectReason → redirect', () => {
      const result = parseTriageResponse(wrap({
        intent: 'work',
        workStatus: 'proceed',
        suggestedJob: 'plan',
      }), 'design', 'architect');
      expect(result!.workStatus).toBe('redirect');
      expect(result!.suggestedJob).toBe('plan');
      expect(result!.needsChoice).toBe(true);
    });

    it('plan outbound: explicit redirect is honored', () => {
      const result = parseTriageResponse(wrap({
        intent: 'work',
        workStatus: 'redirect',
        suggestedJob: 'code',
        redirectReason: 'User explicitly wants to code',
      }), 'plan', 'planner');
      expect(result!.workStatus).toBe('redirect');
      expect(result!.suggestedJob).toBe('code');
    });

    it('design→plan: explicit redirect is honored', () => {
      const result = parseTriageResponse(wrap({
        intent: 'work',
        workStatus: 'redirect',
        suggestedJob: 'plan',
        suggestedAgent: 'planner',
        redirectReason: 'User explicitly wants PRD',
      }), 'design', 'architect');
      expect(result!.workStatus).toBe('redirect');
      expect(result!.suggestedJob).toBe('plan');
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Work - blocked
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  describe('work - blocked', () => {
    it('blocked + canProceed:true shows choice', () => {
      const result = parseTriageResponse(wrap({
        intent: 'work',
        workStatus: 'blocked',
        canProceed: true,
        blockedMessage: 'Missing recommended prerequisites',
        missingPrerequisites: { required: [], recommended: ['Codebase indexing'] },
      }), 'code', 'architect');
      expect(result!.workStatus).toBe('blocked');
      expect(result!.canProceed).toBe(true);
      expect(result!.needsChoice).toBe(true);
      expect(result!.choiceOptions).toBeDefined();
      expect(result!.choiceOptions!.positive.action).toBe('proceedAnyway');
    });

    it('blocked + canProceed:false + proceedAnywayOption: canProceed stays false but choice still shown', () => {
      const result = parseTriageResponse(wrap({
        intent: 'work',
        workStatus: 'blocked',
        canProceed: false,
        proceedAnywayOption: 'Proceed without codebase',
        blockedMessage: 'Missing prerequisites',
        missingPrerequisites: { required: [], recommended: ['Codebase'] },
      }), 'code', 'architect');
      // ?? only applies to null/undefined; explicit false is preserved
      expect(result!.canProceed).toBe(false);
      // but choice IS shown because proceedAnywayOption is truthy
      expect(result!.needsChoice).toBe(true);
    });

    it('blocked + canProceed omitted + proceedAnywayOption: canProceed inferred as true', () => {
      const result = parseTriageResponse(wrap({
        intent: 'work',
        workStatus: 'blocked',
        proceedAnywayOption: 'Proceed without codebase',
        blockedMessage: 'Missing prerequisites',
        missingPrerequisites: { required: [], recommended: ['Codebase'] },
      }), 'code', 'architect');
      // ?? kicks in: canProceed = undefined ?? true = true
      expect(result!.canProceed).toBe(true);
      expect(result!.needsChoice).toBe(true);
    });

    it('blocked + canProceed:false + no option has no choice', () => {
      const result = parseTriageResponse(wrap({
        intent: 'work',
        workStatus: 'blocked',
        canProceed: false,
        blockedMessage: 'Critical prerequisites missing',
        missingPrerequisites: { required: ['PRD document'], recommended: [] },
      }), 'code', 'architect');
      expect(result!.workStatus).toBe('blocked');
      expect(result!.canProceed).toBe(false);
      expect(result!.needsChoice).toBeUndefined();
    });
  });
});
