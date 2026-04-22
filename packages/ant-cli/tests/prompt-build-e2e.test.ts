/**
 * PromptBuilder.build() End-to-End Tests
 *
 * Mirrors the 5 production call sites (code execute, design system, design spec,
 * ask, plan) with realistic PromptBuildConfig to verify:
 *
 *   Stage 1: Injection paths are correctly resolved
 *   Stage 2: No templates fail to render (failedTemplates = [])
 *   Stage 3: Injection content is actually present in the final system prompt
 *
 * This ensures the full pipeline (path resolution → render → merge) works,
 * not just static path correctness.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'path';
import { FilePromptAdapter, initPartials } from '../src/periphery/adapters/prompt/FilePromptAdapter';
import { PromptBuilder } from '../src/core/prompt/builder/PromptBuilder';
import type { PromptBuildConfig, PromptBuildResult } from '../src/core/prompt/builder/PromptBuildConfig';
import type { ResolvedArtifact, Basis, TechTier, PolicyKey } from '@ant/shared';
import { resolveToRAC, deriveFromIntent } from '@ant/shared';
import type { IntentId } from '@ant/shared';
import { deriveArtifactPolicies } from '../src/core/prompt/builder/ArtifactRoleResolver';

const TEMPLATES_DIR = join(__dirname, '../src/core/prompt/templates');

let promptBuilder: PromptBuilder;

beforeAll(async () => {
  await initPartials(TEMPLATES_DIR);
  const adapter = new FilePromptAdapter(TEMPLATES_DIR);
  promptBuilder = new PromptBuilder(adapter);
});

// ============================================
// Fingerprints — unique text from each injection template
// ============================================

const FP = {
  DIRECTIVE: '# Directive',
  MEMORY: '# Relevant Memory',
  VISUAL_SOURCE: 'Visual Source Authority',
  UI_DESIGN_POLICY: 'UI Specification Policy',
  ACTION_CONTEXT: 'User Action Specification',
  REFACTOR: 'Refactoring Constraints',
  EXPLAIN: 'Explain Mode Constraints',
  PREVIEW_SETUP: 'Path Prefix Configuration',
  TOOL_CALLING: 'Command Execution Principles',
  BEHAVIORAL_DEBUG: 'Behavioral Debugging',
  BACKEND_SAFETY: 'Backend Safety Principles',
  PORT_MGMT: 'Port Management',
  UI_DESIGN_GUIDE: 'UI DESIGN DOCUMENTS GUIDE',
  DOC_LANGUAGE: 'Document Output Language',
  FRONTEND_GUIDE: 'FRONTEND SYSTEM DESIGN GUIDE',
  BACKEND_GUIDE: 'BACKEND DESIGN DOCUMENT GUIDE',
  CODE_SYSTEM: 'Task Priority Hierarchy',
  DESIGN_SYSTEM: 'ARCHITECTURAL DESIGN DOCUMENTS',
  PREVIEW_CONTRACT: 'Dev Server Runtime Contract',
} as const;

// ============================================
// Helpers
// ============================================

function makeTechTier(overrides?: Partial<TechTier>): TechTier {
  return { language: 'typescript', stack: 'frontend', ...overrides };
}

function makeBasis(overrides?: Partial<Basis>): Basis {
  return {
    techTier: {
      stack: 'frontend',
      frontend: { language: 'typescript', stack: 'frontend', framework: 'react' },
    },
    ...overrides,
  } as Basis;
}

function assertNoFailedTemplates(result: PromptBuildResult) {
  expect(result.sections.failedTemplates, 'Some templates failed to render').toHaveLength(0);
}

function assertSystemContains(result: PromptBuildResult, fingerprint: string, label?: string) {
  expect(
    result.system,
    `system prompt should contain "${label || fingerprint}"`,
  ).toContain(fingerprint);
}

function assertSystemNotContains(result: PromptBuildResult, fingerprint: string, label?: string) {
  expect(
    result.system,
    `system prompt should NOT contain "${label || fingerprint}"`,
  ).not.toContain(fingerprint);
}

// ============================================
// 1. Code Execute — Default (feature task)
// ============================================

describe('E2E: Code execute — default/feature', () => {
  let result: PromptBuildResult;

  beforeAll(async () => {
    const rac = resolveToRAC('gen-code-sys' as IntentId, {
      refs: ['outputs/design/system/fe-system-main.md'],
    }, 'explicit');

    const docs: ResolvedArtifact[] = [
      { path: 'outputs/design/system/fe-system-main.md', content: '# FE System Design\nReact app', role: 'ref' },
    ];
    const artifactPolicies = deriveArtifactPolicies('gen-code-sys' as IntentId, docs);

    const config: PromptBuildConfig = {
      templates: {
        base: 'jobs/code/nodes/execute/variants/default/base',
        rules: 'jobs/code/nodes/execute/variants/default/rules',
        system: 'jobs/code/base/system',
      },
      intent: 'gen-code-sys' as IntentId,
      artifactPolicies,
      techContext: {
        techTier: makeTechTier(),
        techTiers: [makeTechTier()],
        taskType: 'feature',
        mode: 'generate',
        resolvedAction: rac,
      },
      basis: makeBasis(),
      pipeline: {
        sanitizeInput: true,
        includeBasis: true,
        includeExamples: true,
        applyPolicyGuardrails: false,
      },
      vars: {
        directive: 'Build the login page',
        currentTask: { id: 't1', type: 'feature', description: 'Login page', targetFile: 'src/App.tsx', name: 'task-1', priority: 'high' },
        resolvedAction: rac,
        projectFileTree: 'src/\n  index.ts',
      },
      artifacts: docs,
    };

    result = await promptBuilder.build(config);
  });

  it('stage 1: injection paths include expected entries', () => {
    expect(result.injections).toContain('jobs/shared/injections/action-context');
    expect(result.injections).toContain('jobs/shared/injections/visual-source-authority');
    expect(result.injections).toContain('jobs/code/base/injections/preview-setup');
    expect(result.injections).toContain('jobs/shared/injections/directive');
  });

  it('stage 2: no templates fail to render', () => {
    assertNoFailedTemplates(result);
  });

  it('stage 3: injection content is present in system prompt', () => {
    assertSystemContains(result, FP.CODE_SYSTEM, 'code system');
    assertSystemContains(result, FP.DIRECTIVE, 'directive');
    assertSystemContains(result, FP.VISUAL_SOURCE, 'visual-source-authority');
    assertSystemContains(result, FP.PREVIEW_SETUP, 'preview-setup');
    assertSystemContains(result, FP.TOOL_CALLING, 'tool-calling-rules');
    assertSystemContains(result, FP.ACTION_CONTEXT, 'action-context');
  });

  it('stage 3: sections are non-empty', () => {
    expect(result.sections.systemBase.length).toBeGreaterThan(0);
    expect(result.sections.rules.length).toBeGreaterThan(0);
    expect(result.sections.injections.length).toBeGreaterThan(0);
    expect(result.sections.profiles.length).toBeGreaterThan(0);
    expect(result.sections.examples.length).toBeGreaterThan(0);
  });

  it('user prompt is non-empty', () => {
    expect(result.user.length).toBeGreaterThan(0);
  });
});

// ============================================
// 2. Code Execute — Verification
// ============================================

describe('E2E: Code execute — verification', () => {
  let result: PromptBuildResult;

  beforeAll(async () => {
    const config: PromptBuildConfig = {
      templates: {
        base: 'jobs/code/nodes/execute/variants/verification/base',
        rules: 'jobs/code/nodes/execute/variants/verification/rules',
        system: 'jobs/code/base/system',
      },
      techContext: {
        techTier: makeTechTier(),
        taskType: 'verification',
        mode: 'generate',
      },
      pipeline: {
        sanitizeInput: true,
        includeBasis: false,
        includeExamples: false,
        applyPolicyGuardrails: false,
      },
      vars: {
        directive: 'Verify the build',
        currentTask: { id: 't2', type: 'verification', description: 'Build verification', targetFile: '', name: 'verify', priority: 'high' },
        projectFileTree: 'src/\n  index.ts',
      },
    };

    result = await promptBuilder.build(config);
  });

  it('stage 1: verification skips static policies', () => {
    expect(result.injections).not.toContain('jobs/code/base/injections/tool-calling-rules-compact');
    expect(result.injections).not.toContain('jobs/shared/injections/visual-source-authority');
    expect(result.injections).not.toContain('jobs/code/base/injections/ui-source-dispatch');
  });

  it('stage 2: no templates fail to render', () => {
    assertNoFailedTemplates(result);
  });

  it('stage 3: verification template content is present', () => {
    assertSystemContains(result, FP.CODE_SYSTEM, 'code system');
    // Negative assertions check injections section specifically,
    // since rules templates may embed related text via partials.
    expect(result.sections.injections).not.toContain(FP.TOOL_CALLING);
    expect(result.sections.injections).not.toContain(FP.PREVIEW_SETUP);
  });

  it('examples and profiles are empty', () => {
    expect(result.sections.examples).toBe('');
    expect(result.sections.profiles).toBe('');
  });
});

// ============================================
// 3. Code Execute — Error (fullstack)
// ============================================

describe('E2E: Code execute — error + fullstack', () => {
  let result: PromptBuildResult;

  beforeAll(async () => {
    const config: PromptBuildConfig = {
      templates: {
        base: 'jobs/code/nodes/execute/variants/error/base',
        rules: 'jobs/code/nodes/execute/variants/error/rules',
        system: 'jobs/code/base/system',
      },
      techContext: {
        techTier: makeTechTier({ stack: 'fullstack' }),
        techTiers: [makeTechTier({ stack: 'fullstack' })],
        taskType: 'error',
        mode: 'generate',
      },
      pipeline: {
        sanitizeInput: true,
        includeBasis: false,
        includeExamples: false,
        applyPolicyGuardrails: false,
      },
      vars: {
        directive: 'Fix the error',
        currentTask: { id: 't3', type: 'error', description: 'Fix build error', targetFile: '', name: 'fix', priority: 'high' },
        errorText: 'Module not found: react-router',
        projectFileTree: 'src/\n  App.tsx',
        hasProjectCode: true,
      },
    };

    result = await promptBuilder.build(config);
  });

  it('stage 1: error + fullstack gets preview-setup and backend-safety', () => {
    expect(result.injections).toContain('jobs/code/base/injections/preview-setup');
    expect(result.injections).toContain('jobs/code/nodes/execute/injections/backend-safety');
  });

  it('stage 1: error + hasProjectCode triggers behavioral-debugging', () => {
    expect(result.injections).toContain('jobs/code/base/injections/behavioral-debugging');
  });

  it('stage 2: no templates fail to render', () => {
    assertNoFailedTemplates(result);
  });

  it('stage 3: injection content present', () => {
    assertSystemContains(result, FP.PREVIEW_SETUP, 'preview-setup');
    assertSystemContains(result, FP.BACKEND_SAFETY, 'backend-safety');
    assertSystemContains(result, FP.BEHAVIORAL_DEBUG, 'behavioral-debugging');
  });
});

// ============================================
// 4. Design System-Design
// ============================================

describe('E2E: Design system-design (FE)', () => {
  let result: PromptBuildResult;

  beforeAll(async () => {
    const rac = resolveToRAC('gen-sys-fe' as IntentId, undefined, 'explicit');

    const config: PromptBuildConfig = {
      templates: {
        base: 'jobs/design/nodes/execute/variants/system-design/base',
        rules: 'jobs/design/nodes/execute/variants/system-design/rules',
        system: 'jobs/design/base/system',
      },
      intent: 'gen-sys-fe' as IntentId,
      techContext: {
        taskType: 'feature',
        mode: 'generate',
        resolvedAction: rac,
      },
      basis: makeBasis(),
      pipeline: {
        sanitizeInput: true,
        includeBasis: true,
        includeExamples: false,
        applyPolicyGuardrails: false,
      },
      vars: {
        directive: 'Design the frontend system',
        resolvedAction: rac,
        taskDescription: 'Create frontend architecture',
        projectFileTree: 'src/\n  index.ts',
      },
    };

    result = await promptBuilder.build(config);
  });

  it('stage 1: Tier I frontend-guide injected, backend-guide excluded', () => {
    expect(result.injections).toContain('jobs/design/base/injections/frontend-guide');
    expect(result.injections).not.toContain('jobs/design/base/injections/backend-guide');
  });

  it('stage 1: design execute gets document-language', () => {
    expect(result.injections).toContain('jobs/design/base/injections/document-language');
  });

  it('stage 2: no templates fail to render', () => {
    assertNoFailedTemplates(result);
  });

  it('stage 3: injection content present', () => {
    assertSystemContains(result, FP.DESIGN_SYSTEM, 'design system base');
    assertSystemContains(result, FP.FRONTEND_GUIDE, 'frontend-guide');
    assertSystemContains(result, FP.DOC_LANGUAGE, 'document-language');
    assertSystemNotContains(result, FP.BACKEND_GUIDE, 'no backend-guide for FE');
  });

  it('stage 3: basis section populated', () => {
    expect(result.sections.profiles.length).toBeGreaterThan(0);
  });
});

// ============================================
// 5. Design Spec (minimal pipeline)
// ============================================

describe('E2E: Design spec', () => {
  let result: PromptBuildResult;

  beforeAll(async () => {
    const config: PromptBuildConfig = {
      templates: {
        base: 'jobs/design/nodes/execute/variants/spec/base',
        rules: 'jobs/design/nodes/execute/variants/spec/rules',
        system: 'jobs/design/base/system',
      },
      pipeline: {
        sanitizeInput: true,
        applyPolicyGuardrails: false,
      },
      vars: {
        directive: 'Create feature specification',
        taskDescription: 'Spec for auth feature',
        projectFileTree: 'src/\n  auth.ts',
      },
    };

    result = await promptBuilder.build(config);
  });

  it('stage 1: no injections (no techContext, no intent)', () => {
    expect(result.injections).toHaveLength(0);
  });

  it('stage 2: no templates fail to render', () => {
    assertNoFailedTemplates(result);
  });

  it('stage 3: design system base present, injections section empty', () => {
    assertSystemContains(result, FP.DESIGN_SYSTEM, 'design system');
    expect(result.sections.injections).toBe('');
  });
});

// ============================================
// 6. Ask (no pipeline)
// ============================================

describe('E2E: Ask agent', () => {
  let result: PromptBuildResult;

  beforeAll(async () => {
    const config: PromptBuildConfig = {
      templates: {
        base: 'jobs/ask/nodes/agent/variants/default/base',
        rules: 'jobs/ask/nodes/agent/variants/default/rules',
      },
      vars: {
        question: 'How does the auth system work?',
        hasWorkspace: true,
        isKorean: false,
      },
    };

    result = await promptBuilder.build(config);
  });

  it('stage 1: no injections (no pipeline flags)', () => {
    expect(result.injections).toHaveLength(0);
  });

  it('stage 2: no templates fail to render', () => {
    assertNoFailedTemplates(result);
  });

  it('base + rules only, no system', () => {
    expect(result.sections.systemBase).toBe('');
    expect(result.sections.rules.length).toBeGreaterThan(0);
    expect(result.user.length).toBeGreaterThan(0);
  });
});

// ============================================
// 7. Plan (no techContext → no Tier A/D)
// ============================================

describe('E2E: Plan', () => {
  let result: PromptBuildResult;

  beforeAll(async () => {
    const config: PromptBuildConfig = {
      templates: {
        base: 'jobs/plan/nodes/plan/variants/default/base',
        rules: 'jobs/plan/nodes/plan/variants/default/rules',
      },
      intent: 'gen-plan' as IntentId,
      vars: {
        directive: 'Plan the project',
        hasExistingDocument: false,
      },
    };

    result = await promptBuilder.build(config);
  });

  it('stage 1: no injections (plan has no static policies, no techContext)', () => {
    expect(result.injections).toHaveLength(0);
  });

  it('stage 2: no templates fail to render', () => {
    assertNoFailedTemplates(result);
  });

  it('rules and user prompt non-empty', () => {
    expect(result.sections.rules.length).toBeGreaterThan(0);
    expect(result.user.length).toBeGreaterThan(0);
  });
});

// ============================================
// Cross-cutting: Refactor mode
// ============================================

describe('E2E: Code execute — refactor mode', () => {
  let result: PromptBuildResult;

  beforeAll(async () => {
    const rac = resolveToRAC('rev-code' as IntentId, undefined, 'explicit');

    const config: PromptBuildConfig = {
      templates: {
        base: 'jobs/code/nodes/execute/variants/default/base',
        rules: 'jobs/code/nodes/execute/variants/default/rules',
        system: 'jobs/code/base/system',
      },
      intent: 'rev-code' as IntentId,
      techContext: {
        techTier: makeTechTier({ stack: 'backend' }),
        taskType: 'feature',
        mode: 'refactor',
        resolvedAction: rac,
      },
      pipeline: {
        sanitizeInput: true,
        includeBasis: false,
        includeExamples: false,
        applyPolicyGuardrails: false,
      },
      vars: {
        directive: 'Refactor the API layer',
        currentTask: { id: 't4', type: 'feature', description: 'Refactor', targetFile: '', name: 'refactor', priority: 'high' },
        resolvedAction: rac,
        projectFileTree: 'src/\n  api.ts',
      },
    };

    result = await promptBuilder.build(config);
  });

  it('stage 1: refactor gets refactor-guidance + behavioral-debugging', () => {
    expect(result.injections).toContain('jobs/shared/injections/refactor-guidance');
    expect(result.injections).toContain('jobs/code/base/injections/behavioral-debugging');
    expect(result.injections).toContain('jobs/shared/injections/action-context');
  });

  it('stage 1: backend gets backend-safety', () => {
    expect(result.injections).toContain('jobs/code/nodes/execute/injections/backend-safety');
  });

  it('stage 1: no preview-setup for backend-only', () => {
    expect(result.injections).not.toContain('jobs/code/base/injections/preview-setup');
  });

  it('stage 2: no templates fail to render', () => {
    assertNoFailedTemplates(result);
  });

  it('stage 3: refactor injection content present', () => {
    assertSystemContains(result, FP.REFACTOR, 'refactor-guidance');
    assertSystemContains(result, FP.BEHAVIORAL_DEBUG, 'behavioral-debugging');
    assertSystemContains(result, FP.BACKEND_SAFETY, 'backend-safety');
    assertSystemNotContains(result, FP.PREVIEW_SETUP, 'no preview-setup');
  });
});
