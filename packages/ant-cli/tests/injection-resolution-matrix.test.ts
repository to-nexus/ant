/**
 * Injection Resolution Matrix
 *
 * Tests the 4-tier injection system by directly exercising AutoInjectionResolver
 * and the shared policy matrix functions. Covers:
 *   - Tier I: Intent → static policies (prompt-policy-matrix)
 *   - Tier A: Auto-tech (techTier, taskType, mode, phase, job)
 *   - Tier D: Data-presence flags
 *   - Tier N: Artifact-conditional policies (deriveArtifactPolicies)
 *
 * Axes: intent × taskType × mode × stack × dataFlags
 */

import { describe, it, expect } from 'vitest';
import {
  INTENT_DEFINITIONS,
  getPromptPolicies,
  POLICY_TEMPLATE_MAP,
  getConfigSlots,
  resolveToRAC,
  deriveFromIntent,
} from '@ant/shared';
import type { IntentId, TechTier, PolicyKey, ResolvedArtifact, Mode } from '@ant/shared';
import { AutoInjectionResolver } from '../src/core/prompt/builder/AutoInjectionResolver';
import { deriveArtifactPolicies } from '../src/core/prompt/builder/ArtifactRoleResolver';

const resolver = new AutoInjectionResolver();

// ============================================
// Helpers
// ============================================

function makeTechTier(overrides?: Partial<TechTier>): TechTier {
  return { language: 'typescript', stack: 'frontend', ...overrides };
}

function resolveAutoInjections(opts: {
  job: string;
  phase?: 'plan' | 'execute';
  taskType?: string;
  mode?: Mode;
  techTier?: TechTier;
  techTiers?: TechTier[];
  data?: Record<string, boolean>;
  resolvedAction?: ReturnType<typeof resolveToRAC>;
}): string[] {
  return resolver.resolve({
    job: opts.job,
    phase: opts.phase ?? 'execute',
    taskType: opts.taskType,
    mode: opts.mode,
    resolvedAction: opts.resolvedAction,
    techTier: opts.techTier,
    techTiers: opts.techTiers,
    data: opts.data ?? {},
  });
}

function resolveTierI(intent: IntentId): string[] {
  const policy = getPromptPolicies(intent);
  return policy.policies.map(pk => POLICY_TEMPLATE_MAP[pk]).filter(Boolean);
}

function resolveTierN(intent: IntentId, artifacts: ResolvedArtifact[]): string[] {
  const pks = deriveArtifactPolicies(intent, artifacts);
  return pks.map(pk => POLICY_TEMPLATE_MAP[pk]).filter(Boolean);
}

// ============================================
// Tier I: Intent Policies — Completeness
// ============================================

describe('Tier I: Intent policies completeness', () => {
  it('every intent has a prompt policy entry', () => {
    for (const def of INTENT_DEFINITIONS) {
      const policy = getPromptPolicies(def.id);
      expect(policy, `${def.id} missing from prompt-policy-matrix`).toBeDefined();
      expect(policy.refMediaHints).toBeDefined();
    }
  });

  it('every PolicyKey in policies[] maps to a template path', () => {
    for (const def of INTENT_DEFINITIONS) {
      const policy = getPromptPolicies(def.id);
      for (const pk of policy.policies) {
        expect(POLICY_TEMPLATE_MAP[pk], `${def.id}: PolicyKey ${pk} has no template`).toBeDefined();
      }
    }
  });

  it('design system gen intents get domain-specific guides', () => {
    expect(resolveTierI('gen-sys-fe')).toContain('design/base/injections/frontend-guide');
    expect(resolveTierI('gen-sys-fe')).not.toContain('design/base/injections/backend-guide');

    expect(resolveTierI('gen-sys-be')).toContain('design/base/injections/backend-guide');
    expect(resolveTierI('gen-sys-be')).not.toContain('design/base/injections/frontend-guide');

    expect(resolveTierI('gen-sys-full')).toContain('design/base/injections/frontend-guide');
    expect(resolveTierI('gen-sys-full')).toContain('design/base/injections/backend-guide');
    expect(resolveTierI('gen-sys-full')).toContain('design/base/injections/api-contract-guide');
  });

  it('UI design intents get ui-design-policy', () => {
    const uiIntents: IntentId[] = ['gen-ui-figma', 'gen-ui-ref', 'gen-ui-desc', 'rev-ui'];
    for (const id of uiIntents) {
      expect(resolveTierI(id), `${id}`).toContain('common/injections/ui-design-policy');
    }
  });

  it('gen-ui-ref gets visual-source-authority via Tier I', () => {
    expect(resolveTierI('gen-ui-ref')).toContain('common/injections/visual-source-authority');
  });

  it('code intents have no static policies (only conditional)', () => {
    const codeIntents: IntentId[] = ['gen-code-sys', 'gen-code-spec', 'gen-code-directive', 'rev-code', 'explain-code'];
    for (const id of codeIntents) {
      expect(resolveTierI(id), `${id}`).toHaveLength(0);
    }
  });

  it('plan intents have no static policies', () => {
    expect(resolveTierI('gen-plan')).toHaveLength(0);
    expect(resolveTierI('rev-plan')).toHaveLength(0);
    expect(resolveTierI('explain-plan')).toHaveLength(0);
  });

  it('ask/learn/visual intents have no static policies', () => {
    const noPolicy: IntentId[] = [
      'ask-evaluate', 'ask-ant', 'ask-general',
      'gen-learn',
      'gen-visual-logo', 'gen-visual-icon', 'gen-visual-hero', 'gen-visual-illustration', 'explain-visual',
    ];
    for (const id of noPolicy) {
      expect(resolveTierI(id), id).toHaveLength(0);
    }
  });
});

// ============================================
// Tier N: Artifact-conditional Policies
// ============================================

describe('Tier N: Artifact-conditional policies', () => {
  it('gen-code-sys with UI artifact triggers ui-design-policy', () => {
    const artifacts: ResolvedArtifact[] = [
      { path: 'outputs/design/ui/ui-spec.json', content: 'mock', role: 'context' },
    ];
    const policies = resolveTierN('gen-code-sys', artifacts);
    expect(policies).toContain('common/injections/ui-design-policy');
  });

  it('gen-code-sys without UI artifact does NOT trigger ui-design-policy', () => {
    const artifacts: ResolvedArtifact[] = [
      { path: 'outputs/design/system/fe-system.md', content: 'mock', role: 'ref' },
    ];
    const policies = resolveTierN('gen-code-sys', artifacts);
    expect(policies).not.toContain('common/injections/ui-design-policy');
  });

  it('gen-code-directive has no conditional policies', () => {
    const artifacts: ResolvedArtifact[] = [
      { path: 'outputs/design/ui/ui-spec.json', content: 'mock', role: 'context' },
    ];
    const policies = resolveTierN('gen-code-directive', artifacts);
    expect(policies).toHaveLength(0);
  });

  it('rev-code with UI artifact triggers ui-design-policy', () => {
    const artifacts: ResolvedArtifact[] = [
      { path: 'outputs/design/ui/ui-tokens.json', content: 'mock', role: 'context' },
    ];
    const policies = resolveTierN('rev-code', artifacts);
    expect(policies).toContain('common/injections/ui-design-policy');
  });

  it('design intents have no conditional policies', () => {
    const designIntents: IntentId[] = ['gen-sys-fe', 'gen-sys-be', 'gen-ui-figma', 'gen-spec'];
    for (const id of designIntents) {
      const policies = resolveTierN(id, [{ path: 'outputs/design/ui/x', content: 'x', role: 'context' }]);
      expect(policies, id).toHaveLength(0);
    }
  });
});

// ============================================
// Tier A+D: AutoInjectionResolver — TaskType matrix
// ============================================

describe('Tier A+D: TaskType × injection matrix (code job, execute phase)', () => {
  const feTS = makeTechTier({ language: 'typescript', stack: 'frontend' });

  const taskTypes = ['feature', 'setup', 'verification', 'error', 'test-code', 'doc'] as const;

  // env-specific rules: only feature, setup
  it.each(['feature', 'setup'] as const)('taskType=%s: env-specific rules included', (tt) => {
    const injections = resolveAutoInjections({ job: 'code', taskType: tt, techTier: feTS });
    const envRules = injections.filter(i => i.includes('/environments/'));
    expect(envRules.length, `${tt}: should have environment rules`).toBeGreaterThan(0);
  });

  it.each(['verification', 'error', 'test-code', 'doc'] as const)('taskType=%s: NO env-specific rules', (tt) => {
    const injections = resolveAutoInjections({ job: 'code', taskType: tt, techTier: feTS });
    const envRules = injections.filter(i => i.includes('/environments/'));
    expect(envRules.length, `${tt}: should not have environment rules`).toBe(0);
  });

  // tool-calling-rules-compact: feature, setup only
  it.each(['feature', 'setup'] as const)('taskType=%s: tool-calling-rules-compact included', (tt) => {
    const injections = resolveAutoInjections({ job: 'code', taskType: tt, techTier: feTS });
    expect(injections).toContain('code/base/injections/tool-calling-rules-compact');
  });

  it.each(['verification', 'error', 'test-code', 'doc'] as const)('taskType=%s: NO tool-calling-rules-compact', (tt) => {
    const injections = resolveAutoInjections({ job: 'code', taskType: tt, techTier: feTS });
    expect(injections).not.toContain('code/base/injections/tool-calling-rules-compact');
  });

  // preview-setup: feature, setup, error (when frontend)
  it.each(['feature', 'setup'] as const)('taskType=%s: preview-setup included', (tt) => {
    const injections = resolveAutoInjections({ job: 'code', taskType: tt, techTier: feTS });
    expect(injections).toContain('code/base/injections/preview-setup');
  });

  it('taskType=error + frontend: preview-setup included', () => {
    const injections = resolveAutoInjections({ job: 'code', taskType: 'error', techTier: feTS });
    expect(injections).toContain('code/base/injections/preview-setup');
  });

  it.each(['verification', 'test-code', 'doc'] as const)('taskType=%s: NO preview-setup', (tt) => {
    const injections = resolveAutoInjections({ job: 'code', taskType: tt, techTier: feTS });
    expect(injections).not.toContain('code/base/injections/preview-setup');
  });

  // visual-source-authority: feature, setup, error (via Tier A, frontend)
  it.each(['feature', 'setup'] as const)('taskType=%s: visual-source-authority included', (tt) => {
    const injections = resolveAutoInjections({ job: 'code', taskType: tt, techTier: feTS });
    expect(injections).toContain('common/injections/visual-source-authority');
  });

  it.each(['verification', 'test-code', 'doc'] as const)('taskType=%s: NO visual-source-authority', (tt) => {
    const injections = resolveAutoInjections({ job: 'code', taskType: tt, techTier: feTS });
    expect(injections).not.toContain('common/injections/visual-source-authority');
  });

  // backend-safety: all except verification and doc, when backend
  it('backend-safety included for feature+backend', () => {
    const beTier = makeTechTier({ stack: 'backend' });
    const injections = resolveAutoInjections({ job: 'code', taskType: 'feature', techTier: beTier });
    expect(injections).toContain('code/phases/execute/injections/backend-safety');
  });

  it('backend-safety NOT included for feature+frontend-only', () => {
    const injections = resolveAutoInjections({ job: 'code', taskType: 'feature', techTier: feTS });
    expect(injections).not.toContain('code/phases/execute/injections/backend-safety');
  });

  // test-code hints
  it('test-code: language-specific hints included', () => {
    const injections = resolveAutoInjections({ job: 'code', taskType: 'test-code', techTier: feTS });
    expect(injections).toContain('code/phases/execute/tasks/test-code/languages/typescript/hints');
  });

  it('feature: NO test-code hints', () => {
    const injections = resolveAutoInjections({ job: 'code', taskType: 'feature', techTier: feTS });
    const testHints = injections.filter(i => i.includes('test-code'));
    expect(testHints).toHaveLength(0);
  });

  // port-management: all except test-code and doc
  it.each(['feature', 'setup', 'verification', 'error'] as const)('taskType=%s: port-management included', (tt) => {
    const injections = resolveAutoInjections({ job: 'code', taskType: tt, techTier: feTS });
    expect(injections).toContain('code/phases/execute/injections/port-management');
  });

  it.each(['test-code', 'doc'] as const)('taskType=%s: NO port-management', (tt) => {
    const injections = resolveAutoInjections({ job: 'code', taskType: tt, techTier: feTS });
    expect(injections).not.toContain('code/phases/execute/injections/port-management');
  });
});

// ============================================
// Tier A+D: Stack variations
// ============================================

describe('Tier A+D: Stack × environment rules', () => {
  it('frontend-only: browser env rules', () => {
    const injections = resolveAutoInjections({
      job: 'code', taskType: 'feature',
      techTier: makeTechTier({ stack: 'frontend', language: 'typescript' }),
    });
    expect(injections).toContain('code/phases/execute/languages/typescript/environments/browser/rules');
    expect(injections).not.toContain('code/phases/execute/languages/typescript/environments/node-api/rules');
  });

  it('backend-only (typescript): node-api env rules', () => {
    const injections = resolveAutoInjections({
      job: 'code', taskType: 'feature',
      techTier: makeTechTier({ stack: 'backend', language: 'typescript' }),
    });
    expect(injections).toContain('code/phases/execute/languages/typescript/environments/node-api/rules');
  });

  it('backend-only (go): go-api env rules', () => {
    const injections = resolveAutoInjections({
      job: 'code', taskType: 'feature',
      techTier: makeTechTier({ stack: 'backend', language: 'go' }),
    });
    expect(injections).toContain('code/phases/execute/languages/go/environments/go-api/rules');
  });

  it('fullstack: both browser + node-api + fullstack rules', () => {
    const injections = resolveAutoInjections({
      job: 'code', taskType: 'feature',
      techTier: makeTechTier({ stack: 'fullstack', language: 'typescript' }),
    });
    expect(injections).toContain('code/phases/execute/languages/typescript/environments/browser/rules');
    expect(injections).toContain('code/phases/execute/languages/typescript/environments/node-api/rules');
    expect(injections).toContain('code/phases/execute/languages/typescript/environments/fullstack/rules');
  });

  it('no techTier defaults to browser', () => {
    const injections = resolveAutoInjections({ job: 'code', taskType: 'feature' });
    expect(injections).toContain('code/phases/execute/languages/typescript/environments/browser/rules');
  });
});

// ============================================
// Tier D: Data presence flags
// ============================================

describe('Tier D: Data presence flags', () => {
  it('hasDirective → directive injection', () => {
    const injections = resolveAutoInjections({
      job: 'code', data: { hasDirective: true },
    });
    expect(injections).toContain('common/injections/directive');
  });

  it('no directive → no directive injection', () => {
    const injections = resolveAutoInjections({ job: 'code', data: {} });
    expect(injections).not.toContain('common/injections/directive');
  });

  it('hasMemory → memory injection', () => {
    const injections = resolveAutoInjections({
      job: 'code', data: { hasMemory: true },
    });
    expect(injections).toContain('common/injections/memory');
  });

  it('hasGitDiff → git-diff injection (code only)', () => {
    const injections = resolveAutoInjections({
      job: 'code', data: { hasGitDiff: true },
    });
    expect(injections).toContain('code/base/injections/git-diff');
  });

  it('hasGitDiff on design job → NO git-diff injection', () => {
    const injections = resolveAutoInjections({
      job: 'design', data: { hasGitDiff: true },
    });
    expect(injections).not.toContain('code/base/injections/git-diff');
  });

  it('hasRetrievedCode → retrieved-code injection', () => {
    const injections = resolveAutoInjections({
      job: 'code', data: { hasRetrievedCode: true },
    });
    expect(injections).toContain('code/base/injections/retrieved-code');
  });

  it('hasReferenceCode → reference-code injection', () => {
    const injections = resolveAutoInjections({
      job: 'code', data: { hasReferenceCode: true },
    });
    expect(injections).toContain('code/base/injections/reference-code');
  });

  it('hasRetryContext → retry-context injection (execute phase)', () => {
    const injections = resolveAutoInjections({
      job: 'code', phase: 'execute', data: { hasRetryContext: true },
    });
    expect(injections).toContain('code/phases/execute/injections/retry-context');
  });

  it('hasLessons → lessons injection', () => {
    const injections = resolveAutoInjections({
      job: 'code', phase: 'execute', data: { hasLessons: true },
    });
    expect(injections).toContain('code/phases/execute/injections/lessons');
  });

  it('hasSessionContext → session-context injection', () => {
    const injections = resolveAutoInjections({
      job: 'code', phase: 'execute', data: { hasSessionContext: true },
    });
    expect(injections).toContain('code/phases/execute/injections/session-context');
  });

  it('hasMissingDependency → missing-dependency-fix (code only)', () => {
    const injections = resolveAutoInjections({
      job: 'code', phase: 'execute',
      techTier: makeTechTier(),
      data: { hasMissingDependency: true },
    });
    expect(injections).toContain('code/phases/execute/injections/missing-dependency-fix');
  });

  it('hasRuntimeError → runtime-error-fix', () => {
    const injections = resolveAutoInjections({
      job: 'code', phase: 'execute', data: { hasRuntimeError: true },
    });
    expect(injections).toContain('code/phases/execute/injections/runtime-error-fix');
  });
});

// ============================================
// RAC-driven injections (Tier D — resolvedAction)
// ============================================

describe('RAC-driven injections', () => {
  it('resolvedAction present → action-context injection', () => {
    const rac = resolveToRAC('gen-code-sys');
    const injections = resolveAutoInjections({
      job: 'code', resolvedAction: rac, data: {},
    });
    expect(injections).toContain('common/injections/action-context');
  });

  it('no resolvedAction → no action-context', () => {
    const injections = resolveAutoInjections({ job: 'code', data: {} });
    expect(injections).not.toContain('common/injections/action-context');
  });

  it('refactor mode → refactor-guidance', () => {
    const rac = resolveToRAC('rev-code');
    const injections = resolveAutoInjections({
      job: 'code', mode: 'refactor', resolvedAction: rac, data: {},
    });
    expect(injections).toContain('common/injections/refactor-guidance');
    expect(injections).not.toContain('common/injections/explain-guidance');
  });

  it('explain mode → explain-guidance', () => {
    const rac = resolveToRAC('explain-code');
    const injections = resolveAutoInjections({
      job: 'code', mode: 'explain', resolvedAction: rac, data: {},
    });
    expect(injections).toContain('common/injections/explain-guidance');
    expect(injections).not.toContain('common/injections/refactor-guidance');
  });

  it('generate mode → no mode-specific guidance', () => {
    const rac = resolveToRAC('gen-code-sys');
    const injections = resolveAutoInjections({
      job: 'code', mode: 'generate', resolvedAction: rac, data: {},
    });
    expect(injections).not.toContain('common/injections/refactor-guidance');
    expect(injections).not.toContain('common/injections/explain-guidance');
  });
});

// ============================================
// Behavioral-debugging injection (refactor / error heuristic)
// ============================================

describe('Behavioral-debugging injection', () => {
  it('refactor mode → behavioral-debugging', () => {
    const injections = resolveAutoInjections({
      job: 'code', mode: 'refactor', data: {},
    });
    expect(injections).toContain('code/base/injections/behavioral-debugging');
  });

  it('explicit refactor via RAC → behavioral-debugging', () => {
    const rac = resolveToRAC('rev-code', undefined, 'explicit');
    const injections = resolveAutoInjections({
      job: 'code', resolvedAction: rac, data: {},
    });
    expect(injections).toContain('code/base/injections/behavioral-debugging');
  });

  it('error + hasProjectCode → behavioral-debugging', () => {
    const injections = resolveAutoInjections({
      job: 'code', taskType: 'error',
      data: { hasProjectCode: true },
    });
    expect(injections).toContain('code/base/injections/behavioral-debugging');
  });

  it('generate mode without error → no behavioral-debugging', () => {
    const injections = resolveAutoInjections({
      job: 'code', mode: 'generate', data: {},
    });
    expect(injections).not.toContain('code/base/injections/behavioral-debugging');
  });
});

// ============================================
// Design job injections
// ============================================

describe('Design job execute-phase injections', () => {
  it('design job execute: document-language always injected', () => {
    const injections = resolveAutoInjections({
      job: 'design', phase: 'execute', data: {},
    });
    expect(injections).toContain('design/base/injections/document-language');
  });

  it('design job plan phase: NO document-language', () => {
    const injections = resolveAutoInjections({
      job: 'design', phase: 'plan', data: {},
    });
    expect(injections).not.toContain('design/base/injections/document-language');
  });
});

// ============================================
// Cross-cutting: plan phase is minimal
// ============================================

describe('Plan phase: minimal injections', () => {
  it('plan phase: no env rules, no preview, no port-management', () => {
    const injections = resolveAutoInjections({
      job: 'code', phase: 'plan',
      techTier: makeTechTier(),
      data: {},
    });
    expect(injections.filter(i => i.includes('/environments/'))).toHaveLength(0);
    expect(injections).not.toContain('code/base/injections/preview-setup');
    expect(injections).not.toContain('code/phases/execute/injections/port-management');
  });

  it('plan phase still gets directive and memory if present', () => {
    const injections = resolveAutoInjections({
      job: 'code', phase: 'plan',
      data: { hasDirective: true, hasMemory: true },
    });
    expect(injections).toContain('common/injections/directive');
    expect(injections).toContain('common/injections/memory');
  });
});

// ============================================
// Deduplication
// ============================================

describe('Injection deduplication', () => {
  it('no duplicate injection paths', () => {
    const injections = resolveAutoInjections({
      job: 'code', phase: 'execute', taskType: 'feature',
      mode: 'refactor',
      techTier: makeTechTier({ stack: 'fullstack' }),
      resolvedAction: resolveToRAC('rev-code', undefined, 'explicit'),
      data: {
        hasDirective: true, hasMemory: true,
        hasGitDiff: true, hasRetrievedCode: true,
        hasRetryContext: true, hasLessons: true,
        hasSessionContext: true, hasRuntimeError: true,
      },
    });
    const unique = new Set(injections);
    expect(injections.length).toBe(unique.size);
  });
});

// ============================================
// No-techTier jobs (plan, ask, visual): injection still works
// ============================================

describe('Jobs without techTier', () => {
  it('code job with no techTier defaults gracefully', () => {
    const injections = resolveAutoInjections({
      job: 'code', phase: 'execute', taskType: 'feature',
      data: { hasDirective: true },
    });
    expect(injections).toContain('common/injections/directive');
    expect(injections).toContain('common/injections/visual-source-authority');
    expect(injections.filter(i => i.includes('/environments/'))).not.toHaveLength(0);
  });

  it('design job needs no techTier', () => {
    const injections = resolveAutoInjections({
      job: 'design', phase: 'execute',
      data: { hasDirective: true },
    });
    expect(injections).toContain('common/injections/directive');
    expect(injections).toContain('design/base/injections/document-language');
  });
});

// ============================================
// Setup: config injection without project code
// ============================================

describe('Setup task: config injection', () => {
  it('setup without projectCode → language/setup/config', () => {
    const injections = resolveAutoInjections({
      job: 'code', phase: 'execute', taskType: 'setup',
      techTier: makeTechTier({ language: 'typescript' }),
      data: { hasProjectCode: false },
    });
    expect(injections).toContain('code/phases/execute/languages/typescript/setup/config');
  });

  it('setup with projectCode → NO language/setup/config', () => {
    const injections = resolveAutoInjections({
      job: 'code', phase: 'execute', taskType: 'setup',
      techTier: makeTechTier({ language: 'typescript' }),
      data: { hasProjectCode: true },
    });
    expect(injections).not.toContain('code/phases/execute/languages/typescript/setup/config');
  });

  it('setup → language/setup/constraints', () => {
    const injections = resolveAutoInjections({
      job: 'code', taskType: 'setup',
      techTier: makeTechTier({ language: 'go' }),
      data: {},
    });
    expect(injections).toContain('code/phases/execute/languages/go/setup/constraints');
  });
});
