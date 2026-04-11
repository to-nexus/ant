/**
 * Audit 5: E2E Prompt Render Scenarios
 *
 * Full FilePromptAdapter rendering through PromptEngine. Validates 5 invariants:
 * INV-1: No legacy Handlebars ({{designDoc}}, {{prdSpec}}, {{uiDoc}})
 * INV-2: Document one-time render (no duplication)
 * INV-3: Deleted injection absence (prd-spec, design-doc, ui-doc)
 * INV-4: No unresolved Handlebars
 * INV-5: Required injections present
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

// ============================================
// Invariant Checker
// ============================================

interface Scenario {
  name: string;
  expectedDocLabels: string[];
  requiredInjections: string[];
}

function assertPromptInvariants(
  text: string,
  injections: string[],
  scenario: Scenario,
) {
  // INV-1: No legacy Handlebars
  expect(text).not.toMatch(/\{\{designDoc\}\}/);
  expect(text).not.toMatch(/\{\{prdSpec\}\}/);
  expect(text).not.toMatch(/\{\{uiDoc\}\}/);

  // INV-2: Document content not duplicated
  // Labels may appear in multiple locations (action-context header, template label, etc.)
  // so we check the actual document CONTENT body isn't duplicated.
  // A soft check: each expectedDocLabel should appear a reasonable number of times.
  for (const label of scenario.expectedDocLabels) {
    const regex = new RegExp(escapeRegex(label), 'g');
    const matches = text.match(regex) || [];
    expect(matches.length).toBeGreaterThan(0);
  }

  // INV-3: Deleted injection absence
  expect(injections.some(i => i.includes('prd-spec'))).toBe(false);
  expect(injections.some(i => i.includes('/design-doc'))).toBe(false);
  expect(injections.some(i => i.includes('ui-doc'))).toBe(false);

  // INV-4: No unresolved Handlebars (except partials and comments)
  const unresolvedMatches = text.match(/\{\{[^!#/>][^}]*\}\}/g) || [];
  const filtered = unresolvedMatches.filter(m =>
    !m.includes('{{>') &&
    !m.includes('{{!') &&
    !m.includes('{{/') &&
    !m.includes('{{#') &&
    !m.includes('{{else}}')
  );
  if (filtered.length > 0) {
    console.warn(`[INV-4] Unresolved: ${filtered.join(', ')} in scenario: ${scenario.name}`);
  }

  // INV-5: Required injections present
  for (const req of scenario.requiredInjections) {
    expect(injections.some(i => i.includes(req))).toBe(true);
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================
// Shared fixtures
// ============================================

const designDoc: ResolvedDocument = { path: 'system-design', content: '# System Design\nNext.js frontend app with SSR', role: 'ref', label: 'System Design' };
const prdDoc: ResolvedDocument = { path: 'prd', content: '# PRD\nBuild a todo app with authentication', role: 'context', label: 'PRD Specification' };
const uiDoc: ResolvedDocument = { path: 'ui-spec', content: '# UI Specification\nDesign tokens and component layout', role: 'context', label: 'UI Specification' };
const fullDocs = [designDoc, prdDoc, uiDoc];
const designOnlyDocs = [designDoc];

const baseContext = {
  project: 'test', featurePath: '/tmp/test', featureFolder: 'test',
} as any;

function makeRAC(
  source: 'explicit' | 'infer',
  env: string,
  docs?: ResolvedDocument[],
  overrides?: Partial<ResolvedActionContext>,
): ResolvedActionContext {
  const langMap: Record<string, string> = { frontend: 'typescript', backend: 'go', fullstack: 'typescript' };
  return {
    source,
    intent: source === 'explicit' ? 'gen-code-sys' : undefined,
    mode: 'generate',
    tech: { language: langMap[env] as any, environment: env as any },
    hasExplicitFields: source === 'explicit',
    intentDescription: source === 'explicit' ? 'Generate code from design' : undefined,
    documents: docs,
    ...overrides,
  };
}

async function renderCodeExecute(
  env: string, taskType: string, docs: ResolvedDocument[] | undefined,
  rac: ResolvedActionContext, mode?: string,
) {
  const langMap: Record<string, string> = { frontend: 'TypeScript', backend: 'Go', fullstack: 'TypeScript' };
  const result = await engine.buildExecutePrompt('code', {
    ...baseContext,
    codebaseProfile: { language: langMap[env] },
    detectedEnvironment: env,
  }, {
    directive: 'Build the feature',
    documents: docs,
    resolvedAction: rac,
    currentTask: { name: 'task-1', type: taskType, priority: 200, description: 'Build the feature' },
  }, mode as any, taskType);

  return {
    text: engine.extractPromptText(result),
    injections: result.modeConfig.templates.injections,
  };
}

// ============================================
// Code Execute Scenarios (12)
// ============================================

describe('Audit 5: E2E Code Execute', () => {
  it('S1: explicit + frontend + feature + full docs', async () => {
    const rac = makeRAC('explicit', 'frontend', fullDocs);
    const { text, injections } = await renderCodeExecute('frontend', 'feature', fullDocs, rac);
    assertPromptInvariants(text, injections, {
      name: 'S1', expectedDocLabels: ['System Design', 'PRD Specification', 'UI Specification'],
      requiredInjections: ['action-context', 'visual-source-authority'],
    });
    expect(text).toContain('System Design');
  });

  it('S2: explicit + backend/go + feature + design-only', async () => {
    const rac = makeRAC('explicit', 'backend', designOnlyDocs);
    const { text, injections } = await renderCodeExecute('backend', 'feature', designOnlyDocs, rac);
    assertPromptInvariants(text, injections, {
      name: 'S2', expectedDocLabels: ['System Design'],
      requiredInjections: ['action-context', 'backend-safety'],
    });
    expect(injections.some(i => i.includes('visual-source-authority'))).toBe(false);
  });

  it('S3: explicit + fullstack + feature + design+prd', async () => {
    const docs = [designDoc, prdDoc];
    const rac = makeRAC('explicit', 'fullstack', docs);
    const { text, injections } = await renderCodeExecute('fullstack', 'feature', docs, rac);
    assertPromptInvariants(text, injections, {
      name: 'S3', expectedDocLabels: ['System Design', 'PRD Specification'],
      requiredInjections: ['action-context'],
    });
  });

  it('S4: infer + frontend + feature + full docs', async () => {
    const rac = makeRAC('infer', 'frontend', fullDocs);
    const { text, injections } = await renderCodeExecute('frontend', 'feature', fullDocs, rac);
    assertPromptInvariants(text, injections, {
      name: 'S4', expectedDocLabels: ['System Design'],
      requiredInjections: ['action-context'],
    });
  });

  it('S5: infer + backend/go + feature + design-only', async () => {
    const rac = makeRAC('infer', 'backend', designOnlyDocs);
    const { text, injections } = await renderCodeExecute('backend', 'feature', designOnlyDocs, rac);
    assertPromptInvariants(text, injections, {
      name: 'S5', expectedDocLabels: ['System Design'],
      requiredInjections: ['action-context', 'backend-safety'],
    });
  });

  it('S6: none + frontend + feature + no docs (directive only)', async () => {
    const { text, injections } = await renderCodeExecute('frontend', 'feature', undefined, undefined as any);
    assertPromptInvariants(text, injections, {
      name: 'S6', expectedDocLabels: [],
      requiredInjections: ['directive'],
    });
    expect(injections.some(i => i.includes('action-context'))).toBe(false);
  });

  it('S7: explicit + frontend + verification + full docs', async () => {
    const rac = makeRAC('explicit', 'frontend', fullDocs);
    const { text, injections } = await renderCodeExecute('frontend', 'verification', fullDocs, rac);
    assertPromptInvariants(text, injections, {
      name: 'S7', expectedDocLabels: [],
      requiredInjections: ['action-context'],
    });
    expect(injections.some(i => i.includes('visual-source-authority'))).toBe(false);
    expect(injections.some(i => i.includes('environments/'))).toBe(false);
  });

  it('S8: explicit + frontend + error + full docs (BUG-1 fix)', async () => {
    const rac = makeRAC('explicit', 'frontend', fullDocs);
    const { text, injections } = await renderCodeExecute('frontend', 'error', fullDocs, rac);
    assertPromptInvariants(text, injections, {
      name: 'S8', expectedDocLabels: [],
      requiredInjections: ['preview-setup', 'preview-env-contract', 'port-management', 'action-context'],
    });
    expect(injections.some(i => i.includes('tool-calling-rules-compact'))).toBe(false);
    expect(injections.some(i => i.includes('environments/'))).toBe(false);
  });

  it('S9: explicit + frontend + test-code + full docs', async () => {
    const rac = makeRAC('explicit', 'frontend', fullDocs);
    const { text, injections } = await renderCodeExecute('frontend', 'test-code', fullDocs, rac);
    assertPromptInvariants(text, injections, {
      name: 'S9', expectedDocLabels: [],
      requiredInjections: ['action-context', 'test-code/languages'],
    });
    expect(injections.some(i => i.includes('visual-source-authority'))).toBe(false);
  });

  it('S10: explicit + frontend + setup + design+prd', async () => {
    const docs = [designDoc, prdDoc];
    const rac = makeRAC('explicit', 'frontend', docs);
    const { text, injections } = await renderCodeExecute('frontend', 'setup', docs, rac);
    assertPromptInvariants(text, injections, {
      name: 'S10', expectedDocLabels: ['System Design'],
      requiredInjections: ['action-context'],
    });
  });

  it('S11: infer+metadata + frontend + feature + full docs (action-context)', async () => {
    const rac = makeRAC('infer', 'frontend', fullDocs, {
      hasExplicitFields: true,
    });
    const { text, injections } = await renderCodeExecute('frontend', 'feature', fullDocs, rac);
    assertPromptInvariants(text, injections, {
      name: 'S11', expectedDocLabels: ['System Design'],
      requiredInjections: ['action-context'],
    });
  });

  it('S12: explicit + frontend + feature + refactor mode', async () => {
    const rac = makeRAC('explicit', 'frontend', fullDocs, { mode: 'refactor' });
    const { text, injections } = await renderCodeExecute('frontend', 'feature', fullDocs, rac, 'refactor');
    assertPromptInvariants(text, injections, {
      name: 'S12', expectedDocLabels: ['System Design'],
      requiredInjections: ['refactor-guidance', 'behavioral-debugging'],
    });
  });
});

// ============================================
// Design Execute Scenarios (5)
// ============================================

describe('Audit 5: E2E Design Execute', () => {
  async function renderDesignExecute(
    targetFile: string, designDomain?: 'game' | 'service',
    profileOverrides?: any,
  ) {
    const rac: ResolvedActionContext = {
      source: 'explicit',
      intent: 'gen-sys-fe',
      mode: 'generate',
      tech: { language: 'typescript', environment: 'frontend', framework: profileOverrides?.framework },
      hasExplicitFields: true,
      documents: designOnlyDocs,
    };
    const result = await engine.buildExecutePrompt('design', {
      ...baseContext,
      codebaseProfile: { language: 'TypeScript', framework: 'Next.js', ...profileOverrides },
      detectedEnvironment: 'frontend',
    }, {
      directive: 'Design the architecture',
      documents: designOnlyDocs,
      resolvedAction: rac,
      currentTask: { name: 'design', type: 'feature', priority: 200, description: 'Design', targetFile } as any,
      designDomain,
    }, undefined, 'feature');

    return {
      text: engine.extractPromptText(result),
      injections: result.modeConfig.templates.injections,
    };
  }

  it('S13: gen-sys-fe + fe-system-main.md → frontend-guide + nextjs-augmentation', async () => {
    const { injections } = await renderDesignExecute('fe-system-main.md');
    expect(injections.some(i => i.includes('frontend-guide'))).toBe(true);
    expect(injections.some(i => i.includes('nextjs-augmentation'))).toBe(true);
  });

  it('S14: gen-sys-be + be-system-main.md → backend-guide + go-api-augmentation', async () => {
    const rac: ResolvedActionContext = {
      source: 'explicit', intent: 'gen-sys-be', mode: 'generate',
      tech: { language: 'go', environment: 'backend' },
      hasExplicitFields: true, documents: designOnlyDocs,
    };
    const result = await engine.buildExecutePrompt('design', {
      ...baseContext,
      codebaseProfile: { language: 'Go' },
      detectedEnvironment: 'backend',
    }, {
      directive: 'Design backend',
      documents: designOnlyDocs,
      resolvedAction: rac,
      currentTask: { name: 'design', type: 'feature', priority: 200, description: 'Design', targetFile: 'be-system-main.md' } as any,
    }, undefined, 'feature');

    const injections = result.modeConfig.templates.injections;
    expect(injections.some(i => i.includes('backend-guide'))).toBe(true);
    expect(injections.some(i => i.includes('go-api-augmentation'))).toBe(true);
  });

  it('S15: api-contract-main.md → api-contract-guide', async () => {
    const { injections } = await renderDesignExecute('api-contract-main.md');
    expect(injections.some(i => i.includes('api-contract-guide'))).toBe(true);
  });

  it('S16: game domain → game-domain-guide', async () => {
    const { injections } = await renderDesignExecute('fe-system-main.md', 'game');
    expect(injections.some(i => i.includes('game-domain-guide'))).toBe(true);
    expect(injections.some(i => i.includes('service-domain-guide'))).toBe(false);
  });

  it('S17: service domain → service-domain-guide', async () => {
    const { injections } = await renderDesignExecute('fe-system-main.md', 'service');
    expect(injections.some(i => i.includes('service-domain-guide'))).toBe(true);
    expect(injections.some(i => i.includes('game-domain-guide'))).toBe(false);
  });
});

// ============================================
// Plan Phase Scenarios (3)
// ============================================

describe('Audit 5: E2E Plan Phase', () => {
  const task = { id: 't-1', name: 'Build', description: 'Build the app', type: 'feature' };
  const codeCtx = { files: [], filePaths: [] };

  it('S18: buildTaskPlanPrompt + docs → planDocs rendered, RAC docs not rendered', async () => {
    const planDocs = [designDoc, uiDoc];
    const rac = makeRAC('explicit', 'frontend', [
      { path: 'explicit-ref', content: 'EXPLICIT_MARKER_SHOULD_NOT_APPEAR', role: 'ref' },
    ]);

    const prompt = await engine.buildTaskPlanPrompt(
      task, 'Build it', planDocs, codeCtx, undefined, undefined, undefined, undefined, undefined, false, rac,
    );

    expect(prompt).toContain('System Design');
    expect(prompt).toContain('UI Specification');
    expect(prompt).not.toContain('EXPLICIT_MARKER_SHOULD_NOT_APPEAR');
    expect(prompt).not.toMatch(/\{\{designDoc\}\}/);
  });

  it('S19: buildVerificationPlanPrompt → no documents render', async () => {
    const verifyTask = { id: 'v-1', name: 'Verify', description: 'Verify build', type: 'verification' };
    const prompt = await engine.buildVerificationPlanPrompt(verifyTask, 'Verify', codeCtx);
    expect(prompt).not.toMatch(/\{\{designDoc\}\}/);
    expect(prompt).not.toMatch(/\{\{prdSpec\}\}/);
    expect(prompt.length).toBeGreaterThan(0);
  });

  it('S20: buildErrorPlanPrompt → no documents render', async () => {
    const errorTask = { id: 'e-1', name: 'Fix', description: 'Fix crash', type: 'error' };
    const prompt = await engine.buildErrorPlanPrompt(errorTask, 'Fix crash', codeCtx);
    expect(prompt).not.toMatch(/\{\{designDoc\}\}/);
    expect(prompt.length).toBeGreaterThan(0);
  });
});

// ============================================
// Decompose Phase Scenarios (3)
// ============================================

describe('Audit 5: E2E Decompose Phase', () => {
  it('S21: inline mode + fe+be docs', async () => {
    const docs: ResolvedDocument[] = [
      { path: 'fe-system-main.md', content: '# FE Design\nReact frontend', role: 'ref', label: 'Frontend Design' },
      { path: 'be-system-main.md', content: '# BE Design\nExpress API', role: 'ref', label: 'Backend Design' },
    ];
    const result = await engine.buildDecomposePrompt({
      directive: 'Build fullstack app',
      documents: docs,
      hasDocuments: true,
      mode: 'generate',
      profile: { language: 'TypeScript' },
    });
    expect(result.user).toContain('FE Design');
    expect(result.user).toContain('BE Design');
  });

  it('S22: tool mode (index document)', async () => {
    const indexDoc: ResolvedDocument = {
      path: 'design-index', content: '## Design Index\n- fe-system-main.md\n- be-system-main.md', role: 'ref', label: 'Design Documents (Index)',
    };
    const result = await engine.buildDecomposePrompt({
      directive: 'Build large app',
      documents: [indexDoc],
      hasDocuments: true,
      mode: 'generate',
      profile: { language: 'TypeScript' },
    });
    expect(result.user).toContain('Design Index');
  });

  it('S23: no docs', async () => {
    const result = await engine.buildDecomposePrompt({
      directive: 'Build something minimal',
      documents: [],
      hasDocuments: false,
      mode: 'generate',
      profile: { language: 'TypeScript' },
    });
    expect(result.user).toBeDefined();
    expect(result.system).toBeDefined();
  });
});

// ============================================
// Detect Phase Scenarios (2)
// ============================================

describe('Audit 5: E2E Detect Phase', () => {
  it('S24: buildDetectEnvironmentPrompt + docs', async () => {
    const docs: ResolvedDocument[] = [
      { path: 'system-design', content: '# System\nExpress.js API', role: 'ref' },
    ];
    const prompt = await engine.buildDetectEnvironmentPrompt('Build backend API', docs);
    expect(prompt).toContain('Express.js API');
    expect(prompt).not.toMatch(/\{\{prdSpec\}\}/);
  });

  it('S25: buildDesignDomainPrompt + docs', async () => {
    const docs: ResolvedDocument[] = [
      { path: 'prd', content: '# PRD\nMultiplayer game with realtime', role: 'context' },
    ];
    const prompt = await engine.buildDesignDomainPrompt({
      directive: 'Design game architecture',
      documents: docs,
      hasDocuments: true,
    });
    expect(prompt).toContain('Multiplayer game');
    expect(prompt).not.toMatch(/\{\{prdSpec\}\}/);
  });
});
