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

const baseDocs: ResolvedDocument[] = [
  { path: 'system-design', content: '# System Design\nNext.js frontend app', role: 'ref', label: 'System Design' },
  { path: 'prd', content: '# PRD\nBuild a todo app', role: 'context', label: 'PRD Specification' },
];

const baseContext = {
  project: 'test',
  featurePath: '/tmp/test-feature',
  featureFolder: 'test-feature',
};

function buildRAC(docs?: ResolvedDocument[]): ResolvedActionContext {
  return {
    source: 'infer' as const,
    jobMode: 'generate' as const,
    tech: { language: 'typescript', environment: 'frontend' },
    hasExplicitFields: false,
    documents: docs,
  };
}

describe('PromptEngine Pipeline: Execute Phase', () => {
  it('renders documents via action-context injection (not legacy injections)', async () => {
    const rac = buildRAC(baseDocs);
    const result = await engine.buildExecutePrompt('code', baseContext as any, {
      directive: 'Build a todo app',
      documents: baseDocs,
      resolvedAction: rac,
      currentTask: { name: 'Create app', type: 'feature', priority: 200, description: 'Build todo app' },
    }, undefined, 'feature');

    const rendered = engine.extractPromptText(result);

    expect(rendered).toContain('System Design');
    expect(rendered).toContain('PRD Specification');

    expect(rendered).not.toMatch(/\{\{designDoc\}\}/);
    expect(rendered).not.toMatch(/\{\{prdSpec\}\}/);
    expect(rendered).not.toMatch(/\{\{uiDoc\}\}/);
  });

  it('action-context injection absent when no resolvedAction', async () => {
    const result = await engine.buildExecutePrompt('code', baseContext as any, {
      directive: 'Fix a bug',
      currentTask: { name: 'Fix bug', type: 'feature', priority: 200, description: 'Fix a bug' },
    }, undefined, 'feature');

    const injections = result.modeConfig.templates.injections;
    expect(injections.some(i => i.includes('action-context'))).toBe(false);
  });

  it('base template does not contain unresolved Handlebars for removed fields', async () => {
    const rac = buildRAC(baseDocs);
    const result = await engine.buildExecutePrompt('code', baseContext as any, {
      directive: 'Build app',
      documents: baseDocs,
      resolvedAction: rac,
      currentTask: { name: 'Task', type: 'feature', priority: 200, description: 'desc' },
    }, undefined, 'feature');

    const baseContent = result.composed.base;
    expect(baseContent).not.toContain('{{designDoc}}');
    expect(baseContent).not.toContain('{{prdSpec}}');
    expect(baseContent).not.toContain('{{uiDoc}}');
  });

  it('verification task skips visual-source-authority and action-context env rules', async () => {
    const rac = buildRAC(baseDocs);
    const result = await engine.buildExecutePrompt('code', baseContext as any, {
      directive: 'Verify build',
      documents: baseDocs,
      resolvedAction: rac,
      currentTask: { name: 'Verify', type: 'verification', priority: 1000, description: 'Run build' },
    }, undefined, 'verification');

    const injections = result.modeConfig.templates.injections;
    expect(injections.some(i => i.includes('visual-source-authority'))).toBe(false);
    expect(injections.some(i => i.includes('environments/'))).toBe(false);
  });
});

describe('PromptEngine Pipeline: Plan Phase', () => {
  it('buildTaskPlanPrompt renders documents correctly', async () => {
    const rendered = await engine.buildTaskPlanPrompt(
      { id: 't1', name: 'Setup project', description: 'Create the project', type: 'setup' },
      'Build a todo app',
      baseDocs,
      { files: [], stats: { filesLoaded: 0, estimatedTokens: 0 } },
    );

    expect(rendered).toContain('System Design');
    expect(rendered).toContain('PRD Specification');
    expect(rendered).not.toMatch(/\{\{designDoc\}\}/);
    expect(rendered).not.toMatch(/\{\{prdSpec\}\}/);
  });
});

describe('PromptEngine Pipeline: Detect Phase', () => {
  it('buildDetectEnvironmentPrompt renders documents without prdSpec', async () => {
    const detectDocs: ResolvedDocument[] = [
      { path: 'source-docs', content: 'Build a Next.js app', role: 'context', label: 'Source Documents' },
    ];

    const rendered = await engine.buildDetectEnvironmentPrompt('Build a todo app', detectDocs);
    expect(rendered).toContain('Source Documents');
    expect(rendered).toContain('Build a Next.js app');
    expect(rendered).not.toMatch(/\{\{prdSpec\}\}/);
  });
});
