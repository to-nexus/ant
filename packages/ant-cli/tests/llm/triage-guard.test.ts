import { describe, it, expect, beforeAll } from 'vitest';
import { hasTargetJobPrerequisites } from '../../src/agents/common/graph/nodes/triage/index';
import { AgentRegistry } from '../../src/agents/common/graph/nodes/triage/AgentRegistry';
import type { WorkspaceState } from '../../src/agents/common/graph/nodes/triage/types';

function makeWs(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    hasPlan: false,
    hasMetaDirectives: false,
    hasAssets: false,
    hasFigmaConfig: false,
    hasArchitectureSystem: false,
    hasVisualUi: false,
    hasVisualGameArt: false,
    hasMetaEvals: false,
    hasArchitectureSpec: false,
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
      expect(hasTargetJobPrerequisites('design', makeWs({ hasMetaDirectives: true }))).toBe(true);
    });

    it('returns true when PRD exists (system-design via PRD)', () => {
      expect(hasTargetJobPrerequisites('design', makeWs({ hasPlan: true }))).toBe(true);
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
  // - new-development required: architecture (system/spec) || visual || directive (any_of)
  // - modification required: directive
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  describe('target = code', () => {
    it('returns true when directive exists (modification mode)', () => {
      expect(hasTargetJobPrerequisites('code', makeWs({ hasMetaDirectives: true }))).toBe(true);
    });

    it('returns true when an architecture/system doc exists (new-development mode)', () => {
      // workspaceAnalyzer 가 디스크에서 architecture/system/ 산출물을 발견하면
      // hasArchitectureSystem 와 (집계인) hasDesignDoc 를 동시에 켠다. AgentRegistry
      // 는 granular flag 만 본다 — fixture 도 invariant 를 따라 둘 다 세팅.
      expect(
        hasTargetJobPrerequisites(
          'code',
          makeWs({ hasArchitectureSystem: true, hasDesignDoc: true }),
        ),
      ).toBe(true);
    });

    it('returns true when an architecture/spec doc exists (new-development via spec)', () => {
      expect(
        hasTargetJobPrerequisites(
          'code',
          makeWs({ hasArchitectureSpec: true, hasDesignDoc: true }),
        ),
      ).toBe(true);
    });

    it('returns true when a visual/ui doc exists (new-development via UI)', () => {
      expect(
        hasTargetJobPrerequisites(
          'code',
          makeWs({ hasVisualUi: true, hasDesignDoc: true }),
        ),
      ).toBe(true);
    });

    it('returns false when only PRD exists (PRD is not a code prereq)', () => {
      expect(hasTargetJobPrerequisites('code', makeWs({ hasPlan: true }))).toBe(false);
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
      expect(hasTargetJobPrerequisites('plan', makeWs({ hasMetaDirectives: true }))).toBe(true);
    });

    it('returns true when PRD and directive exist (refine/explain mode)', () => {
      expect(hasTargetJobPrerequisites('plan', makeWs({ hasPlan: true, hasMetaDirectives: true }))).toBe(true);
    });

    it('returns false when neither PRD nor directive exists', () => {
      expect(hasTargetJobPrerequisites('plan', makeWs())).toBe(false);
    });

    it('returns false when only PRD exists without directive (refine requires directive)', () => {
      expect(hasTargetJobPrerequisites('plan', makeWs({ hasPlan: true }))).toBe(false);
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
    it('design guard passes when only hasMetaDirectives (enables spec mode redirect)', () => {
      expect(hasTargetJobPrerequisites('design', makeWs({ hasMetaDirectives: true }))).toBe(true);
    });

    it('design guard blocks when no inputs at all', () => {
      expect(hasTargetJobPrerequisites('design', makeWs())).toBe(false);
    });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// detectMode priority for the design job — matches the YAML mode ordering
// (spec → ui-design → system-design). Code-only workspaces with directive
// only must hit `spec`, not `ui-design`. Visual artifacts win for ui-design.
// PRD without visual artifacts falls through to system-design.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('AgentRegistry.detectMode("design", ws) priority', () => {
  beforeAll(async () => {
    await AgentRegistry.initialize();
  });

  it('directive only (code workspace) → spec', () => {
    expect(AgentRegistry.detectMode('design', makeWs({ hasMetaDirectives: true }))).toBe('spec');
  });

  it('figma config (with directive) → ui-design (visual artifact wins)', () => {
    expect(
      AgentRegistry.detectMode('design', makeWs({ hasMetaDirectives: true, hasFigmaConfig: true })),
    ).toBe('ui-design');
  });

  it('assets only (with directive) → ui-design', () => {
    expect(
      AgentRegistry.detectMode('design', makeWs({ hasMetaDirectives: true, hasAssets: true })),
    ).toBe('ui-design');
  });

  it('PRD only (no visual, no directive) → system-design', () => {
    expect(AgentRegistry.detectMode('design', makeWs({ hasPlan: true }))).toBe('system-design');
  });

  it('PRD + directive (no visual) → system-design (PRD takes precedence over spec)', () => {
    expect(
      AgentRegistry.detectMode('design', makeWs({ hasPlan: true, hasMetaDirectives: true })),
    ).toBe('system-design');
  });

  it('all empty → falls back to first mode (spec)', () => {
    expect(AgentRegistry.detectMode('design', makeWs())).toBe('spec');
  });
});
