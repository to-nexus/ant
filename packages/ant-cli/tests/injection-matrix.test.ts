import { describe, it, expect } from 'vitest';
import { ModeController } from '../src/core/prompt/engine/ModeController';
import type { AssembledContext } from '../src/core/prompt/engine/ContextAssembler';
import type { ResolvedActionContext, ResolvedDocument } from '@ant/shared';
import { INTENT_DEFINITIONS } from '@ant/shared';

const mc = new ModeController();

const CODE_INTENTS = INTENT_DEFINITIONS.filter(d => d.intentGroup === 'code');
const DESIGN_INTENTS = INTENT_DEFINITIONS.filter(d => d.intentGroup === 'design-system');

const ENVIRONMENTS = ['frontend', 'backend', 'fullstack'] as const;
const TASK_TYPES = ['feature', 'setup', 'verification', 'error', 'test-code', 'doc'] as const;

const sampleDocs: ResolvedDocument[] = [
  { path: 'system-design', content: 'System design content', role: 'ref', label: 'System Design' },
  { path: 'prd', content: 'PRD content', role: 'context', label: 'PRD Specification' },
];

const sampleDocsWithUi: ResolvedDocument[] = [
  ...sampleDocs,
  { path: 'ui-spec', content: 'UI spec content', role: 'context', label: 'UI Specification' },
];

function buildContext(env: string, docs?: ResolvedDocument[]): AssembledContext {
  return {
    referenceCodeContexts: [],
    documents: docs,
    codebaseProfile: { language: env === 'backend' ? 'Go' : 'TypeScript' },
    stats: {
      hasDirective: true,
      hasDesign: (docs?.length ?? 0) > 0,
      hasProjectCode: false,
      hasReferenceCode: false,
      hasMemory: false,
      hasSessionHistory: false,
      codebaseDetected: true,
      hasMissingDependency: false,
    },
    detectedEnvironment: env,
  } as any;
}

function buildRAC(intentId: string, env: string, docs?: ResolvedDocument[]): ResolvedActionContext {
  const langMap: Record<string, string> = { frontend: 'typescript', backend: 'go', fullstack: 'typescript' };
  return {
    source: 'explicit',
    intent: intentId,
    mode: intentId === 'rev-code' ? 'refactor' as const : 'generate' as const,
    tech: { language: langMap[env], environment: env },
    hasExplicitFields: true,
    documents: docs,
  };
}

function getInjections(
  job: 'code' | 'design',
  ctx: AssembledContext,
  rac: ResolvedActionContext,
  taskType: string,
): string[] {
  return mc.determineMode(job, 'execute', ctx, undefined, taskType, rac).templates.injections;
}

function has(inj: string[], sub: string): boolean {
  return inj.some(i => i.includes(sub));
}

describe('Injection Matrix: Code Job (intent x env x docs x taskType)', () => {
  for (const intent of CODE_INTENTS) {
    for (const env of ENVIRONMENTS) {
      for (const hasDocs of [true, false] as const) {
        for (const taskType of TASK_TYPES) {
          const label = `${intent.id} | ${env} | docs=${hasDocs} | ${taskType}`;
          const docs = hasDocs ? sampleDocs : undefined;

          it(label, () => {
            const ctx = buildContext(env, docs);
            const rac = buildRAC(intent.id, env, docs);
            const inj = getInjections('code', ctx, rac, taskType);

            expect(has(inj, 'prd-spec')).toBe(false);
            expect(has(inj, '/design-doc')).toBe(false);
            expect(has(inj, 'ui-doc')).toBe(false);

            const isSkipStatic = taskType === 'verification' || taskType === 'test-code' || taskType === 'doc';
            if (!isSkipStatic && env !== 'backend') {
              expect(has(inj, 'visual-source-authority')).toBe(true);
            }
            if (isSkipStatic) {
              expect(has(inj, 'visual-source-authority')).toBe(false);
            }

            if (hasDocs || rac.source === 'explicit' || rac.hasExplicitFields) {
              expect(has(inj, 'action-context')).toBe(true);
            }

            expect(inj).toMatchSnapshot();
          });
        }
      }
    }
  }
});

describe('Injection Matrix: Design Job (intent x env)', () => {
  for (const intent of DESIGN_INTENTS) {
    for (const env of ENVIRONMENTS) {
      const label = `${intent.id} | ${env}`;

      it(label, () => {
        const docs = sampleDocs;
        const ctx = buildContext(env, docs);
        const rac = buildRAC(intent.id, env, docs);
        const inj = getInjections('design', ctx, rac, 'feature');

        expect(has(inj, 'prd-spec')).toBe(false);
        expect(has(inj, '/design-doc')).toBe(false);

        expect(inj).toMatchSnapshot();
      });
    }
  }
});

describe('Injection Matrix: ui-design-policy edge cases', () => {
  it('ui-design-policy included when documents contain ui- path', () => {
    const ctx = buildContext('frontend', sampleDocsWithUi);
    const rac = buildRAC('gen-code-sys', 'frontend', sampleDocsWithUi);
    const inj = getInjections('code', ctx, rac, 'feature');
    expect(has(inj, 'ui-design-policy')).toBe(true);
  });

  it('ui-design-policy excluded for backend env even with ui docs', () => {
    const ctx = buildContext('backend', sampleDocsWithUi);
    (ctx as any).detectedEnvironment = 'backend';
    const rac = buildRAC('gen-code-sys', 'backend', sampleDocsWithUi);
    const inj = getInjections('code', ctx, rac, 'feature');
    expect(has(inj, 'ui-design-policy')).toBe(false);
  });

  it('ui-design-policy excluded for verification taskType (skipStaticPolicy)', () => {
    const ctx = buildContext('frontend', sampleDocsWithUi);
    const rac = buildRAC('gen-code-sys', 'frontend', sampleDocsWithUi);
    const inj = getInjections('code', ctx, rac, 'verification');
    expect(has(inj, 'ui-design-policy')).toBe(false);
  });
});
