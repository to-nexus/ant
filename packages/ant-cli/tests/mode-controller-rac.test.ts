import { describe, it, expect } from 'vitest';
import { ModeController } from '../src/core/prompt/engine/ModeController';
import type { AssembledContext } from '../src/core/prompt/engine/ContextAssembler';
import type { ResolvedActionContext } from '@ant/shared';

function minimalContext(overrides?: Partial<AssembledContext>): AssembledContext {
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
  } as AssembledContext;
}

function getInjections(
  mc: ModeController,
  ctx: AssembledContext,
  rac?: ResolvedActionContext,
  opts?: { job?: 'code' | 'design'; phase?: 'plan' | 'execute'; mode?: string; taskType?: string },
): string[] {
  const config = mc.determineMode(
    opts?.job ?? 'code',
    opts?.phase ?? 'execute',
    ctx,
    opts?.mode as any,
    opts?.taskType,
    rac,
  );
  return config.templates.injections;
}

function hasInjection(injections: string[], substring: string): boolean {
  return injections.some(i => i.includes(substring));
}

// ============================================
// C1: Explicit + documents → design-context injection 억제
// ============================================

describe('ModeController explicit path', () => {
  const mc = new ModeController();

  it('suppresses prd-spec, design-doc, ui-doc when documents present; keeps visual-source-authority (static policy)', () => {
    const ctx = minimalContext({
      designDoc: 'some design doc',
      prdSpec: 'some prd',
      uiDoc: 'some ui doc',
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
      intent: 'create-code',
      jobMode: 'generate',
      tech: { language: 'typescript', environment: 'frontend' },
      hasExplicitFields: true,
      documents: [{ path: 'inputs/sources/prd.md', content: '# PRD', role: 'ref' }],
    };

    const inj = getInjections(mc, ctx, rac);
    expect(hasInjection(inj, 'prd-spec')).toBe(false);
    expect(hasInjection(inj, '/design-doc')).toBe(false);
    expect(hasInjection(inj, 'ui-doc')).toBe(false);
    // visual-source-authority is a static policy — independent of documents
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
      intent: 'create-code',
      jobMode: 'generate',
      tech: { language: 'typescript' },
      hasExplicitFields: true,
    };

    const inj = getInjections(mc, ctx, rac);
    expect(hasInjection(inj, 'design-doc')).toBe(false);
    expect(hasInjection(inj, 'prd-spec')).toBe(false);
    expect(inj).toContain('common/injections/action-context');
  });

  // ============================================
  // C2: Explicit + RAC.tech → language/environment injection 선택
  // ============================================

  it('uses RAC.tech.language=go and environment=backend for explicit path', () => {
    const ctx = minimalContext();
    const rac: ResolvedActionContext = {
      source: 'explicit',
      intent: 'create-be',
      jobMode: 'generate',
      tech: { language: 'go', environment: 'backend' },
      hasExplicitFields: true,
    };

    const inj = getInjections(mc, ctx, rac);
    expect(hasInjection(inj, 'languages/go/environments/go-api/rules')).toBe(true);
  });

  it('uses RAC.tech.environment=frontend → browser rules', () => {
    const ctx = minimalContext();
    const rac: ResolvedActionContext = {
      source: 'explicit',
      intent: 'create-fe',
      jobMode: 'generate',
      tech: { language: 'typescript', environment: 'frontend' },
      hasExplicitFields: true,
    };

    const inj = getInjections(mc, ctx, rac);
    expect(hasInjection(inj, 'environments/browser/rules')).toBe(true);
  });

  it('uses RAC.tech.environment=fullstack → composite injection', () => {
    const ctx = minimalContext();
    const rac: ResolvedActionContext = {
      source: 'explicit',
      intent: 'create-fullstack',
      jobMode: 'generate',
      tech: { language: 'typescript', environment: 'fullstack' },
      hasExplicitFields: true,
    };

    const inj = getInjections(mc, ctx, rac);
    expect(hasInjection(inj, 'environments/browser/rules')).toBe(true);
    expect(hasInjection(inj, 'environments/node-api/rules')).toBe(true);
    expect(hasInjection(inj, 'environments/fullstack/rules')).toBe(true);
  });

  // ============================================
  // C3: Explicit + jobMode=refactor → behavioral-debugging
  // ============================================

  it('adds behavioral-debugging for explicit refactor', () => {
    const ctx = minimalContext();
    const rac: ResolvedActionContext = {
      source: 'explicit',
      intent: 'refactor-code',
      jobMode: 'refactor',
      tech: { language: 'typescript' },
      hasExplicitFields: true,
    };

    const inj = getInjections(mc, ctx, rac);
    expect(hasInjection(inj, 'behavioral-debugging')).toBe(true);
    expect(inj).toContain('common/injections/refactor-guidance');
  });

  // ============================================
  // C4: Explicit + framework=nextjs → design job nextjs-augmentation
  // ============================================

  it('resolves framework augmentation from RAC.tech.framework for design job', () => {
    const ctx = minimalContext({
      currentTask: { name: 't', type: 'feature', priority: 100, description: 'd', targetFile: 'fe-system-main.md' },
    });
    const rac: ResolvedActionContext = {
      source: 'explicit',
      intent: 'create-fe',
      jobMode: 'generate',
      tech: { language: 'typescript', framework: 'nextjs', environment: 'frontend' },
      hasExplicitFields: true,
    };

    const inj = getInjections(mc, ctx, rac, { job: 'design' });
    expect(inj).toContain('design/phases/execute/injections/nextjs-augmentation');
  });

  it('resolves go-api augmentation from RAC.tech for design job', () => {
    const ctx = minimalContext({
      currentTask: { name: 't', type: 'feature', priority: 100, description: 'd', targetFile: 'be-system-main.md' },
    });
    const rac: ResolvedActionContext = {
      source: 'explicit',
      intent: 'create-be',
      jobMode: 'generate',
      tech: { language: 'go', environment: 'backend' },
      hasExplicitFields: true,
    };

    const inj = getInjections(mc, ctx, rac, { job: 'design' });
    expect(inj).toContain('design/phases/execute/injections/go-api-augmentation');
  });

  // ============================================
  // R1-R3 injection 검증
  // ============================================

  it('adds R1 (action-context) for explicit source', () => {
    const ctx = minimalContext();
    const rac: ResolvedActionContext = {
      source: 'explicit',
      intent: 'create-code',
      jobMode: 'generate',
      tech: { language: 'typescript' },
      hasExplicitFields: true,
    };

    const inj = getInjections(mc, ctx, rac);
    expect(inj).toContain('common/injections/action-context');
  });

  it('adds R2 (basis-guidance) when basis is set', () => {
    const ctx = minimalContext();
    const rac: ResolvedActionContext = {
      source: 'explicit',
      intent: 'create-code',
      jobMode: 'generate',
      tech: { language: 'typescript' },
      basis: 'prd',
      hasExplicitFields: true,
    };

    const inj = getInjections(mc, ctx, rac);
    expect(inj).toContain('common/injections/basis-guidance');
  });

  it('adds R3 (refactor-guidance) when jobMode=refactor regardless of source', () => {
    const ctx = minimalContext();
    const inferRac: ResolvedActionContext = {
      source: 'infer',
      jobMode: 'refactor',
      tech: { language: 'typescript' },
      hasExplicitFields: false,
    };

    const inj = getInjections(mc, ctx, inferRac);
    expect(inj).toContain('common/injections/refactor-guidance');
  });
});

// ============================================
// C5: Infer 경로 regression
// ============================================

describe('ModeController infer path (regression)', () => {
  const mc = new ModeController();

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
      jobMode: 'generate',
      tech: { language: 'typescript' },
      hasExplicitFields: false,
    };

    const inj = getInjections(mc, ctx, rac);
    expect(hasInjection(inj, 'design-doc')).toBe(false);
    expect(hasInjection(inj, 'prd-spec')).toBe(false);
  });

  it('includes action-context and basis-guidance when infer + hasExplicitFields=true (Phase 8: no legacy injections)', () => {
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
      jobMode: 'generate',
      tech: { language: 'typescript' },
      basis: 'prd',
      basisDescription: 'PRD and product requirements',
      hasExplicitFields: true,
    };

    const inj = getInjections(mc, ctx, rac);
    expect(hasInjection(inj, 'design-doc')).toBe(false);
    expect(hasInjection(inj, 'prd-spec')).toBe(false);
    expect(inj).toContain('common/injections/action-context');
    expect(inj).toContain('common/injections/basis-guidance');
  });

  it('does not add action-context when no resolvedAction', () => {
    const ctx = minimalContext();
    const inj = getInjections(mc, ctx, undefined);
    expect(hasInjection(inj, 'action-context')).toBe(false);
  });

  it('falls back to detectLanguage when infer path (ignores RAC.tech)', () => {
    const ctx = minimalContext({
      codebaseProfile: { language: 'Go' },
    });
    const rac: ResolvedActionContext = {
      source: 'infer',
      jobMode: 'generate',
      tech: { language: 'typescript' },
      hasExplicitFields: false,
    };

    const inj = getInjections(mc, ctx, rac);
    expect(hasInjection(inj, 'languages/go/')).toBe(true);
  });
});

// ============================================
// Phase 7: documents[] 일반화 검증
// ============================================

describe('ModeController documents[] generalization (Phase 7)', () => {
  const mc = new ModeController();

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
      jobMode: 'generate',
      tech: { language: 'typescript' },
      hasExplicitFields: false,
      documents: [
        { path: 'system-design', content: 'design content', role: 'ref', label: 'System Design' },
      ],
    };

    const inj = getInjections(mc, ctx, rac);
    expect(hasInjection(inj, 'prd-spec')).toBe(false);
    expect(hasInjection(inj, '/design-doc')).toBe(false);
    expect(inj).toContain('common/injections/action-context');
  });

  it('keeps visual-source-authority as static policy even when documents present', () => {
    const ctx = minimalContext();
    const rac: ResolvedActionContext = {
      source: 'infer',
      jobMode: 'generate',
      tech: { language: 'typescript' },
      hasExplicitFields: false,
      documents: [
        { path: 'system-design', content: 'x', role: 'ref', label: 'System Design' },
      ],
    };

    const inj = getInjections(mc, ctx, rac);
    expect(hasInjection(inj, 'visual-source-authority')).toBe(true);
  });

  it('adds ui-design-policy when documents contain UI path', () => {
    const ctx = minimalContext();
    const rac: ResolvedActionContext = {
      source: 'infer',
      jobMode: 'generate',
      tech: { language: 'typescript', environment: 'frontend' },
      hasExplicitFields: false,
      documents: [
        { path: 'ui-spec', content: 'ui content', role: 'context', label: 'UI Specification' },
      ],
    };

    const inj = getInjections(mc, ctx, rac);
    expect(inj).toContain('common/injections/ui-design-policy');
  });

  it('does NOT add ui-design-policy for backend environment', () => {
    const ctx = minimalContext({
      detectedEnvironment: 'backend',
    } as any);
    const rac: ResolvedActionContext = {
      source: 'infer',
      jobMode: 'generate',
      tech: { language: 'typescript' },
      hasExplicitFields: false,
      documents: [
        { path: 'ui-spec', content: 'ui content', role: 'context', label: 'UI Specification' },
      ],
    };

    const inj = getInjections(mc, ctx, rac);
    expect(hasInjection(inj, 'ui-design-policy')).toBe(false);
  });

  it('detectFrameworkAugmentation reads from documents[] content', () => {
    const ctx = minimalContext({
      documents: [
        { path: 'prd', content: 'Build a Next.js SSR application with app router', role: 'context' as const },
      ],
      currentTask: { name: 't', type: 'feature', priority: 100, description: 'd', targetFile: 'fe-system-main.md' },
    });

    const inj = getInjections(mc, ctx, undefined, { job: 'design' });
    expect(inj).toContain('design/phases/execute/injections/nextjs-augmentation');
  });
});
