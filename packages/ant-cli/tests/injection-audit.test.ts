/**
 * Audit 1: ModeController Full-Axis Matrix
 *
 * Verifies injection lists for all axis combinations:
 * 1A. Orthogonal matrix: source × env × taskType × docs (162 cases)
 * 1B. Language × Environment cross (5 cases)
 * 1C. Context flags individual toggle
 * 1C-2. TaskType-specific injection matrix
 * 1D. Design job (framework augmentation + targetFile)
 *
 * execute phase ONLY (plan phase does NOT use ModeController — BUG-2).
 */
import { describe, it, expect } from 'vitest';
import { ModeController } from '../src/core/prompt/engine/ModeController';
import type { AssembledContext } from '../src/core/prompt/engine/ContextAssembler';
import type { ResolvedActionContext, ResolvedDocument } from '@ant/shared';

const mc = new ModeController();

// ============================================
// Helpers
// ============================================

const sampleDocs: ResolvedDocument[] = [
  { path: 'system-design', content: 'System design content', role: 'ref', label: 'System Design' },
  { path: 'prd', content: 'PRD content', role: 'context', label: 'PRD Specification' },
];

const sampleDocsWithUi: ResolvedDocument[] = [
  ...sampleDocs,
  { path: 'ui-spec', content: 'UI spec content', role: 'context', label: 'UI Specification' },
];

type SourceType = 'explicit' | 'infer' | 'none';
type EnvType = 'frontend' | 'backend' | 'fullstack';
type TaskType = 'feature' | 'setup' | 'verification' | 'error' | 'test-code' | 'doc';
type DocCombo = 'none' | 'design-only' | 'full';

function buildContext(env: EnvType, docs: DocCombo, overrides?: Partial<AssembledContext>): AssembledContext {
  const docList = docs === 'none' ? undefined : docs === 'design-only' ? [sampleDocs[0]] : sampleDocsWithUi;
  const langMap: Record<EnvType, string> = { frontend: 'TypeScript', backend: 'Go', fullstack: 'TypeScript' };
  return {
    referenceCodeContexts: [],
    documents: docList,
    codebaseProfile: { language: langMap[env] },
    stats: {
      hasDirective: true,
      hasDesign: (docList?.length ?? 0) > 0,
      hasProjectCode: false,
      hasReferenceCode: false,
      hasMemory: false,
      hasSessionHistory: false,
      codebaseDetected: true,
      hasMissingDependency: false,
    },
    detectedEnvironment: env,
    ...overrides,
  } as any;
}

function buildRAC(source: SourceType, env: EnvType, docs: DocCombo): ResolvedActionContext | undefined {
  if (source === 'none') return undefined;
  const langMap: Record<EnvType, string> = { frontend: 'typescript', backend: 'go', fullstack: 'typescript' };
  const docList = docs === 'none' ? undefined : docs === 'design-only' ? [sampleDocs[0]] : sampleDocsWithUi;
  return {
    source: source as 'explicit' | 'infer',
    intent: source === 'explicit' ? 'create-code' : undefined,
    jobMode: 'generate',
    tech: source === 'explicit' ? { language: langMap[env] as any, environment: env } : {},
    hasExplicitFields: source === 'explicit',
    documents: docList,
  };
}

function getInjections(
  job: 'code' | 'design',
  ctx: AssembledContext,
  rac: ResolvedActionContext | undefined,
  taskType: string,
): string[] {
  return mc.determineMode(job, 'execute', ctx, undefined, taskType, rac).templates.injections;
}

function has(inj: string[], sub: string): boolean {
  return inj.some(i => i.includes(sub));
}

// ============================================
// 1A. Orthogonal Matrix (source × env × taskType × docs)
// ============================================

const SOURCES: SourceType[] = ['explicit', 'infer', 'none'];
const ENVS: EnvType[] = ['frontend', 'backend', 'fullstack'];
const TASK_TYPES: TaskType[] = ['feature', 'setup', 'verification', 'error', 'test-code', 'doc'];
const DOC_COMBOS: DocCombo[] = ['none', 'design-only', 'full'];

describe('Audit 1A: Orthogonal matrix (source × env × taskType × docs)', () => {
  for (const source of SOURCES) {
    for (const env of ENVS) {
      for (const taskType of TASK_TYPES) {
        for (const docs of DOC_COMBOS) {
          const label = `${source} | ${env} | ${taskType} | docs=${docs}`;
          it(label, () => {
            const ctx = buildContext(env, docs);
            const rac = buildRAC(source, env, docs);
            const inj = getInjections('code', ctx, rac, taskType);

            // Legacy injection absence (universal invariant)
            expect(has(inj, 'prd-spec')).toBe(false);
            expect(has(inj, '/design-doc')).toBe(false);
            expect(has(inj, 'ui-doc')).toBe(false);

            // Snapshot for regression
            expect(inj).toMatchSnapshot();
          });
        }
      }
    }
  }
});

// ============================================
// 1B. Language × Environment Cross
// ============================================

describe('Audit 1B: Language × Environment cross', () => {
  const LANG_ENV_PAIRS: Array<{
    lang: string;
    env: EnvType;
    expectedIncludes: string[];
    expectedExcludes?: string[];
  }> = [
    {
      lang: 'TypeScript', env: 'frontend',
      expectedIncludes: ['typescript/environments/browser/rules'],
    },
    {
      lang: 'TypeScript', env: 'backend',
      expectedIncludes: ['typescript/environments/node-api/rules'],
    },
    {
      lang: 'Go', env: 'backend',
      expectedIncludes: ['go/environments/go-api/rules'],
    },
    {
      lang: 'Go', env: 'fullstack',
      expectedIncludes: ['go/environments/browser/rules', 'go/environments/go-api/rules', 'go/environments/fullstack/rules'],
    },
    {
      lang: 'TypeScript', env: 'fullstack',
      expectedIncludes: ['typescript/environments/browser/rules', 'typescript/environments/node-api/rules', 'typescript/environments/fullstack/rules'],
    },
  ];

  for (const { lang, env, expectedIncludes, expectedExcludes } of LANG_ENV_PAIRS) {
    it(`${lang} + ${env} → correct environment rules`, () => {
      const ctx = buildContext(env, 'design-only', {
        codebaseProfile: { language: lang },
      });
      const rac: ResolvedActionContext = {
        source: 'explicit',
        jobMode: 'generate',
        tech: { language: lang.toLowerCase() as any, environment: env },
        hasExplicitFields: true,
        documents: sampleDocs,
      };
      const inj = getInjections('code', ctx, rac, 'feature');

      for (const expected of expectedIncludes) {
        expect(has(inj, expected)).toBe(true);
      }
      if (expectedExcludes) {
        for (const excluded of expectedExcludes) {
          expect(has(inj, excluded)).toBe(false);
        }
      }
    });
  }
});

// ============================================
// 1C. Context Flags Individual Toggle
// ============================================

describe('Audit 1C: Context flags toggle', () => {
  function baseCtx(overrides?: any): AssembledContext {
    return buildContext('frontend', 'design-only', overrides);
  }

  function baseRAC(): ResolvedActionContext {
    return {
      source: 'explicit',
      jobMode: 'generate',
      tech: { language: 'typescript', environment: 'frontend' },
      hasExplicitFields: true,
      documents: sampleDocs,
    };
  }

  it('retryContext ON → retry-context injection', () => {
    const ctx = baseCtx({ retryContext: { attemptNumber: 2, currentError: 'err' } });
    const inj = getInjections('code', ctx, baseRAC(), 'feature');
    expect(has(inj, 'retry-context')).toBe(true);
  });

  it('retryContext OFF → no retry-context', () => {
    const ctx = baseCtx({ retryContext: null });
    const inj = getInjections('code', ctx, baseRAC(), 'feature');
    expect(has(inj, 'retry-context')).toBe(false);
  });

  it('lessons ON → lessons injection', () => {
    const ctx = baseCtx({ lessons: [{ content: 'lesson', score: 0.9, relatedFiles: [], tags: [], timestamp: '' }] });
    const inj = getInjections('code', ctx, baseRAC(), 'feature');
    expect(has(inj, 'lessons')).toBe(true);
  });

  it('lessons OFF → no lessons', () => {
    const ctx = baseCtx({ lessons: [] });
    const inj = getInjections('code', ctx, baseRAC(), 'feature');
    expect(has(inj, 'lessons')).toBe(false);
  });

  it('sessionContext ON (totalRuns > 0) → session-context injection', () => {
    const ctx = baseCtx({ sessionContext: { totalRuns: 1, currentRun: 1, recentRuns: [], currentMode: 'generate', windowSize: 5, compressionRatio: 0.5 } });
    const inj = getInjections('code', ctx, baseRAC(), 'feature');
    expect(has(inj, 'session-context')).toBe(true);
  });

  it('sessionContext OFF (totalRuns=0) → no session-context', () => {
    const ctx = baseCtx({ sessionContext: { totalRuns: 0, currentRun: 0, recentRuns: [], currentMode: 'generate', windowSize: 5, compressionRatio: 0.5 } });
    const inj = getInjections('code', ctx, baseRAC(), 'feature');
    expect(has(inj, 'session-context')).toBe(false);
  });

  it('basis ON → basis-guidance injection', () => {
    const rac = { ...baseRAC(), basis: 'prd' as const };
    const inj = getInjections('code', baseCtx(), rac, 'feature');
    expect(has(inj, 'basis-guidance')).toBe(true);
  });

  it('basis OFF → no basis-guidance', () => {
    const rac = { ...baseRAC(), basis: undefined };
    const inj = getInjections('code', baseCtx(), rac, 'feature');
    expect(has(inj, 'basis-guidance')).toBe(false);
  });

  it('refactor-explicit → both refactor-guidance and behavioral-debugging', () => {
    const rac: ResolvedActionContext = {
      source: 'explicit',
      jobMode: 'refactor',
      tech: { language: 'typescript', environment: 'frontend' },
      hasExplicitFields: true,
      documents: sampleDocs,
    };
    const inj = getInjections('code', baseCtx(), rac, 'feature');
    expect(has(inj, 'refactor-guidance')).toBe(true);
    expect(has(inj, 'behavioral-debugging')).toBe(true);
  });

  it('refactor-infer with explicit mode → behavioral-debugging', () => {
    const rac: ResolvedActionContext = {
      source: 'infer',
      jobMode: 'refactor',
      tech: {},
      hasExplicitFields: false,
    };
    const inj = mc.determineMode('code', 'execute', baseCtx(), 'refactor', 'feature', rac).templates.injections;
    expect(has(inj, 'refactor-guidance')).toBe(true);
    expect(has(inj, 'behavioral-debugging')).toBe(true);
  });

  it('runtimeError directive → runtime-error-fix injection', () => {
    const ctx = baseCtx({ directive: 'TypeError: x is not a function\n  at module.js:10' });
    const inj = getInjections('code', ctx, baseRAC(), 'feature');
    expect(has(inj, 'runtime-error-fix')).toBe(true);
  });

  it('no runtime error in directive → no runtime-error-fix', () => {
    const ctx = baseCtx({ directive: 'Add a new button component' });
    const inj = getInjections('code', ctx, baseRAC(), 'feature');
    expect(has(inj, 'runtime-error-fix')).toBe(false);
  });

  it('hasMissingDependency → missing-dependency-fix injection', () => {
    const ctx = baseCtx({
      stats: {
        hasDirective: true, hasDesign: true, hasProjectCode: false,
        hasReferenceCode: false, hasMemory: false, hasSessionHistory: false,
        codebaseDetected: true, hasMissingDependency: true,
      },
    });
    const inj = getInjections('code', ctx, baseRAC(), 'feature');
    expect(has(inj, 'missing-dependency-fix')).toBe(true);
  });

  it('hasMemory → memory injection', () => {
    const ctx = baseCtx({
      memory: 'some memory',
      stats: {
        hasDirective: true, hasDesign: true, hasProjectCode: false,
        hasReferenceCode: false, hasMemory: true, hasSessionHistory: false,
        codebaseDetected: true, hasMissingDependency: false,
      },
    });
    const inj = getInjections('code', ctx, baseRAC(), 'feature');
    expect(has(inj, 'memory')).toBe(true);
  });

  it('hasDirective → directive injection', () => {
    const ctx = baseCtx();
    const inj = getInjections('code', ctx, baseRAC(), 'feature');
    expect(has(inj, 'directive')).toBe(true);
  });

  it('uiInDocs → ui-design-policy for non-backend', () => {
    const docsWithUi: ResolvedDocument[] = [
      { path: 'ui-spec', content: 'UI', role: 'context' },
    ];
    const rac = { ...baseRAC(), documents: docsWithUi };
    const inj = getInjections('code', baseCtx(), rac, 'feature');
    expect(has(inj, 'ui-design-policy')).toBe(true);
  });

  it('gitDiff → git-diff injection', () => {
    const ctx = baseCtx({
      projectCodeContext: { gitDiff: 'diff --git a/file.ts b/file.ts\n+added line', files: [], filePaths: [] },
    });
    const inj = getInjections('code', ctx, baseRAC(), 'feature');
    expect(has(inj, 'git-diff')).toBe(true);
  });

  it('projectCodeContext files → retrieved-code injection', () => {
    const ctx = baseCtx({
      projectCodeContext: { files: [{ path: 'src/main.ts', content: 'code' }], filePaths: ['src/main.ts'] },
    });
    const inj = getInjections('code', ctx, baseRAC(), 'feature');
    expect(has(inj, 'retrieved-code')).toBe(true);
  });

  it('referenceCodeContexts → reference-code injection', () => {
    const ctx = baseCtx({
      referenceCodeContexts: [{ project: 'ref', files: [{ path: 'a.ts', content: 'c' }] }],
    });
    const inj = getInjections('code', ctx, baseRAC(), 'feature');
    expect(has(inj, 'reference-code')).toBe(true);
  });
});

// ============================================
// 1C-2. TaskType-specific injection matrix
// ============================================

describe('Audit 1C-2: TaskType-specific injection matrix', () => {
  function featureCtx(): AssembledContext {
    return buildContext('frontend', 'full');
  }
  function backendCtx(): AssembledContext {
    return buildContext('backend', 'full');
  }

  function featureRAC(): ResolvedActionContext {
    return {
      source: 'explicit', jobMode: 'generate',
      tech: { language: 'typescript', environment: 'frontend' },
      hasExplicitFields: true, documents: sampleDocsWithUi,
    };
  }
  function backendRAC(): ResolvedActionContext {
    return {
      source: 'explicit', jobMode: 'generate',
      tech: { language: 'go', environment: 'backend' },
      hasExplicitFields: true, documents: sampleDocs,
    };
  }

  const MATRIX: Array<{
    taskType: TaskType;
    expect: {
      previewEnvContract: boolean;
      portMgmt: boolean;
      toolCalling: boolean;
      testHints: boolean;
    };
  }> = [
    { taskType: 'feature',      expect: { previewEnvContract: true,  portMgmt: true,  toolCalling: true,  testHints: false } },
    { taskType: 'setup',        expect: { previewEnvContract: true,  portMgmt: true,  toolCalling: true,  testHints: false } },
    { taskType: 'verification', expect: { previewEnvContract: true,  portMgmt: true,  toolCalling: false, testHints: false } },
    { taskType: 'error',        expect: { previewEnvContract: true,  portMgmt: true,  toolCalling: false, testHints: false } },
    { taskType: 'test-code',    expect: { previewEnvContract: false, portMgmt: false, toolCalling: false, testHints: true  } },
    { taskType: 'doc',          expect: { previewEnvContract: false, portMgmt: false, toolCalling: false, testHints: false } },
  ];

  for (const { taskType, expect: expected } of MATRIX) {
    describe(`taskType=${taskType}`, () => {
      it(`preview-env-contract: ${expected.previewEnvContract}`, () => {
        const inj = getInjections('code', featureCtx(), featureRAC(), taskType);
        expect(has(inj, 'preview-env-contract')).toBe(expected.previewEnvContract);
      });

      it(`port-management: ${expected.portMgmt}`, () => {
        const inj = getInjections('code', featureCtx(), featureRAC(), taskType);
        expect(has(inj, 'port-management')).toBe(expected.portMgmt);
      });

      it(`tool-calling-rules-compact: ${expected.toolCalling}`, () => {
        const inj = getInjections('code', featureCtx(), featureRAC(), taskType);
        expect(has(inj, 'tool-calling-rules-compact')).toBe(expected.toolCalling);
      });

      it(`test-code hints: ${expected.testHints}`, () => {
        const inj = getInjections('code', featureCtx(), featureRAC(), taskType);
        expect(has(inj, 'test-code/languages')).toBe(expected.testHints);
      });
    });
  }

  describe('backend-safety: only for backend/fullstack, not for verification/doc', () => {
    it('feature + backend → backend-safety', () => {
      const inj = getInjections('code', backendCtx(), backendRAC(), 'feature');
      expect(has(inj, 'backend-safety')).toBe(true);
    });

    it('feature + frontend → no backend-safety', () => {
      const inj = getInjections('code', featureCtx(), featureRAC(), 'feature');
      expect(has(inj, 'backend-safety')).toBe(false);
    });

    it('error + backend → backend-safety', () => {
      const inj = getInjections('code', backendCtx(), backendRAC(), 'error');
      expect(has(inj, 'backend-safety')).toBe(true);
    });

    it('test-code + backend → backend-safety', () => {
      const inj = getInjections('code', backendCtx(), backendRAC(), 'test-code');
      expect(has(inj, 'backend-safety')).toBe(true);
    });

    it('verification + backend → no backend-safety', () => {
      const inj = getInjections('code', backendCtx(), backendRAC(), 'verification');
      expect(has(inj, 'backend-safety')).toBe(false);
    });

    it('doc + backend → no backend-safety', () => {
      const inj = getInjections('code', backendCtx(), backendRAC(), 'doc');
      expect(has(inj, 'backend-safety')).toBe(false);
    });
  });

  describe('env rules: only for feature/setup', () => {
    for (const taskType of TASK_TYPES) {
      const shouldHaveEnvRules = taskType === 'feature' || taskType === 'setup';
      it(`${taskType} → env rules ${shouldHaveEnvRules ? 'present' : 'absent'}`, () => {
        const inj = getInjections('code', featureCtx(), featureRAC(), taskType);
        expect(has(inj, 'environments/browser/rules')).toBe(shouldHaveEnvRules);
      });
    }
  });

  describe('preview-setup: feature/setup + browser/fullstack, plus error + browser/fullstack (BUG-1 fix)', () => {
    it('feature + frontend → preview-setup', () => {
      const inj = getInjections('code', featureCtx(), featureRAC(), 'feature');
      expect(has(inj, 'preview-setup')).toBe(true);
    });

    it('error + frontend → preview-setup (BUG-1 fix verified)', () => {
      const inj = getInjections('code', featureCtx(), featureRAC(), 'error');
      expect(has(inj, 'preview-setup')).toBe(true);
    });

    it('error + backend → no preview-setup', () => {
      const inj = getInjections('code', backendCtx(), backendRAC(), 'error');
      expect(has(inj, 'preview-setup')).toBe(false);
    });

    it('verification + frontend → no preview-setup', () => {
      const inj = getInjections('code', featureCtx(), featureRAC(), 'verification');
      expect(has(inj, 'preview-setup')).toBe(false);
    });

    it('test-code + frontend → no preview-setup', () => {
      const inj = getInjections('code', featureCtx(), featureRAC(), 'test-code');
      expect(has(inj, 'preview-setup')).toBe(false);
    });

    it('doc + frontend → no preview-setup', () => {
      const inj = getInjections('code', featureCtx(), featureRAC(), 'doc');
      expect(has(inj, 'preview-setup')).toBe(false);
    });
  });

  describe('visual-source-authority: feature/setup in non-backend, not skip-static-policy tasks', () => {
    it('feature + frontend → visual-source-authority', () => {
      const inj = getInjections('code', featureCtx(), featureRAC(), 'feature');
      expect(has(inj, 'visual-source-authority')).toBe(true);
    });

    it('feature + backend → no visual-source-authority', () => {
      const inj = getInjections('code', backendCtx(), backendRAC(), 'feature');
      expect(has(inj, 'visual-source-authority')).toBe(false);
    });

    it('verification → no visual-source-authority', () => {
      const inj = getInjections('code', featureCtx(), featureRAC(), 'verification');
      expect(has(inj, 'visual-source-authority')).toBe(false);
    });

    it('test-code → no visual-source-authority', () => {
      const inj = getInjections('code', featureCtx(), featureRAC(), 'test-code');
      expect(has(inj, 'visual-source-authority')).toBe(false);
    });

    it('doc → no visual-source-authority', () => {
      const inj = getInjections('code', featureCtx(), featureRAC(), 'doc');
      expect(has(inj, 'visual-source-authority')).toBe(false);
    });

    it('error + frontend → visual-source-authority (not skipStaticPolicy)', () => {
      const inj = getInjections('code', featureCtx(), featureRAC(), 'error');
      expect(has(inj, 'visual-source-authority')).toBe(true);
    });
  });
});

// ============================================
// 1D. Design Job (framework augmentation + targetFile)
// ============================================

describe('Audit 1D: Design job — framework augmentation + targetFile', () => {
  function designCtx(overrides?: Partial<AssembledContext>): AssembledContext {
    return {
      referenceCodeContexts: [],
      documents: sampleDocs,
      codebaseProfile: { language: 'TypeScript', framework: 'Next.js' },
      stats: {
        hasDirective: true, hasDesign: true, hasProjectCode: false,
        hasReferenceCode: false, hasMemory: false, hasSessionHistory: false,
        codebaseDetected: true, hasMissingDependency: false,
      },
      detectedEnvironment: 'frontend',
      ...overrides,
    } as any;
  }

  function designRAC(): ResolvedActionContext {
    return {
      source: 'explicit', jobMode: 'generate',
      tech: { language: 'typescript', environment: 'frontend', framework: 'nextjs' },
      hasExplicitFields: true, documents: sampleDocs,
    };
  }

  it('fe-system-main.md + Next.js profile → frontend-guide + nextjs-augmentation', () => {
    const ctx = designCtx({ currentTask: { name: 't', type: 'feature', priority: 1, description: 'd', targetFile: 'fe-system-main.md' } });
    const inj = getInjections('design', ctx, designRAC(), 'feature');
    expect(has(inj, 'frontend-guide')).toBe(true);
    expect(has(inj, 'nextjs-augmentation')).toBe(true);
  });

  it('be-system-main.md + Go → backend-guide + go-api-augmentation', () => {
    const ctx = designCtx({
      currentTask: { name: 't', type: 'feature', priority: 1, description: 'd', targetFile: 'be-system-main.md' },
      codebaseProfile: { language: 'Go' },
      detectedEnvironment: 'backend',
    });
    const rac: ResolvedActionContext = {
      source: 'explicit', jobMode: 'generate',
      tech: { language: 'go', environment: 'backend' },
      hasExplicitFields: true, documents: sampleDocs,
    };
    const inj = getInjections('design', ctx, rac, 'feature');
    expect(has(inj, 'backend-guide')).toBe(true);
    expect(has(inj, 'go-api-augmentation')).toBe(true);
  });

  it('api-contract-main.md → api-contract-guide', () => {
    const ctx = designCtx({ currentTask: { name: 't', type: 'feature', priority: 1, description: 'd', targetFile: 'api-contract-main.md' } });
    const inj = getInjections('design', ctx, designRAC(), 'feature');
    expect(has(inj, 'api-contract-guide')).toBe(true);
  });

  it('design domain=game → game-domain-guide', () => {
    const ctx = designCtx({ designDomain: 'game' });
    const inj = getInjections('design', ctx, designRAC(), 'feature');
    expect(has(inj, 'game-domain-guide')).toBe(true);
    expect(has(inj, 'service-domain-guide')).toBe(false);
  });

  it('design domain=service → service-domain-guide', () => {
    const ctx = designCtx({ designDomain: 'service' });
    const inj = getInjections('design', ctx, designRAC(), 'feature');
    expect(has(inj, 'service-domain-guide')).toBe(true);
    expect(has(inj, 'game-domain-guide')).toBe(false);
  });

  it('document-language always injected for design job', () => {
    const ctx = designCtx();
    const inj = getInjections('design', ctx, designRAC(), 'feature');
    expect(has(inj, 'document-language')).toBe(true);
  });

  it('documents with Next.js keyword + fe-system target → nextjs-augmentation (text-based fallback)', () => {
    const ctx = designCtx({
      currentTask: { name: 't', type: 'feature', priority: 1, description: 'd', targetFile: 'fe-system-main.md' },
      codebaseProfile: { language: 'TypeScript' },
      documents: [{ path: 'doc', content: 'Using Next.js app router for SSR', role: 'ref' as const }],
    });
    const rac: ResolvedActionContext = {
      source: 'infer', jobMode: 'generate', tech: {},
      hasExplicitFields: false,
    };
    const inj = getInjections('design', ctx, rac, 'feature');
    expect(has(inj, 'nextjs-augmentation')).toBe(true);
  });

  it('documents with Go+api keyword + be-system target → go-api-augmentation (text-based fallback)', () => {
    const ctx = designCtx({
      currentTask: { name: 't', type: 'feature', priority: 1, description: 'd', targetFile: 'be-system-main.md' },
      codebaseProfile: { language: 'TypeScript' },
      documents: [{ path: 'doc', content: 'Golang API server with gin framework', role: 'ref' as const }],
      detectedEnvironment: 'backend',
    });
    const rac: ResolvedActionContext = {
      source: 'infer', jobMode: 'generate', tech: {},
      hasExplicitFields: false,
    };
    const inj = getInjections('design', ctx, rac, 'feature');
    expect(has(inj, 'go-api-augmentation')).toBe(true);
  });
});
