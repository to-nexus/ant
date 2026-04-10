import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'path';
import { FilePromptAdapter, initPartials } from '../src/periphery/adapters/prompt/FilePromptAdapter';
import { PromptEngine } from '../src/core/prompt/engine/PromptEngine';
import '../src/core/prompt/engine/TemplateComposer';
import type { ResolvedDocument, ResolvedActionContext } from '@ant/shared';

const TEMPLATES_DIR = join(__dirname, '../src/core/prompt/templates');
let engine: PromptEngine;

beforeAll(async () => {
  const adapter = new FilePromptAdapter(TEMPLATES_DIR);
  await initPartials(TEMPLATES_DIR);
  engine = new PromptEngine({ promptPort: adapter, contextLoader: async () => ({}) });
});

const ctx = { project: 'test', featurePath: '/tmp/test', featureFolder: 'test' } as any;

function rac(overrides?: Partial<ResolvedActionContext>): ResolvedActionContext {
  return {
    source: 'infer', jobMode: 'generate', tech: { language: 'typescript', environment: 'frontend' },
    hasExplicitFields: false, ...overrides,
  } as ResolvedActionContext;
}

describe('Template Golden: Execute phase', () => {
  it('Scenario 1: infer + frontend/ts + full documents', async () => {
    const docs: ResolvedDocument[] = [
      { path: 'system-design', content: '# Frontend Design\nNext.js app with SSR', role: 'ref', label: 'System Design' },
      { path: 'prd', content: '# PRD\nBuild a dashboard app', role: 'context', label: 'PRD' },
      { path: 'ui-spec', content: '# UI Spec\nDashboard layout', role: 'context', label: 'UI Specification' },
    ];
    const result = await engine.buildExecutePrompt('code', ctx, {
      directive: 'Build the dashboard', documents: docs,
      resolvedAction: rac({ documents: docs }),
      currentTask: { name: 'Build dashboard', type: 'feature', priority: 200, description: 'Build dashboard' },
    }, undefined, 'feature');

    const text = engine.extractPromptText(result);
    expect(text).toContain('System Design');
    expect(text).toContain('PRD');
    expect(text).toContain('UI Specification');
    expect(result.modeConfig.templates.injections).toMatchSnapshot();
  });

  it('Scenario 2: infer + backend/go + design only', async () => {
    const docs: ResolvedDocument[] = [
      { path: 'be-system-main.md', content: '# Backend: Go API with Gin', role: 'ref', label: 'Backend System Design' },
    ];
    const ctxGo = { ...ctx, codebaseProfile: { language: 'Go' }, detectedEnvironment: 'backend' };
    const result = await engine.buildExecutePrompt('code', ctxGo, {
      directive: 'Build API server', documents: docs,
      resolvedAction: rac({ tech: { language: 'go', environment: 'backend' }, documents: docs }),
      currentTask: { name: 'Build API', type: 'feature', priority: 200, description: 'Build API' },
    }, undefined, 'feature');

    expect(result.modeConfig.templates.injections.some(i => i.includes('go-api'))).toBe(true);
    expect(result.modeConfig.templates.injections).toMatchSnapshot();
  });

  it('Scenario 3: explicit + frontend/ts + documents', async () => {
    const docs: ResolvedDocument[] = [
      { path: 'inputs/sources/spec.md', content: '# Feature Spec', role: 'ref', label: 'Feature Spec' },
    ];
    const result = await engine.buildExecutePrompt('code', ctx, {
      directive: 'Implement feature', documents: docs,
      resolvedAction: rac({ source: 'explicit', hasExplicitFields: true, documents: docs }),
      currentTask: { name: 'Implement', type: 'feature', priority: 200, description: 'Implement' },
    }, undefined, 'feature');

    expect(result.modeConfig.templates.injections).toContain('common/injections/action-context');
    expect(result.modeConfig.templates.injections).toMatchSnapshot();
  });

  it('Scenario 4: infer + no documents, directive only', async () => {
    const result = await engine.buildExecutePrompt('code', ctx, {
      directive: 'Fix the login bug',
      currentTask: { name: 'Fix bug', type: 'feature', priority: 200, description: 'Fix bug' },
    }, undefined, 'feature');

    const inj = result.modeConfig.templates.injections;
    expect(inj.some(i => i.includes('action-context'))).toBe(false);
    expect(inj.some(i => i.includes('design-doc'))).toBe(false);
    expect(inj.some(i => i.includes('prd-spec'))).toBe(false);
    expect(inj).toMatchSnapshot();
  });
});

describe('Template Golden: Execute phase (extended)', () => {
  it('Scenario 8: explicit + refactor mode → refactor-guidance + behavioral-debugging', async () => {
    const docs: ResolvedDocument[] = [
      { path: 'system-design', content: '# Frontend Design\nRefactor the auth flow', role: 'ref', label: 'System Design' },
    ];
    const result = await engine.buildExecutePrompt('code', ctx, {
      directive: 'Refactor authentication module',
      documents: docs,
      resolvedAction: rac({
        source: 'explicit', jobMode: 'refactor', hasExplicitFields: true,
        documents: docs,
      }),
      currentTask: { name: 'Refactor auth', type: 'feature', priority: 200, description: 'Refactor auth' },
    }, 'refactor', 'feature');

    const inj = result.modeConfig.templates.injections;
    expect(inj).toContain('common/injections/refactor-guidance');
    expect(inj).toContain('code/base/injections/behavioral-debugging');
    expect(inj).toContain('common/injections/action-context');
    const text = engine.extractPromptText(result);
    expect(text).toMatchSnapshot();
  });

  it('Scenario 9: error + frontend → preview-setup injected (BUG-1 fix verification)', async () => {
    const ctxFe = { ...ctx, detectedEnvironment: 'frontend' };
    const docs: ResolvedDocument[] = [
      { path: 'spec', content: '# Login Feature\nFix the button click handler', role: 'ref', label: 'Feature Spec' },
    ];
    const result = await engine.buildExecutePrompt('code', ctxFe, {
      directive: 'Error: TypeError: Cannot read property of undefined at handleClick',
      documents: docs,
      resolvedAction: rac({ documents: docs }),
      currentTask: { name: 'Fix error', type: 'error', priority: 500, description: 'Fix TypeError in login' },
    }, undefined, 'error');

    const inj = result.modeConfig.templates.injections;
    expect(inj.some(i => i.includes('preview-setup'))).toBe(true);
    expect(result.modeConfig.templates.base).toContain('error');
    const text = engine.extractPromptText(result);
    expect(text).toMatchSnapshot();
  });

  it('Scenario 10: test-code + backend → test-code hints + backend-safety', async () => {
    const ctxBe = { ...ctx, codebaseProfile: { language: 'TypeScript' }, detectedEnvironment: 'backend' };
    const docs: ResolvedDocument[] = [
      { path: 'be-system-main.md', content: '# Backend System\nExpress API with PostgreSQL', role: 'ref', label: 'Backend Design' },
    ];
    const result = await engine.buildExecutePrompt('code', ctxBe, {
      directive: 'Write unit tests for auth service',
      documents: docs,
      resolvedAction: rac({ tech: { language: 'typescript', environment: 'backend' }, documents: docs }),
      currentTask: { name: 'Test auth', type: 'test-code', priority: 300, description: 'Write tests' },
    }, undefined, 'test-code');

    const inj = result.modeConfig.templates.injections;
    expect(inj.some(i => i.includes('test-code/languages/typescript/hints'))).toBe(true);
    expect(inj.some(i => i.includes('backend-safety'))).toBe(true);
    expect(result.modeConfig.templates.base).toContain('test-code');
    const text = engine.extractPromptText(result);
    expect(text).toMatchSnapshot();
  });
});

describe('Template Golden: Design job', () => {
  it('Scenario 5: design job + system-design + documents', async () => {
    const docs: ResolvedDocument[] = [
      { path: 'source-docs', content: '# PRD for design job', role: 'context', label: 'PRD Specification' },
    ];
    const result = await engine.buildExecutePrompt('design', ctx, {
      directive: 'Design the backend',
      documents: docs,
      resolvedAction: rac({ documents: docs }),
      currentTask: { name: 'Design BE', type: 'feature', priority: 200, description: 'Design backend', targetFile: 'be-system-main.md' } as any,
    }, undefined, undefined);

    expect(result.modeConfig.templates.base).toBe('design/phases/execute/base-system-design');
    expect(result.modeConfig.templates.injections).toMatchSnapshot();
  });
});

describe('Template Golden: Design job (extended)', () => {
  it('Scenario 11: design execute: create-fullstack + api-contract-guide', async () => {
    const docs: ResolvedDocument[] = [
      { path: 'source-docs', content: '# PRD\nBuild fullstack app with REST API', role: 'context', label: 'PRD Specification' },
    ];
    const ctxFs = { ...ctx, codebaseProfile: { language: 'TypeScript', framework: 'Next.js' } };
    const result = await engine.buildExecutePrompt('design', ctxFs, {
      directive: 'Design the API contract',
      documents: docs,
      resolvedAction: rac({ documents: docs }),
      currentTask: {
        name: 'Design API', type: 'feature', priority: 200,
        description: 'Design API contract', targetFile: 'api-contract-main.md',
      } as any,
    }, undefined, undefined);

    const inj = result.modeConfig.templates.injections;
    expect(inj.some(i => i.includes('api-contract-guide'))).toBe(true);
    expect(result.modeConfig.templates.base).toBe('design/phases/execute/base-system-design');
    const text = engine.extractPromptText(result);
    expect(text).toMatchSnapshot();
  });
});

describe('Template Golden: Plan phase', () => {
  it('Scenario 6: plan phase + documents', async () => {
    const docs: ResolvedDocument[] = [
      { path: 'system-design', content: '# System Design', role: 'ref', label: 'Design Specification' },
    ];
    const rendered = await engine.buildTaskPlanPrompt(
      { id: 't1', name: 'Setup', description: 'Setup project', type: 'setup' },
      'Build an app', docs, { files: [], stats: { filesLoaded: 0, estimatedTokens: 0 } },
    );
    expect(rendered).toContain('Design Specification');
    expect(rendered).toMatchSnapshot();
  });
});

describe('Template Golden: Verification plan', () => {
  it('Scenario 12: verification task → buildVerificationPlanPrompt full text', async () => {
    const task = { id: 'v1', name: 'Verify build', description: 'Run build and fix errors', type: 'verification' };
    const codeContext = {
      files: [
        { path: 'src/App.tsx', content: 'export default App' },
        { path: 'src/index.ts', content: 'import App from "./App"' },
      ],
      directoryTree: 'src/\n  App.tsx\n  index.ts',
      stats: { filesLoaded: 2, estimatedTokens: 100 },
    };
    const rendered = await engine.buildVerificationPlanPrompt(
      task, 'Build the app', codeContext, undefined,
      { hasTools: true }, { language: 'TypeScript' }, undefined,
    );

    expect(rendered).toContain('Diagnostic Plan');
    expect(rendered).toContain('Verify Build');
    expect(rendered).toContain('Retrieved Files');
    expect(rendered).toMatchSnapshot();
  });
});

describe('Template Golden: Decompose phase', () => {
  it('Scenario 7: decompose + documents', async () => {
    const docs: ResolvedDocument[] = [
      { path: 'fe-system-main.md', content: '# Frontend System', role: 'ref', label: 'Frontend System Design: main' },
      { path: 'be-system-main.md', content: '# Backend System', role: 'ref', label: 'Backend System Design: main' },
    ];
    const result = await engine.buildDecomposePrompt({
      directive: 'Build fullstack app',
      designDoc: '',
      hasDesignDoc: false,
      documents: docs,
      hasDocuments: true,
      mode: 'generate',
      profile: { language: 'TypeScript', framework: 'Next.js' },
    });
    expect(result.user).toContain('Frontend System Design');
    expect(result.user).toContain('Backend System Design');
    expect(result.user).not.toContain('{{designDoc}}');
  });
});
