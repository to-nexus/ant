// TODO: Rewrite this test for AutoInjectionResolver (replaces PromptResolver)
import { describe, it, expect } from 'vitest';
import type { ResolvedActionContext } from '@ant/shared';

function minimalContext(overrides?: Partial<any>): any {
  return {
    referenceCodeContexts: [],
    stats: {
      hasDirective: false,
      hasDesign: false,
      hasProjectCode: false,
      hasReferenceCode: false,
      hasMemory: false,
      hasSessionHistory: false,
      codebaseDetected: false,
      hasMissingDependency: false,
    },
    ...overrides,
  } as any;
}

function getInjections(
  resolver: any,
  ctx: any,
  rac?: ResolvedActionContext,
  opts?: { job?: 'code' | 'design'; phase?: 'plan' | 'execute'; taskType?: string },
): string[] {
  const ctxWithRac = rac ? { ...ctx, resolvedAction: rac } : ctx;
  const config = resolver.resolve(
    opts?.job ?? 'code',
    opts?.phase ?? 'execute',
    ctxWithRac,
    opts?.taskType,
  );
  return config.templates.injections;
}

function hasInjection(injections: string[], substring: string): boolean {
  return injections.some(i => i.includes(substring));
}

// ============================================
// C1: Explicit + documents → design-context injection 억제
// ============================================

// TODO: Rewrite this test for AutoInjectionResolver
describe.skip('PromptResolver explicit path', () => {
  const resolver = null as any;

  it('suppresses prd-spec, design-doc, ui-doc when documents present; keeps visual-source-authority (static policy)', () => {
    const ctx = minimalContext({
      stats: {
        hasDirective: true,
        hasDesign: true,
        hasProjectCode: false,
        hasReferenceCode: false,
        hasMemory: false,
        hasSessionHistory: false,
        codebaseDetected: false,
        hasMissingDependency: false,
      },
      techTier: { language: 'typescript', stack: 'frontend' as const },
    });
    const rac: ResolvedActionContext = {
      source: 'explicit',
      intent: 'gen-code-sys',
      mode: 'generate',
      hasExplicitFields: true,
      documents: [{ path: 'inputs/sources/prd.md', content: '# PRD', role: 'ref' }],
    };

    const inj = getInjections(resolver, ctx, rac);
    expect(hasInjection(inj, 'prd-spec')).toBe(false);
    expect(hasInjection(inj, '/design-doc')).toBe(false);
    expect(hasInjection(inj, 'ui-doc')).toBe(false);
    expect(hasInjection(inj, 'visual-source-authority')).toBe(true);
    expect(inj).toContain('common/injections/action-context');
  });

  it('does NOT inject legacy design-doc/prd-spec even when explicit + no documents (Phase 8: removed)', () => {
    const ctx = minimalContext({
      stats: {
        hasDirective: true,
        hasDesign: true,
        hasProjectCode: false,
        hasReferenceCode: false,
        hasMemory: false,
        hasSessionHistory: false,
        codebaseDetected: false,
        hasMissingDependency: false,
      },
    });
    const rac: ResolvedActionContext = {
      source: 'explicit',
      intent: 'gen-code-sys',
      mode: 'generate',
      hasExplicitFields: true,
    };

    const inj = getInjections(resolver, ctx, rac);
    expect(hasInjection(inj, 'design-doc')).toBe(false);
    expect(hasInjection(inj, 'prd-spec')).toBe(false);
    expect(inj).toContain('common/injections/action-context');
  });

  // ============================================
  // C2: Context-based environment → language/environment injection 선택
  // ============================================

  it('uses techTier.stack=backend + techTier.language=go for backend rules', () => {
    const ctx = minimalContext({ techTier: { language: 'go', stack: 'backend' as const } });
    const rac: ResolvedActionContext = {
      source: 'explicit',
      intent: 'gen-sys-be',
      mode: 'generate',
      hasExplicitFields: true,
    };

    const inj = getInjections(resolver, ctx, rac);
    expect(hasInjection(inj, 'languages/go/environments/go-api/rules')).toBe(true);
  });

  it('uses techTier.stack=frontend → browser rules', () => {
    const ctx = minimalContext({ techTier: { language: 'typescript', stack: 'frontend' as const } });
    const rac: ResolvedActionContext = {
      source: 'explicit',
      intent: 'gen-sys-fe',
      mode: 'generate',
      hasExplicitFields: true,
    };

    const inj = getInjections(resolver, ctx, rac);
    expect(hasInjection(inj, 'environments/browser/rules')).toBe(true);
  });

  it('uses techTier.stack=fullstack → composite injection', () => {
    const ctx = minimalContext({ techTier: { language: 'typescript', stack: 'fullstack' as const } });
    const rac: ResolvedActionContext = {
      source: 'explicit',
      intent: 'gen-sys-full',
      mode: 'generate',
      hasExplicitFields: true,
    };

    const inj = getInjections(resolver, ctx, rac);
    expect(hasInjection(inj, 'environments/browser/rules')).toBe(true);
    expect(hasInjection(inj, 'environments/node-api/rules')).toBe(true);
    expect(hasInjection(inj, 'environments/fullstack/rules')).toBe(true);
  });

  // ============================================
  // C3: Explicit + mode=refactor → behavioral-debugging
  // ============================================

  it('adds behavioral-debugging for explicit refactor', () => {
    const ctx = minimalContext();
    const rac: ResolvedActionContext = {
      source: 'explicit',
      intent: 'rev-code',
      mode: 'refactor',
      hasExplicitFields: true,
    };

    const inj = getInjections(resolver, ctx, rac);
    expect(hasInjection(inj, 'behavioral-debugging')).toBe(true);
    expect(inj).toContain('common/injections/refactor-guidance');
  });

  // ============================================
  // C4: Explicit + framework=nextjs → design job nextjs-augmentation
  // ============================================

  it('resolves framework augmentation via techTier for design job', () => {
    const ctx = minimalContext({
      currentTask: { name: 't', type: 'feature', priority: 100, description: 'd', targetFile: 'fe-system-main.md' },
      techTier: { language: 'typescript', framework: 'Next.js', stack: 'frontend' as const },
    });
    const rac: ResolvedActionContext = {
      source: 'explicit',
      intent: 'gen-sys-fe',
      mode: 'generate',
      hasExplicitFields: true,
    };

    const inj = getInjections(resolver, ctx, rac, { job: 'design' });
    expect(inj).toContain('design/phases/execute/injections/nextjs-augmentation');
  });

  it('resolves go-api augmentation via techTier for design job', () => {
    const ctx = minimalContext({
      currentTask: { name: 't', type: 'feature', priority: 100, description: 'd', targetFile: 'be-system-main.md' },
      techTier: { language: 'go', stack: 'backend' as const },
    });
    const rac: ResolvedActionContext = {
      source: 'explicit',
      intent: 'gen-sys-be',
      mode: 'generate',
      hasExplicitFields: true,
    };

    const inj = getInjections(resolver, ctx, rac, { job: 'design' });
    expect(inj).toContain('design/phases/execute/injections/go-api-augmentation');
  });

  // ============================================
  // R1-R3 injection 검증
  // ============================================

  it('adds R1 (action-context) for explicit source', () => {
    const ctx = minimalContext();
    const rac: ResolvedActionContext = {
      source: 'explicit',
      intent: 'gen-code-sys',
      mode: 'generate',
      hasExplicitFields: true,
    };

    const inj = getInjections(resolver, ctx, rac);
    expect(inj).toContain('common/injections/action-context');
  });

  it('adds R3 (refactor-guidance) when mode=refactor regardless of source', () => {
    const ctx = minimalContext();
    const inferRac: ResolvedActionContext = {
      source: 'infer',
      mode: 'refactor',
      hasExplicitFields: false,
    };

    const inj = getInjections(resolver, ctx, inferRac);
    expect(inj).toContain('common/injections/refactor-guidance');
  });
});

// ============================================
// C5: Infer 경로 regression
// ============================================

// TODO: Rewrite this test for AutoInjectionResolver
describe.skip('PromptResolver infer path (regression)', () => {
  const resolver = null as any;

  it('does NOT inject legacy design-doc/prd-spec for infer path (Phase 8: removed)', () => {
    const ctx = minimalContext({
      stats: {
        hasDirective: true,
        hasDesign: true,
        hasProjectCode: false,
        hasReferenceCode: false,
        hasMemory: false,
        hasSessionHistory: false,
        codebaseDetected: false,
        hasMissingDependency: false,
      },
    });
    const rac: ResolvedActionContext = {
      source: 'infer',
      mode: 'generate',
      hasExplicitFields: false,
    };

    const inj = getInjections(resolver, ctx, rac);
    expect(hasInjection(inj, 'design-doc')).toBe(false);
    expect(hasInjection(inj, 'prd-spec')).toBe(false);
  });

  it('includes action-context when infer + hasExplicitFields=true (Phase 8: no legacy injections)', () => {
    const ctx = minimalContext({
      stats: {
        hasDirective: false,
        hasDesign: true,
        hasProjectCode: false,
        hasReferenceCode: false,
        hasMemory: false,
        hasSessionHistory: false,
        codebaseDetected: false,
        hasMissingDependency: false,
      },
    });
    const rac: ResolvedActionContext = {
      source: 'infer',
      mode: 'generate',
      hasExplicitFields: true,
    };

    const inj = getInjections(resolver, ctx, rac);
    expect(hasInjection(inj, 'design-doc')).toBe(false);
    expect(hasInjection(inj, 'prd-spec')).toBe(false);
    expect(inj).toContain('common/injections/action-context');
  });

  it('does not add action-context when no resolvedAction', () => {
    const ctx = minimalContext();
    const inj = getInjections(resolver, ctx, undefined);
    expect(hasInjection(inj, 'action-context')).toBe(false);
  });

  it('falls back to detectLanguage from techTier when infer path', () => {
    const ctx = minimalContext({
      techTier: { language: 'go' },
    });
    const rac: ResolvedActionContext = {
      source: 'infer',
      mode: 'generate',
      hasExplicitFields: false,
    };

    const inj = getInjections(resolver, ctx, rac);
    expect(hasInjection(inj, 'languages/go/')).toBe(true);
  });
});

// ============================================
// Phase 7: documents[] 일반화 검증
// ============================================

// TODO: Rewrite this test for AutoInjectionResolver
describe.skip('PromptResolver documents[] generalization (Phase 7)', () => {
  const resolver = null as any;

  it('legacy design-doc/prd-spec never injected (Phase 8: removed); action-context present with documents', () => {
    const ctx = minimalContext({
      documents: [
        { path: 'system-design', content: 'design content', role: 'ref' as const, label: 'System Design' },
      ],
      stats: {
        hasDirective: true,
        hasDesign: true,
        hasProjectCode: false,
        hasReferenceCode: false,
        hasMemory: false,
        hasSessionHistory: false,
        codebaseDetected: false,
        hasMissingDependency: false,
      },
    });
    const rac: ResolvedActionContext = {
      source: 'infer',
      mode: 'generate',
      hasExplicitFields: false,
      documents: [
        { path: 'system-design', content: 'design content', role: 'ref', label: 'System Design' },
      ],
    };

    const inj = getInjections(resolver, ctx, rac);
    expect(hasInjection(inj, 'prd-spec')).toBe(false);
    expect(hasInjection(inj, '/design-doc')).toBe(false);
    expect(inj).toContain('common/injections/action-context');
  });

  it('keeps visual-source-authority as static policy even when documents present', () => {
    const ctx = minimalContext();
    const rac: ResolvedActionContext = {
      source: 'infer',
      mode: 'generate',
      hasExplicitFields: false,
      documents: [
        { path: 'system-design', content: 'x', role: 'ref', label: 'System Design' },
      ],
    };

    const inj = getInjections(resolver, ctx, rac);
    expect(hasInjection(inj, 'visual-source-authority')).toBe(true);
  });

  it('adds ui-design-policy when documents contain UI path', () => {
    const ctx = minimalContext({ techTier: { language: 'typescript', stack: 'frontend' as const } });
    const rac: ResolvedActionContext = {
      source: 'infer',
      mode: 'generate',
      hasExplicitFields: false,
      documents: [
        { path: 'ui-spec', content: 'ui content', role: 'context', label: 'UI Specification' },
      ],
    };

    const inj = getInjections(resolver, ctx, rac);
    expect(inj).toContain('common/injections/ui-design-policy');
  });

  it('does NOT add ui-design-policy for backend environment', () => {
    const ctx = minimalContext({ techTier: { language: 'typescript', stack: 'backend' as const } });
    const rac: ResolvedActionContext = {
      source: 'infer',
      mode: 'generate',
      hasExplicitFields: false,
      documents: [
        { path: 'ui-spec', content: 'ui content', role: 'context', label: 'UI Specification' },
      ],
    };

    const inj = getInjections(resolver, ctx, rac);
    expect(hasInjection(inj, 'ui-design-policy')).toBe(false);
  });

  it('detectFrameworkAugmentation uses techTier, not documents text scan', () => {
    const ctx = minimalContext({
      techTier: { language: 'typescript', framework: 'Next.js', stack: 'frontend' as const },
      currentTask: { name: 't', type: 'feature', priority: 100, description: 'd', targetFile: 'fe-system-main.md' },
    });

    const inj = getInjections(resolver, ctx, undefined, { job: 'design' });
    expect(inj).toContain('design/phases/execute/injections/nextjs-augmentation');
  });

  it('no framework augmentation when techTier absent (documents text scan removed)', () => {
    const ctx = minimalContext({
      documents: [
        { path: 'prd', content: 'Build a Next.js SSR application with app router', role: 'context' as const },
      ],
      currentTask: { name: 't', type: 'feature', priority: 100, description: 'd', targetFile: 'fe-system-main.md' },
    });

    const inj = getInjections(resolver, ctx, undefined, { job: 'design' });
    expect(hasInjection(inj, 'nextjs-augmentation')).toBe(false);
  });
});
