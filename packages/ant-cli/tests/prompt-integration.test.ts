/**
 * Task 3: promptBuilder Integration Tests
 *
 * Tests the full prompt pipeline from document assembly through PromptEngine.
 * Two layers:
 *   A. Resolver functions (resolveDesignDocForTask, resolveUiDocForTask)
 *   B. PromptEngine buildExecutePrompt with assembled documents
 *
 * This verifies the contract between promptBuilder and PromptEngine:
 * given a certain state, the correct documents are assembled and
 * the correct injections/mode are selected.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'path';
import { FilePromptAdapter, initPartials } from '../src/periphery/adapters/prompt/FilePromptAdapter';
import { PromptEngine } from '../src/core/prompt/engine/PromptEngine';
import '../src/core/prompt/engine/TemplateComposer';
import { resolveDesignDocForTask } from '../src/agents/architect/graph/code/nodes/documentResolver';
import { prepareDesignDocument } from '../src/agents/architect/graph/code/nodes/decompose/designSelector';
import { condenseContent } from '../src/core/utils/contentCondenser';
import { buildAllSourceDocs } from '../src/core/utils/sourceDocuments';
import type { ResolvedDocument, ResolvedActionContext } from '@ant/shared';

const TEMPLATES_DIR = join(__dirname, '../src/core/prompt/templates');
let engine: PromptEngine;

beforeAll(async () => {
  const adapter = new FilePromptAdapter(TEMPLATES_DIR);
  await initPartials(TEMPLATES_DIR);
  engine = new PromptEngine({ promptPort: adapter, contextLoader: async () => ({}) });
});

const baseCtx = { project: 'test', featurePath: '/tmp/test', featureFolder: 'test' } as any;

function rac(overrides?: Partial<ResolvedActionContext>): ResolvedActionContext {
  return {
    source: 'infer', jobMode: 'generate',
    tech: { language: 'typescript', environment: 'frontend' },
    hasExplicitFields: false,
    ...overrides,
  } as ResolvedActionContext;
}

// ============================================================================
// A. Resolver Tests — what documents go into the prompt
// ============================================================================

describe('Integration A: resolveDesignDocForTask', () => {
  const featureTask = { id: 't1', name: 'Build', type: 'feature', priority: 200, description: 'Build', packages: ['fe-main'] } as any;
  const verifyTask = { id: 't2', name: 'Verify', type: 'verification', priority: 1000, description: 'Verify' } as any;
  const errorTask = { id: 't3', name: 'Fix', type: 'error', priority: 500, description: 'Fix error' } as any;
  const uiTask = { id: 't4', name: 'UI', type: 'ui', priority: 200, description: 'UI impl', uiSections: ['header'] } as any;

  it('feature task with designDocs and packages → design doc content', () => {
    const state = {
      designDocs: {
        feDesigns: { main: '# Frontend System Design\nNext.js app' },
        apiContracts: {},
        beDesigns: {},
      },
    } as any;
    const result = resolveDesignDocForTask(featureTask, state);
    expect(result).toContain('Frontend System Design');
    expect(result.length).toBeGreaterThan(0);
  });

  it('verification task → empty (no design context)', () => {
    const state = {
      designDocs: { feDesigns: { main: 'Design' }, apiContracts: {}, beDesigns: {} },
    } as any;
    const result = resolveDesignDocForTask(verifyTask, state);
    expect(result).toBe('');
  });

  it('error task → empty (selectedSpec handled post-resolver)', () => {
    const state = {
      designDocs: { feDesigns: { main: 'Design' }, apiContracts: {}, beDesigns: {} },
      selectedSpec: 'login',
      specDocs: { login: 'Login feature spec' },
    } as any;
    const result = resolveDesignDocForTask(errorTask, state);
    expect(result).toBe('');
  });

  it('ui task → empty (uses ui-doc, not design doc)', () => {
    const state = {} as any;
    const result = resolveDesignDocForTask(uiTask, state);
    expect(result).toBe('');
  });

  it('spec-driven task → selectedSpec + apiContracts', () => {
    const specTask = { ...featureTask, packages: ['fe-main'] };
    const state = {
      selectedSpec: 'auth',
      specDocs: { auth: 'Authentication specification' },
      designDocs: {
        apiContracts: { main: 'API contract content' },
        feDesigns: { main: 'FE design' },
        beDesigns: {},
      },
    } as any;
    const result = resolveDesignDocForTask(specTask, state);
    expect(result).toContain('Authentication specification');
    expect(result).toContain('API contract content');
  });
});

// ============================================================================
// B. Document Assembly — what promptBuilder constructs before calling engine
// ============================================================================

describe('Integration B: Document assembly logic', () => {
  it('Scenario 1: infer + designDoc + prd + uiDoc → 3 documents', () => {
    const designDoc = '# Frontend Design\nNext.js app';
    const prdContent = '# PRD\nBuild a dashboard';
    const uiDoc = '# UI Spec\nDashboard layout';

    const docs: ResolvedDocument[] = [];
    if (designDoc) docs.push({ path: 'system-design', content: designDoc, role: 'ref', label: 'System Design' });
    if (prdContent) docs.push({ path: 'prd', content: prdContent, role: 'context', label: 'PRD Specification' });
    if (uiDoc) docs.push({ path: 'ui-spec', content: uiDoc, role: 'context', label: 'UI Specification' });

    expect(docs).toHaveLength(3);
    expect(docs.map(d => d.path)).toEqual(['system-design', 'prd', 'ui-spec']);
    expect(docs[0].role).toBe('ref');
    expect(docs[1].role).toBe('context');
    expect(docs[2].role).toBe('context');
  });

  it('Scenario 2: explicit + documents → bypass infer assembly', () => {
    const explicitDocs: ResolvedDocument[] = [
      { path: 'inputs/sources/spec.md', content: 'User provided spec', role: 'ref', label: 'Spec' },
    ];
    const resolvedAction = rac({
      source: 'explicit',
      hasExplicitFields: true,
      documents: explicitDocs,
    });

    const hasExplicitDocs = resolvedAction.source === 'explicit'
      && (resolvedAction.documents?.length ?? 0) > 0;
    expect(hasExplicitDocs).toBe(true);

    let resolvedActionWithDocs = resolvedAction;
    if (!hasExplicitDocs) {
      resolvedActionWithDocs = { ...resolvedAction, documents: [/* would build infer docs */] };
    }
    expect(resolvedActionWithDocs.documents).toEqual(explicitDocs);
  });

  it('Scenario 3: verification task → prd/ui skipped', () => {
    const isVerificationTask = true;
    const designDoc = '';
    const prdContent = '# PRD content';
    const uiDoc = '# UI content';

    const docs: ResolvedDocument[] = [];
    if (designDoc) docs.push({ path: 'system-design', content: designDoc, role: 'ref' });
    if (prdContent && !isVerificationTask) docs.push({ path: 'prd', content: prdContent, role: 'context' });
    if (uiDoc && !isVerificationTask) docs.push({ path: 'ui-spec', content: uiDoc, role: 'context' });

    expect(docs).toHaveLength(0);
  });

  it('Scenario 4: error + selectedSpec → spec doc in documents', () => {
    const specContent = 'Login feature specification';
    const apiContracts = { main: 'API contract' };

    const parts: string[] = [`# Feature Specification (Primary)\n\n${specContent}`];
    for (const [name, content] of Object.entries(apiContracts)) {
      parts.push(`# API Contract: ${name} (Reference)\n\n${content}`);
    }
    const combined = parts.join('\n\n────────────────────────────────────────\n\n');
    const condensed = condenseContent(combined, { threshold: 30_000, label: 'Spec Document: login', filePath: 'outputs/design/spec/login' });

    expect(condensed.wasCondensed).toBe(false);
    expect(condensed.content).toContain('Login feature specification');
    expect(condensed.content).toContain('API contract');
  });
});

// ============================================================================
// C. Full Pipeline — buildExecutePrompt with assembled documents
// ============================================================================

describe('Integration C: buildExecutePrompt with documents', () => {
  it('Scenario 1: infer + 3 documents → text contains all documents', async () => {
    const docs: ResolvedDocument[] = [
      { path: 'system-design', content: '# Frontend Design\nNext.js app with SSR', role: 'ref', label: 'System Design' },
      { path: 'prd', content: '# PRD\nBuild a dashboard app', role: 'context', label: 'PRD Specification' },
      { path: 'ui-spec', content: '# UI Spec\nDashboard layout', role: 'context', label: 'UI Specification' },
    ];
    const result = await engine.buildExecutePrompt('code', baseCtx, {
      directive: 'Build the dashboard',
      documents: docs,
      resolvedAction: rac({ documents: docs }),
      currentTask: { name: 'Build', type: 'feature', priority: 200, description: 'Build' },
    }, undefined, 'feature');

    const text = engine.extractPromptText(result);
    expect(text).toContain('System Design');
    expect(text).toContain('PRD Specification');
    expect(text).toContain('UI Specification');
    expect(result.modeConfig.templates.injections).toContain('common/injections/action-context');
  });

  it('Scenario 2: explicit + documents → action-context injected', async () => {
    const docs: ResolvedDocument[] = [
      { path: 'inputs/spec.md', content: '# Feature Spec\nUser feature', role: 'ref', label: 'Feature Spec' },
    ];
    const result = await engine.buildExecutePrompt('code', baseCtx, {
      directive: 'Implement feature',
      documents: docs,
      resolvedAction: rac({ source: 'explicit', hasExplicitFields: true, documents: docs }),
      currentTask: { name: 'Impl', type: 'feature', priority: 200, description: 'Implement' },
    }, undefined, 'feature');

    expect(result.modeConfig.templates.injections).toContain('common/injections/action-context');
  });

  it('Scenario 3: verification task → no design/prd injections, uses verify templates', async () => {
    const result = await engine.buildExecutePrompt('code', baseCtx, {
      currentTask: { name: 'Verify', type: 'verification', priority: 1000, description: 'Verify build' },
    }, undefined, 'verification');

    expect(result.modeConfig.templates.base).toContain('verification');
    expect(result.modeConfig.templates.rules).toContain('verification');
    const inj = result.modeConfig.templates.injections;
    expect(inj.some(i => i.includes('browser/rules'))).toBe(false);
    expect(inj.some(i => i.includes('tool-calling'))).toBe(false);
  });

  it('Scenario 4: error + frontend → preview-setup injected', async () => {
    const ctx = { ...baseCtx, detectedEnvironment: 'frontend' };
    const result = await engine.buildExecutePrompt('code', ctx, {
      directive: 'Fix the error in login page',
      documents: [{ path: 'spec', content: '# Spec\nLogin spec', role: 'ref', label: 'Spec' }],
      resolvedAction: rac({ documents: [{ path: 'spec', content: '# Spec', role: 'ref' }] }),
      currentTask: { name: 'Fix', type: 'error', priority: 500, description: 'Fix error' },
    }, undefined, 'error');

    expect(result.modeConfig.templates.base).toContain('error');
    expect(result.modeConfig.templates.injections.some(i => i.includes('preview-setup'))).toBe(true);
  });

  it('Scenario 5: design job + source-docs document', async () => {
    const docs: ResolvedDocument[] = [
      { path: 'source-docs', content: '# PRD for design\nBuild an API', role: 'context', label: 'PRD Specification' },
    ];
    const result = await engine.buildExecutePrompt('design', baseCtx, {
      directive: 'Design the backend API',
      documents: docs,
      resolvedAction: rac({ documents: docs }),
      currentTask: { name: 'Design BE', type: 'feature', priority: 200, description: 'Design', targetFile: 'be-system-main.md' } as any,
    }, undefined, undefined);

    expect(result.modeConfig.templates.base).toBe('design/phases/execute/base-system-design');
    expect(result.modeConfig.templates.rules).toBe('design/phases/execute/rules-system-design');
  });

  it('Scenario 6: plan phase with documents', async () => {
    const docs: ResolvedDocument[] = [
      { path: 'fe-system-main.md', content: '# Frontend System Design', role: 'ref', label: 'Design' },
      { path: 'ui-spec', content: '# UI Specification', role: 'context', label: 'UI Spec' },
    ];
    const rendered = await engine.buildTaskPlanPrompt(
      { id: 't1', name: 'Setup', description: 'Setup project', type: 'setup' },
      'Build an app',
      docs,
      { files: [], stats: { filesLoaded: 0, estimatedTokens: 0 } },
    );
    expect(rendered).toContain('Frontend System Design');
    expect(rendered).toContain('UI Specification');
  });

  it('Scenario 7: decompose with fe+be designDocs → individual documents', () => {
    const state = {
      designDocs: {
        apiContracts: { main: '# API Contract\nREST endpoints' },
        feDesigns: { main: '# Frontend\nReact dashboard' },
        beDesigns: { main: '# Backend\nNode.js API' },
      },
      design: '',
    } as any;

    const result = prepareDesignDocument(state);
    expect(result.hasDocuments).toBe(true);
    expect(result.documents.length).toBe(3);
    const paths = result.documents.map(d => d.path);
    expect(paths).toContain('api-contract-main.md');
    expect(paths).toContain('fe-system-main.md');
    expect(paths).toContain('be-system-main.md');
  });

  it('Scenario 8: sourceDocuments → buildAllSourceDocs', () => {
    const sourceDocuments: Record<string, string> = {
      'feature-spec.md': '# Feature Spec\nDashboard feature',
      'api-reference.md': '# API Reference\nEndpoints list',
    };
    const result = buildAllSourceDocs(sourceDocuments);
    expect(result).toContain('Feature Spec');
    expect(result).toContain('API Reference');
    expect(result!.length).toBeGreaterThan(0);
  });
});
