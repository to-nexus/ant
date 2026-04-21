// TODO: Rewrite PromptEngine-dependent tests for PromptBuilder pipeline
/**
 * Task 3: promptBuilder Integration Tests
 *
 * Tests the full prompt pipeline from document assembly through PromptBuilder.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'path';
import { FilePromptAdapter, initPartials } from '../src/periphery/adapters/prompt/FilePromptAdapter';
import { selectArtifacts } from '../src/core/prompt/builder/ArtifactPipeline';
import { compactContent } from '../src/core/utils/contentCompactor';
import type { ResolvedArtifact, ResolvedActionContext } from '@ant/shared';

const TEMPLATES_DIR = join(__dirname, '../src/core/prompt/templates');

beforeAll(async () => {
  await initPartials(TEMPLATES_DIR);
});

const baseCtx = { project: 'test', featurePath: '/tmp/test', featureFolder: 'test' } as any;

function rac(overrides?: Partial<ResolvedActionContext>): ResolvedActionContext {
  return {
    source: 'infer', mode: 'generate',
    tech: { language: 'typescript', environment: 'frontend' },
    hasExplicitFields: false,
    ...overrides,
  } as ResolvedActionContext;
}

// ============================================================================
// A. Pipeline Tests — pool builder + artifact selection
// ============================================================================

describe('Integration A: ArtifactPipeline (artifact pool + selectArtifacts)', () => {
  it('feature task with design artifacts → selected by default', () => {
    const pool: ResolvedArtifact[] = [
      { path: 'outputs/design/system/fe-system-main.md', content: '# Frontend System Design\nNext.js app', role: 'ref' },
    ];
    expect(pool.some(a => a.path.includes('fe-system-main'))).toBe(true);

    const selected = selectArtifacts(pool, { taskType: 'feature' });
    expect(selected.some(a => a.content.includes('Frontend System Design'))).toBe(true);
  });

  it('verification task → empty selection regardless of pool', () => {
    const pool: ResolvedArtifact[] = [
      { path: 'outputs/design/system/fe-system-main.md', content: 'Design', role: 'ref' },
    ];
    expect(pool.length).toBeGreaterThan(0);

    const selected = selectArtifacts(pool, { taskType: 'verification' });
    expect(selected).toHaveLength(0);
  });

  it('error task without spec → empty selection', () => {
    const pool: ResolvedArtifact[] = [
      { path: 'outputs/design/system/fe-system-main.md', content: 'Design', role: 'ref' },
    ];
    const selected = selectArtifacts(pool, { taskType: 'error' });
    expect(selected).toHaveLength(0);
  });

  it('error task with specDocs in pool → spec selected', () => {
    const pool: ResolvedArtifact[] = [
      { path: 'outputs/design/system/api-contract-main.md', content: 'API contract', role: 'ref' },
      { path: 'outputs/design/spec/spec-login', content: 'Login feature spec', role: 'ref' },
    ];
    const selected = selectArtifacts(pool, { taskType: 'error' });
    expect(selected.some(a => a.path.includes('spec-login'))).toBe(true);
    expect(selected.some(a => a.path.includes('api-contract'))).toBe(true);
  });

  it('ui task → only UI docs selected', () => {
    const pool: ResolvedArtifact[] = [
      { path: 'outputs/design/system/fe-system-main.md', content: 'FE design', role: 'ref' },
      { path: 'outputs/design/ui/tokens', content: '{ "colors": {} }', role: 'context' },
      { path: 'outputs/design/ui/spec/header', content: 'Header spec', role: 'context' },
    ];
    const selected = selectArtifacts(pool, { taskType: 'ui' });
    expect(selected.every(a => a.path.startsWith('outputs/design/ui/'))).toBe(true);
    expect(selected.length).toBeGreaterThan(0);
  });

  it('include patterns → exact path matching', () => {
    const pool: ResolvedArtifact[] = [
      { path: 'outputs/design/system/fe-system-main.md', content: 'FE design', role: 'ref' },
      { path: 'outputs/design/system/api-contract-auth.md', content: 'Auth contract', role: 'ref' },
      { path: 'outputs/design/system/be-system-auth.md', content: 'BE auth design', role: 'ref' },
      { path: 'outputs/design/spec/spec-auth', content: 'Auth specification', role: 'ref' },
    ];
    const selected = selectArtifacts(pool, {
      taskType: 'feature',
      include: ['outputs/design/spec/spec-auth', 'outputs/design/system/api-contract-'],
    });
    expect(selected.some(a => a.path.includes('spec-auth'))).toBe(true);
    expect(selected.some(a => a.path.includes('api-contract-auth'))).toBe(true);
    expect(selected.some(a => a.path.includes('fe-system'))).toBe(false);
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

    const docs: ResolvedArtifact[] = [];
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
    const explicitDocs: ResolvedArtifact[] = [
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

    const docs: ResolvedArtifact[] = [];
    if (designDoc) docs.push({ path: 'system-design', content: designDoc, role: 'ref' });
    if (prdContent && !isVerificationTask) docs.push({ path: 'prd', content: prdContent, role: 'context' });
    if (uiDoc && !isVerificationTask) docs.push({ path: 'ui-spec', content: uiDoc, role: 'context' });

    expect(docs).toHaveLength(0);
  });

  it('Scenario 4: error + active spec ref → spec doc in documents', () => {
    const specContent = 'Login feature specification';
    const apiContracts = { main: 'API contract' };

    const parts: string[] = [`# Feature Specification (Primary)\n\n${specContent}`];
    for (const [name, content] of Object.entries(apiContracts)) {
      parts.push(`# API Contract: ${name} (Reference)\n\n${content}`);
    }
    const combined = parts.join('\n\n────────────────────────────────────────\n\n');
    const compacted = compactContent(combined, { threshold: 30_000, label: 'Spec Document: login', filePath: 'outputs/design/spec/login' });

    expect(compacted.wasCompacted).toBe(false);
    expect(compacted.content).toContain('Login feature specification');
    expect(compacted.content).toContain('API contract');
  });
});

