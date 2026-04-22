/**
 * Injection Resolution Matrix
 *
 * Tests the 4-tier injection system by directly exercising AutoInjectionResolver
 * and the shared policy matrix functions. Covers:
 *   - Tier I: Intent → static policies (prompt-policy-matrix)
 *   - Tier A: Auto-tech (techTier, taskType, mode, node, job)
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
  node?: 'plan' | 'execute';
  taskType?: string;
  mode?: Mode;
  techTier?: TechTier;
  techTiers?: TechTier[];
  data?: Record<string, boolean>;
  resolvedAction?: ReturnType<typeof resolveToRAC>;
}): string[] {
  return resolver.resolve({
    job: opts.job,
    node: opts.node ?? 'execute',
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
    expect(resolveTierI('gen-sys-fe')).toContain('jobs/design/base/injections/frontend-guide');
    expect(resolveTierI('gen-sys-fe')).not.toContain('jobs/design/base/injections/backend-guide');

    expect(resolveTierI('gen-sys-be')).toContain('jobs/design/base/injections/backend-guide');
    expect(resolveTierI('gen-sys-be')).not.toContain('jobs/design/base/injections/frontend-guide');

    expect(resolveTierI('gen-sys-full')).toContain('jobs/design/base/injections/frontend-guide');
    expect(resolveTierI('gen-sys-full')).toContain('jobs/design/base/injections/backend-guide');
    expect(resolveTierI('gen-sys-full')).toContain('jobs/design/base/injections/api-contract-guide');
  });

  it('UI design intents get ui-design-policy', () => {
    const uiIntents: IntentId[] = ['gen-ui-figma', 'gen-ui-ref', 'gen-ui-desc', 'rev-ui'];
    for (const id of uiIntents) {
      expect(resolveTierI(id), `${id}`).toContain('jobs/shared/injections/ui-design-policy');
    }
  });

  it('gen-ui-ref gets visual-source-authority via Tier I', () => {
    expect(resolveTierI('gen-ui-ref')).toContain('jobs/shared/injections/visual-source-authority');
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
      { path: 'outputs/design/ui/ant/ui-spec.json', content: 'mock', role: 'context' },
    ];
    const policies = resolveTierN('gen-code-sys', artifacts);
    expect(policies).toContain('jobs/shared/injections/ui-design-policy');
  });

  it('gen-code-sys without UI artifact does NOT trigger ui-design-policy', () => {
    const artifacts: ResolvedArtifact[] = [
      { path: 'outputs/design/system/fe-system.md', content: 'mock', role: 'ref' },
    ];
    const policies = resolveTierN('gen-code-sys', artifacts);
    expect(policies).not.toContain('jobs/shared/injections/ui-design-policy');
  });

  it('gen-code-directive with UI artifact triggers ui-design-policy (new: all code intents accept UI source as context)', () => {
    const artifacts: ResolvedArtifact[] = [
      { path: 'outputs/design/ui/ant/ui-spec.json', content: 'mock', role: 'context' },
    ];
    const policies = resolveTierN('gen-code-directive', artifacts);
    expect(policies).toContain('jobs/shared/injections/ui-design-policy');
  });

  it('gen-code-directive without UI artifact has no conditional policies', () => {
    const policies = resolveTierN('gen-code-directive', []);
    expect(policies).toHaveLength(0);
  });

  it('rev-code with UI artifact triggers ui-design-policy', () => {
    const artifacts: ResolvedArtifact[] = [
      { path: 'outputs/design/ui/ant/ui-tokens.json', content: 'mock', role: 'context' },
    ];
    const policies = resolveTierN('rev-code', artifacts);
    expect(policies).toContain('jobs/shared/injections/ui-design-policy');
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

describe('Tier A+D: TaskType × injection matrix (code job, execute node)', () => {
  const feTS = makeTechTier({ language: 'typescript', stack: 'frontend' });

  const taskTypes = ['feature', 'setup', 'verification', 'error', 'test-code', 'doc'] as const;

  // env-specific rules removed from AutoInjectionResolver (now in buildBasisSection)
  it.each(['feature', 'setup', 'verification', 'error', 'test-code', 'doc'] as const)(
    'taskType=%s: NO env-specific rules in injection resolver',
    (tt) => {
      const injections = resolveAutoInjections({ job: 'code', taskType: tt, techTier: feTS });
      const envRules = injections.filter(i => i.includes('/environments/'));
      expect(envRules.length, `${tt}: should not have environment rules`).toBe(0);
    },
  );

  // tool-calling-rules-compact: removed from AutoInjection — included via rules.md partial in all variants
  it.each(['feature', 'setup', 'verification', 'error', 'test-code', 'doc'] as const)(
    'taskType=%s: tool-calling-rules-compact NOT in auto-injections (partial-only)',
    (tt) => {
      const injections = resolveAutoInjections({ job: 'code', taskType: tt, techTier: feTS });
      expect(injections).not.toContain('jobs/code/base/injections/tool-calling-rules-compact');
    },
  );

  // preview-setup: feature, setup, error (when frontend)
  it.each(['feature', 'setup'] as const)('taskType=%s: preview-setup included', (tt) => {
    const injections = resolveAutoInjections({ job: 'code', taskType: tt, techTier: feTS });
    expect(injections).toContain('jobs/code/base/injections/preview-setup');
  });

  it('taskType=error + frontend: preview-setup included', () => {
    const injections = resolveAutoInjections({ job: 'code', taskType: 'error', techTier: feTS });
    expect(injections).toContain('jobs/code/base/injections/preview-setup');
  });

  it.each(['verification', 'test-code', 'doc'] as const)('taskType=%s: NO preview-setup', (tt) => {
    const injections = resolveAutoInjections({ job: 'code', taskType: tt, techTier: feTS });
    expect(injections).not.toContain('jobs/code/base/injections/preview-setup');
  });

  // visual-source-authority: feature, setup, error (via Tier A, frontend)
  it.each(['feature', 'setup'] as const)('taskType=%s: visual-source-authority included', (tt) => {
    const injections = resolveAutoInjections({ job: 'code', taskType: tt, techTier: feTS });
    expect(injections).toContain('jobs/shared/injections/visual-source-authority');
  });

  it.each(['verification', 'test-code', 'doc'] as const)('taskType=%s: NO visual-source-authority', (tt) => {
    const injections = resolveAutoInjections({ job: 'code', taskType: tt, techTier: feTS });
    expect(injections).not.toContain('jobs/shared/injections/visual-source-authority');
  });

  // backend-safety: all except verification and doc, when backend
  it('backend-safety included for feature+backend', () => {
    const beTier = makeTechTier({ stack: 'backend' });
    const injections = resolveAutoInjections({ job: 'code', taskType: 'feature', techTier: beTier });
    expect(injections).toContain('jobs/code/nodes/execute/injections/backend-safety');
  });

  it('backend-safety NOT included for feature+frontend-only', () => {
    const injections = resolveAutoInjections({ job: 'code', taskType: 'feature', techTier: feTS });
    expect(injections).not.toContain('jobs/code/nodes/execute/injections/backend-safety');
  });

  // test-code hints
  it('test-code: language-specific hints included', () => {
    const injections = resolveAutoInjections({ job: 'code', taskType: 'test-code', techTier: feTS });
    expect(injections).toContain('jobs/code/nodes/execute/variants/test-code/basis/techTier/typescript/hints');
  });

  it('feature: NO test-code hints', () => {
    const injections = resolveAutoInjections({ job: 'code', taskType: 'feature', techTier: feTS });
    const testHints = injections.filter(i => i.includes('test-code'));
    expect(testHints).toHaveLength(0);
  });

  // port-management: all except test-code and doc
  it.each(['feature', 'setup', 'verification', 'error'] as const)('taskType=%s: port-management included', (tt) => {
    const injections = resolveAutoInjections({ job: 'code', taskType: tt, techTier: feTS });
    expect(injections).toContain('jobs/code/nodes/execute/injections/port-management');
  });

  it.each(['test-code', 'doc'] as const)('taskType=%s: NO port-management', (tt) => {
    const injections = resolveAutoInjections({ job: 'code', taskType: tt, techTier: feTS });
    expect(injections).not.toContain('jobs/code/nodes/execute/injections/port-management');
  });
});

// ============================================
// Tier A+D: Stack variations
// ============================================

describe('Tier A+D: Stack × policy injections (env rules moved to buildBasisSection)', () => {
  it('frontend-only: includes preview-setup', () => {
    const injections = resolveAutoInjections({
      job: 'code', taskType: 'feature',
      techTier: makeTechTier({ stack: 'frontend', language: 'typescript' }),
    });
    expect(injections).toContain('jobs/code/base/injections/preview-setup');
  });

  it('backend-only (go): no preview-setup', () => {
    const injections = resolveAutoInjections({
      job: 'code', taskType: 'feature',
      techTier: makeTechTier({ stack: 'backend', language: 'go' }),
    });
    expect(injections).not.toContain('jobs/code/base/injections/preview-setup');
  });

  it('fullstack: includes both frontend and backend injections', () => {
    const injections = resolveAutoInjections({
      job: 'code', taskType: 'feature',
      techTier: makeTechTier({ stack: 'fullstack', language: 'typescript' }),
    });
    expect(injections).toContain('jobs/code/base/injections/preview-setup');
    expect(injections).toContain('jobs/code/nodes/execute/injections/backend-safety');
  });

  it('no environment injection paths from resolver', () => {
    const injections = resolveAutoInjections({ job: 'code', taskType: 'feature' });
    const envRules = injections.filter(i => i.includes('/environments/'));
    expect(envRules).toHaveLength(0);
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
    expect(injections).toContain('jobs/shared/injections/directive');
  });

  it('no directive → no directive injection', () => {
    const injections = resolveAutoInjections({ job: 'code', data: {} });
    expect(injections).not.toContain('jobs/shared/injections/directive');
  });

  it('hasMemory → memory injection', () => {
    const injections = resolveAutoInjections({
      job: 'code', data: { hasMemory: true },
    });
    expect(injections).toContain('jobs/shared/injections/memory');
  });

  it('hasRetryContext → retry-context injection (execute node)', () => {
    const injections = resolveAutoInjections({
      job: 'code', node: 'execute', data: { hasRetryContext: true },
    });
    expect(injections).toContain('jobs/code/nodes/execute/injections/retry-context');
  });

  it('hasLessons → lessons injection', () => {
    const injections = resolveAutoInjections({
      job: 'code', node: 'execute', data: { hasLessons: true },
    });
    expect(injections).toContain('jobs/code/nodes/execute/injections/lessons');
  });

  it('hasSessionContext → session-context injection', () => {
    const injections = resolveAutoInjections({
      job: 'code', node: 'execute', data: { hasSessionContext: true },
    });
    expect(injections).toContain('jobs/code/nodes/execute/injections/session-context');
  });

  it('hasMissingDependency → missing-dependency-fix (code only)', () => {
    const injections = resolveAutoInjections({
      job: 'code', node: 'execute',
      techTier: makeTechTier(),
      data: { hasMissingDependency: true },
    });
    expect(injections).toContain('jobs/code/nodes/execute/injections/missing-dependency-fix');
  });

  it('hasRuntimeError → runtime-error-fix', () => {
    const injections = resolveAutoInjections({
      job: 'code', node: 'execute', data: { hasRuntimeError: true },
    });
    expect(injections).toContain('jobs/code/nodes/execute/injections/runtime-error-fix');
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
    expect(injections).toContain('jobs/shared/injections/action-context');
  });

  it('no resolvedAction → no action-context', () => {
    const injections = resolveAutoInjections({ job: 'code', data: {} });
    expect(injections).not.toContain('jobs/shared/injections/action-context');
  });

  it('refactor mode → refactor-guidance', () => {
    const rac = resolveToRAC('rev-code');
    const injections = resolveAutoInjections({
      job: 'code', mode: 'refactor', resolvedAction: rac, data: {},
    });
    expect(injections).toContain('jobs/shared/injections/refactor-guidance');
    expect(injections).not.toContain('jobs/shared/injections/explain-guidance');
  });

  it('explain mode → explain-guidance', () => {
    const rac = resolveToRAC('explain-code');
    const injections = resolveAutoInjections({
      job: 'code', mode: 'explain', resolvedAction: rac, data: {},
    });
    expect(injections).toContain('jobs/shared/injections/explain-guidance');
    expect(injections).not.toContain('jobs/shared/injections/refactor-guidance');
  });

  it('generate mode → no mode-specific guidance', () => {
    const rac = resolveToRAC('gen-code-sys');
    const injections = resolveAutoInjections({
      job: 'code', mode: 'generate', resolvedAction: rac, data: {},
    });
    expect(injections).not.toContain('jobs/shared/injections/refactor-guidance');
    expect(injections).not.toContain('jobs/shared/injections/explain-guidance');
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
    expect(injections).toContain('jobs/code/base/injections/behavioral-debugging');
  });

  it('explicit refactor via RAC → behavioral-debugging', () => {
    const rac = resolveToRAC('rev-code', undefined, 'explicit');
    const injections = resolveAutoInjections({
      job: 'code', resolvedAction: rac, data: {},
    });
    expect(injections).toContain('jobs/code/base/injections/behavioral-debugging');
  });

  it('error + hasProjectCode → behavioral-debugging', () => {
    const injections = resolveAutoInjections({
      job: 'code', taskType: 'error',
      data: { hasProjectCode: true },
    });
    expect(injections).toContain('jobs/code/base/injections/behavioral-debugging');
  });

  it('generate mode without error → no behavioral-debugging', () => {
    const injections = resolveAutoInjections({
      job: 'code', mode: 'generate', data: {},
    });
    expect(injections).not.toContain('jobs/code/base/injections/behavioral-debugging');
  });
});

// ============================================
// UI task: ui-source-dispatch injection
// ============================================

describe('UI task: ui-source-dispatch injection', () => {
  it('code job + taskType=ui → ui-source-dispatch', () => {
    const injections = resolveAutoInjections({
      job: 'code', node: 'execute', taskType: 'ui',
      techTier: makeTechTier(),
      data: {},
    });
    expect(injections).toContain('jobs/code/base/injections/ui-source-dispatch');
  });

  it('code job + taskType=design-system → ui-source-dispatch (NEW: design-system also injected)', () => {
    const injections = resolveAutoInjections({
      job: 'code', node: 'execute', taskType: 'design-system',
      techTier: makeTechTier(),
      data: {},
    });
    expect(injections).toContain('jobs/code/base/injections/ui-source-dispatch');
  });

  it('code job + taskType=feature → NO ui-source-dispatch', () => {
    const injections = resolveAutoInjections({
      job: 'code', node: 'execute', taskType: 'feature',
      techTier: makeTechTier(),
      data: {},
    });
    expect(injections).not.toContain('jobs/code/base/injections/ui-source-dispatch');
  });

  it('design job + taskType=ui → NO ui-source-dispatch', () => {
    const injections = resolveAutoInjections({
      job: 'design', node: 'execute', taskType: 'ui',
      data: {},
    });
    expect(injections).not.toContain('jobs/code/base/injections/ui-source-dispatch');
  });
});

// ============================================
// Design job injections
// ============================================

describe('Design job execute-phase injections', () => {
  it('design job execute: document-language always injected', () => {
    const injections = resolveAutoInjections({
      job: 'design', node: 'execute', data: {},
    });
    expect(injections).toContain('jobs/design/base/injections/document-language');
  });

  it('design job plan node: NO document-language', () => {
    const injections = resolveAutoInjections({
      job: 'design', node: 'plan', data: {},
    });
    expect(injections).not.toContain('jobs/design/base/injections/document-language');
  });
});

// ============================================
// Cross-cutting: plan node is minimal
// ============================================

describe('Plan node: minimal injections', () => {
  it('plan node: no env rules, no preview, no port-management', () => {
    const injections = resolveAutoInjections({
      job: 'code', node: 'plan',
      techTier: makeTechTier(),
      data: {},
    });
    expect(injections.filter(i => i.includes('/environments/'))).toHaveLength(0);
    expect(injections).not.toContain('jobs/code/base/injections/preview-setup');
    expect(injections).not.toContain('jobs/code/nodes/execute/injections/port-management');
  });

  it('plan node still gets directive and memory if present', () => {
    const injections = resolveAutoInjections({
      job: 'code', node: 'plan',
      data: { hasDirective: true, hasMemory: true },
    });
    expect(injections).toContain('jobs/shared/injections/directive');
    expect(injections).toContain('jobs/shared/injections/memory');
  });
});

// ============================================
// Deduplication
// ============================================

describe('Injection deduplication', () => {
  it('no duplicate injection paths', () => {
    const injections = resolveAutoInjections({
      job: 'code', node: 'execute', taskType: 'feature',
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
      job: 'code', node: 'execute', taskType: 'feature',
      data: { hasDirective: true },
    });
    expect(injections).toContain('jobs/shared/injections/directive');
    expect(injections).toContain('jobs/shared/injections/visual-source-authority');
    expect(injections).toContain('jobs/code/base/injections/preview-setup');
  });

  it('design job needs no techTier', () => {
    const injections = resolveAutoInjections({
      job: 'design', node: 'execute',
      data: { hasDirective: true },
    });
    expect(injections).toContain('jobs/shared/injections/directive');
    expect(injections).toContain('jobs/design/base/injections/document-language');
  });
});

// ============================================
// Setup: config injection without project code
// ============================================

describe('Setup task: config injection', () => {
  it('setup → language/setup/config (new project = empty codebase by definition)', () => {
    const injections = resolveAutoInjections({
      job: 'code', node: 'execute', taskType: 'setup',
      techTier: makeTechTier({ language: 'typescript' }),
      data: {},
    });
    expect(injections).toContain('jobs/code/nodes/execute/basis/techTier/typescript/setup/config');
  });

  it('setup → language/setup/constraints', () => {
    const injections = resolveAutoInjections({
      job: 'code', taskType: 'setup',
      techTier: makeTechTier({ language: 'go' }),
      data: {},
    });
    expect(injections).toContain('jobs/code/nodes/execute/basis/techTier/go/setup/constraints');
  });
});
