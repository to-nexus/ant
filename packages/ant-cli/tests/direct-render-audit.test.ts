/**
 * Audit 4: Direct Render Path Documents Verification
 *
 * Validates direct render paths (non-ModeController):
 * 4A. buildTaskPlanPrompt: planDocs render, resolvedAction.documents NOT rendered
 * 4B. buildVerificationPlanPrompt / buildErrorPlanPrompt: no documents render
 * 4C. buildDecomposePrompt: design-doc-guide {{#each documents}} render
 * 4D. buildDetectEnvironmentPrompt / buildDesignDomainPrompt: detect/base {{#each documents}}
 */
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
  engine = new PromptEngine({
    promptPort: adapter,
    contextLoader: async () => ({}),
  });
});

const sampleDesignDoc: ResolvedDocument = {
  path: 'system-design', content: '# Frontend System Design\nReact + Next.js app', role: 'ref', label: 'Design Specification',
};

const sampleUiDoc: ResolvedDocument = {
  path: 'ui-spec', content: '# UI Specification\nTokens and layout', role: 'context', label: 'UI Specification',
};

const samplePrdDoc: ResolvedDocument = {
  path: 'prd', content: '# PRD\nProduct requirements', role: 'context', label: 'PRD Specification',
};

// ============================================
// 4A. buildTaskPlanPrompt
// ============================================

describe('Audit 4A: buildTaskPlanPrompt', () => {
  const task = { id: 'task-1', name: 'Build feature', description: 'Build the main feature', type: 'feature' };
  const codeCtx = { files: [{ path: 'src/main.ts', content: 'export const main = () => {}' }], filePaths: ['src/main.ts'] };

  it('renders planDocs (designDoc + uiDoc)', async () => {
    const planDocs = [sampleDesignDoc, sampleUiDoc];
    const prompt = await engine.buildTaskPlanPrompt(task, 'Build the app', planDocs, codeCtx);

    expect(prompt).toContain('Frontend System Design');
    expect(prompt).toContain('UI Specification');
  });

  it('renders planDocs with spec-driven label', async () => {
    const specDoc: ResolvedDocument = {
      path: 'system-design', content: '# Feature Spec', role: 'ref', label: 'Feature Specification',
    };
    const prompt = await engine.buildTaskPlanPrompt(task, 'Build it', [specDoc], codeCtx, undefined, undefined, undefined, undefined, undefined, true);
    expect(prompt).toContain('Feature Spec');
  });

  it('renders empty documents gracefully', async () => {
    const prompt = await engine.buildTaskPlanPrompt(task, 'Build it', [], codeCtx);
    expect(prompt).not.toContain('{{documents}}');
    expect(prompt).toBeDefined();
    expect(prompt.length).toBeGreaterThan(0);
  });

  it('INVARIANT 4A: explicit RAC documents are NOT rendered in plan phase', async () => {
    const racDocs: ResolvedDocument[] = [
      { path: 'ref-file', content: 'UNIQUE_REF_MARKER_XYZ', role: 'ref' },
    ];
    const rac: ResolvedActionContext = {
      source: 'explicit',
      intent: 'gen-code-sys',
      mode: 'generate',
      tech: { language: 'typescript', environment: 'frontend' },
      hasExplicitFields: true,
      intentDescription: 'Generate code from design',
      documents: racDocs,
    };

    const planDocs = [sampleDesignDoc];
    const prompt = await engine.buildTaskPlanPrompt(
      task, 'Build the app', planDocs, codeCtx,
      undefined, undefined, undefined, undefined, undefined, false, rac,
    );

    expect(prompt).not.toContain('UNIQUE_REF_MARKER_XYZ');
    expect(prompt).toContain('Frontend System Design');
    expect(prompt).toContain('Generate code from design');
  });

  it('resolvedAction metadata (intent) IS rendered in plan', async () => {
    const rac: ResolvedActionContext = {
      source: 'explicit',
      intent: 'gen-code-spec',
      mode: 'generate',
      tech: { language: 'typescript' },
      hasExplicitFields: true,
      intentDescription: 'Generate code from design',
    };

    const prompt = await engine.buildTaskPlanPrompt(
      task, 'Build it', [sampleDesignDoc], codeCtx,
      undefined, undefined, undefined, undefined, undefined, false, rac,
    );

    expect(prompt).toContain('Generate code from design');
  });
});

// ============================================
// 4B. buildVerificationPlanPrompt / buildErrorPlanPrompt
// ============================================

describe('Audit 4B: buildVerificationPlanPrompt / buildErrorPlanPrompt', () => {
  const verifyTask = { id: 'v-1', name: 'Verify build', description: 'Run build and check', type: 'verification' };
  const errorTask = { id: 'e-1', name: 'Fix error', description: 'Fix the crash', type: 'error' };
  const codeCtx = { files: [{ path: 'src/app.ts', content: 'code' }], filePaths: ['src/app.ts'] };

  it('verification prompt renders without documents section', async () => {
    const prompt = await engine.buildVerificationPlanPrompt(
      verifyTask, 'Verify the build', codeCtx,
    );
    expect(prompt).toBeDefined();
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt).not.toMatch(/\{\{designDoc\}\}/);
    expect(prompt).not.toMatch(/\{\{prdSpec\}\}/);
  });

  it('verification prompt with resolvedAction passes metadata only', async () => {
    const rac: ResolvedActionContext = {
      source: 'explicit',
      intent: 'gen-code-directive',
      mode: 'generate',
      tech: {},
      hasExplicitFields: true,
      intentDescription: 'Generate code',
    };
    const prompt = await engine.buildVerificationPlanPrompt(
      verifyTask, 'Verify', codeCtx, undefined, undefined, undefined, undefined, rac,
    );
    expect(prompt).toBeDefined();
  });

  it('error prompt renders without documents section', async () => {
    const prompt = await engine.buildErrorPlanPrompt(
      errorTask, 'Fix the crash\nTypeError at line 10', codeCtx,
    );
    expect(prompt).toBeDefined();
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt).not.toMatch(/\{\{designDoc\}\}/);
  });

  it('error prompt with resolvedAction passes metadata only', async () => {
    const rac: ResolvedActionContext = {
      source: 'infer',
      mode: 'refactor',
      tech: {},
      hasExplicitFields: false,
    };
    const prompt = await engine.buildErrorPlanPrompt(
      errorTask, 'Fix crash', codeCtx, undefined, undefined, undefined, rac,
    );
    expect(prompt).toBeDefined();
  });
});

// ============================================
// 4C. buildDecomposePrompt
// ============================================

describe('Audit 4C: buildDecomposePrompt', () => {
  it('inline docs → documents rendered in prompt', async () => {
    const docs: ResolvedDocument[] = [
      { path: 'fe-system-main.md', content: '# Frontend System Design\nReact app', role: 'ref', label: 'Frontend Design' },
      { path: 'be-system-main.md', content: '# Backend System Design\nExpress API', role: 'ref', label: 'Backend Design' },
    ];

    const result = await engine.buildDecomposePrompt({
      directive: 'Build the fullstack app',
      documents: docs,
      hasDocuments: true,
      mode: 'generate',
      profile: { language: 'TypeScript', framework: 'Next.js' },
    });

    expect(result.user).toContain('Frontend System Design');
    expect(result.user).toContain('Backend System Design');
    expect(result.system).toBeDefined();
  });

  it('no docs → empty documents render', async () => {
    const result = await engine.buildDecomposePrompt({
      directive: 'Build something',
      documents: [],
      hasDocuments: false,
      mode: 'generate',
      profile: { language: 'TypeScript' },
    });

    expect(result.user).toBeDefined();
    expect(result.user).not.toContain('{{designDoc}}');
  });
});

// ============================================
// 4D. buildDetectEnvironmentPrompt / buildDesignDomainPrompt
// ============================================

describe('Audit 4D: buildDetectEnvironmentPrompt / buildDesignDomainPrompt', () => {
  it('detect prompt renders documents', async () => {
    const docs: ResolvedDocument[] = [
      { path: 'system-design', content: '# System Design\nNode.js API', role: 'ref', label: 'System Design' },
    ];

    const prompt = await engine.buildDetectEnvironmentPrompt('Build an API', docs);
    expect(prompt).toContain('System Design');
    expect(prompt).toContain('Node.js API');
    expect(prompt).not.toMatch(/\{\{prdSpec\}\}/);
  });

  it('detect prompt with no documents', async () => {
    const prompt = await engine.buildDetectEnvironmentPrompt('Build something');
    expect(prompt).toBeDefined();
    expect(prompt.length).toBeGreaterThan(0);
  });

  it('design domain prompt renders documents', async () => {
    const docs: ResolvedDocument[] = [
      { path: 'prd', content: '# PRD\nBuild a game', role: 'context', label: 'PRD' },
    ];

    const prompt = await engine.buildDesignDomainPrompt({
      directive: 'Design the game architecture',
      documents: docs,
      hasDocuments: true,
    });
    expect(prompt).toContain('Build a game');
    expect(prompt).not.toMatch(/\{\{prdSpec\}\}/);
  });

  it('design domain prompt with completion status flags', async () => {
    const prompt = await engine.buildDesignDomainPrompt({
      directive: 'Design a SaaS',
      hasDocuments: false,
      hasUiDocs: true,
      hasSystemDesign: true,
      hasApiContract: false,
    });
    expect(prompt).toBeDefined();
    expect(prompt.length).toBeGreaterThan(0);
  });
});
