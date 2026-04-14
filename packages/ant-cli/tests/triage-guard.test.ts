import { describe, it, expect } from 'vitest';
import { hasTargetJobPrerequisites } from '../src/agents/common/graph/nodes/triage/index';
import type { WorkspaceState } from '../src/agents/common/graph/nodes/triage/types';

function makeWs(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    hasPrd: false,
    hasDirective: false,
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

describe('hasTargetJobPrerequisites', () => {
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Target: design
  // Needs: hasPrd || hasScreens || hasComponents || hasAssets
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  describe('target = design', () => {
    it('returns true when PRD exists', () => {
      expect(hasTargetJobPrerequisites('design', makeWs({ hasPrd: true }))).toBe(true);
    });

    it('returns true when screens exist', () => {
      expect(hasTargetJobPrerequisites('design', makeWs({ hasScreens: true }))).toBe(true);
    });

    it('returns true when components exist', () => {
      expect(hasTargetJobPrerequisites('design', makeWs({ hasComponents: true }))).toBe(true);
    });

    it('returns true when assets exist', () => {
      expect(hasTargetJobPrerequisites('design', makeWs({ hasAssets: true }))).toBe(true);
    });

    it('returns false when no design prerequisites exist', () => {
      expect(hasTargetJobPrerequisites('design', makeWs())).toBe(false);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Target: code
  // Needs: hasDesignDoc || hasCodebase
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  describe('target = code', () => {
    it('returns false when only PRD exists (design artifacts required)', () => {
      expect(hasTargetJobPrerequisites('code', makeWs({ hasPrd: true }))).toBe(false);
    });

    it('returns true when design doc exists', () => {
      expect(hasTargetJobPrerequisites('code', makeWs({ hasDesignDoc: true }))).toBe(true);
    });

    it('returns true when codebase is indexed', () => {
      expect(hasTargetJobPrerequisites('code', makeWs({ hasCodebase: true }))).toBe(true);
    });

    it('returns false when no code prerequisites exist', () => {
      expect(hasTargetJobPrerequisites('code', makeWs())).toBe(false);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Target: learn
  // Needs: hasCodebase
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  describe('target = learn', () => {
    it('returns true when codebase is indexed', () => {
      expect(hasTargetJobPrerequisites('learn', makeWs({ hasCodebase: true }))).toBe(true);
    });

    it('returns false when codebase is not indexed', () => {
      expect(hasTargetJobPrerequisites('learn', makeWs())).toBe(false);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Target: plan
  // Always passes — plan job handles both generate (no PRD) and explain/refine (with PRD)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  describe('target = plan', () => {
    it('returns true when PRD exists', () => {
      expect(hasTargetJobPrerequisites('plan', makeWs({ hasPrd: true }))).toBe(true);
    });

    it('returns true even when no PRD exists (generate mode)', () => {
      expect(hasTargetJobPrerequisites('plan', makeWs())).toBe(true);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Target: unknown
  // Always returns true (safe default)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  describe('target = unknown', () => {
    it('returns true for unknown job type', () => {
      expect(hasTargetJobPrerequisites('something-else', makeWs())).toBe(true);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Key design decision: directive is intentionally excluded
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  describe('directive exclusion (design decision)', () => {
    it('directive alone does NOT satisfy design prerequisites', () => {
      expect(hasTargetJobPrerequisites('design', makeWs({ hasDirective: true }))).toBe(false);
    });

    it('directive alone does NOT satisfy code prerequisites', () => {
      expect(hasTargetJobPrerequisites('code', makeWs({ hasDirective: true }))).toBe(false);
    });
  });
});
