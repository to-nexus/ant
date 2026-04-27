import { describe, it, expect, beforeAll } from 'vitest';
import { hasTargetJobPrerequisites } from '../src/agents/common/graph/nodes/triage/index';
import { AgentRegistry } from '../src/agents/common/graph/nodes/triage/AgentRegistry';
import type { WorkspaceState } from '../src/agents/common/graph/nodes/triage/types';

function makeWs(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    hasPrd: false,
    hasDirective: false,
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

/**
 * SSOT-driven prerequisite guard tests.
 * The guard delegates to AgentRegistry which loads `core/data/triage/jobs/*.yaml`,
 * so test expectations must match the YAML definitions, not legacy hardcoded logic.
 */
describe('hasTargetJobPrerequisites (SSOT-driven)', () => {
  beforeAll(async () => {
    await AgentRegistry.initialize();
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Target: design
  // - ui-design required: PRD || directive || figma_config (any_of)
  // - system-design required: PRD || directive (any_of)
  // - spec required: directive
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  describe('target = design', () => {
    it('returns true when directive exists (ui-design via has_directive)', () => {
      expect(hasTargetJobPrerequisites('design', makeWs({ hasDirective: true }))).toBe(true);
    });

    it('returns true when PRD exists (system-design via PRD)', () => {
      expect(hasTargetJobPrerequisites('design', makeWs({ hasPrd: true }))).toBe(true);
    });

    it('returns true when Figma config exists (ui-design via figma_config)', () => {
      expect(hasTargetJobPrerequisites('design', makeWs({ hasFigmaConfig: true }))).toBe(true);
    });

    it('returns false when only assets exist (assets is recommended, not required)', () => {
      expect(hasTargetJobPrerequisites('design', makeWs({ hasAssets: true }))).toBe(false);
    });

    it('returns false when no design prerequisites exist', () => {
      expect(hasTargetJobPrerequisites('design', makeWs())).toBe(false);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Target: code
  // - new-development required: outputs/design || directive (any_of)
  // - modification required: directive
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  describe('target = code', () => {
    it('returns true when directive exists (modification mode)', () => {
      expect(hasTargetJobPrerequisites('code', makeWs({ hasDirective: true }))).toBe(true);
    });

    it('returns true when design doc exists (new-development mode)', () => {
      expect(hasTargetJobPrerequisites('code', makeWs({ hasDesignDoc: true }))).toBe(true);
    });

    it('returns false when only PRD exists (PRD is not a code prereq)', () => {
      expect(hasTargetJobPrerequisites('code', makeWs({ hasPrd: true }))).toBe(false);
    });

    it('returns false when only codebase indexed (codebase is recommended, not required)', () => {
      expect(hasTargetJobPrerequisites('code', makeWs({ hasCodebase: true }))).toBe(false);
    });

    it('returns false when no code prerequisites exist', () => {
      expect(hasTargetJobPrerequisites('code', makeWs())).toBe(false);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Target: learn
  // - codebase-analysis required: has_git_repository (always true in valid workspace)
  // SSOT intentionally does not require a pre-indexed codebase — indexing IS the output of learn.
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  describe('target = learn', () => {
    it('returns true when codebase is already indexed', () => {
      expect(hasTargetJobPrerequisites('learn', makeWs({ hasCodebase: true }))).toBe(true);
    });

    it('returns true even when codebase is not yet indexed (learn produces the index)', () => {
      expect(hasTargetJobPrerequisites('learn', makeWs())).toBe(true);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Target: plan
  // - generate (no PRD): required directive
  // - refine (with PRD): required (PRD + directive)
  // - explain (with PRD + directive): required (PRD + directive)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  describe('target = plan', () => {
    it('returns true when directive provided (generate mode)', () => {
      expect(hasTargetJobPrerequisites('plan', makeWs({ hasDirective: true }))).toBe(true);
    });

    it('returns true when PRD and directive exist (refine/explain mode)', () => {
      expect(hasTargetJobPrerequisites('plan', makeWs({ hasPrd: true, hasDirective: true }))).toBe(true);
    });

    it('returns false when neither PRD nor directive exists', () => {
      expect(hasTargetJobPrerequisites('plan', makeWs())).toBe(false);
    });

    it('returns false when only PRD exists without directive (refine requires directive)', () => {
      expect(hasTargetJobPrerequisites('plan', makeWs({ hasPrd: true }))).toBe(false);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Target: unknown — safe default for jobs not in YAML registry
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  describe('target = unknown', () => {
    it('returns true for unknown job type (safe default)', () => {
      expect(hasTargetJobPrerequisites('something-else', makeWs())).toBe(true);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Regression: code→design(spec) redirect must pass when only directive exists.
  // Multi-boundary code modification with no design docs should be redirected to
  // design's spec mode, which only requires has_directive.
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  describe('regression: code→design(spec) redirect with directive only', () => {
    it('design guard passes when only hasDirective (enables spec mode redirect)', () => {
      expect(hasTargetJobPrerequisites('design', makeWs({ hasDirective: true }))).toBe(true);
    });

    it('design guard blocks when no inputs at all', () => {
      expect(hasTargetJobPrerequisites('design', makeWs())).toBe(false);
    });
  });
});
