/**
 * decompose shared-module create/modify symmetry regression guard.
 *
 * Locks the fix for the "skeleton-then-extend shared surface" ownership gap:
 * the parallel-execution observation target flags "create OR modify" of a
 * shared module, but the binding constraint historically resolved CREATE only,
 * leaving the MODIFY mode (2+ different-group feature tasks extending the same
 * shared file in place — e.g. each adding endpoints to one API port) with an
 * observation but no resolution. That asymmetry let concurrent in-place
 * modifications race on shared infra files (admin-api-port/http/mock incident).
 *
 * The fix completes the create/modify pair in `rules.md` Parallel Execution:
 * - checkpoint observes "create — or each extend in place — the same module"
 * - constraint binds "CREATE or MODIFY ... MUST share the same parallelGroup"
 * - contract-fixed surfaces prefer a single owning task over many modifiers
 *
 * It is intentionally stack-neutral and instance-free (no api-client / port /
 * adapter / backend enumeration) — `rules.md` (default variant) is injected for
 * every stack, so the rule states the create-vs-modify MODE, not symptoms.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'path';
import { readFileSync } from 'node:fs';
import {
  FilePromptAdapter,
  initPartials,
} from '../../src/periphery/adapters/prompt/FilePromptAdapter';

const TEMPLATES_DIR = join(__dirname, '../../src/core/prompt/templates');
const DECOMPOSE_RULES_PATH = join(
  TEMPLATES_DIR,
  'jobs/code/nodes/decompose/variants/default/rules.md',
);

const BASE_VARS: Record<string, any> = {
  directive: 'Implement multi-feature app consuming one shared API contract',
  currentTask: undefined,
  resolvedAction: undefined,
  techTier: { language: 'typescript', stack: 'fullstack' },
  hasExistingCode: true,
  codebaseFilePaths: [],
  fileList: '',
  hasDocuments: false,
  documents: [],
  hasCompactedArtifacts: false,
  hasErrorInDirective: false,
  hasUi: false,
  uiSource: undefined,
  hasRuntimeError: false,
  isExplicitPipeline: false,
  visualTierActive: false,
  gameArtTierActive: false,
  gameContentTierActive: false,
  domainTierActive: false,
  needsBoundaryClassification: false,
  specClarifyBypassed: false,
  intentClarifyDisabled: true,
  isPriorityFromSpec: false,
};

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('decompose shared-module create/modify symmetry', () => {
  let adapter: FilePromptAdapter;

  beforeAll(async () => {
    await initPartials(TEMPLATES_DIR);
    adapter = new FilePromptAdapter(TEMPLATES_DIR);
  });

  it('checkpoint observes in-place extension, not only creation', () => {
    const src = read(DECOMPOSE_RULES_PATH);
    expect(src).toContain(
      'create — or each extend in place — the same helper file, adapter implementation, or utility module',
    );
  });

  it('constraint binds CREATE or MODIFY to the same parallelGroup', () => {
    const src = read(DECOMPOSE_RULES_PATH);
    expect(src).toContain(
      'Tasks that will CREATE or MODIFY the same shared source file MUST share the same parallelGroup',
    );
    // The orphaned create-only phrasing must not reappear (the asymmetry root).
    expect(src).not.toContain(
      'Tasks that will CREATE the same source file MUST share the same parallelGroup.',
    );
  });

  it('contract-fixed surfaces prefer a single owning task over many modifiers', () => {
    const src = read(DECOMPOSE_RULES_PATH);
    expect(src).toContain('complete content is fixed by an upstream contract/spec');
    expect(src).toContain('a single owning foundation/platform task that authors it in full');
    expect(src).toContain('without modifying it in-place');
  });

  it('stays stack-neutral and instance-free (no frontend-leaning enumeration)', () => {
    const src = read(DECOMPOSE_RULES_PATH);
    // FPOP/SBS: the modify constraint must not name symptom instances or a stack.
    expect(src).not.toContain('API-client / port / adapter layer');
    expect(src).not.toContain('to its backend');
  });

  it('rendered decompose rules preserve the create/modify constraint', async () => {
    const output = await adapter.render(
      'jobs/code/nodes/decompose/variants/default/rules',
      BASE_VARS,
    );
    expect(output).toContain(
      'Tasks that will CREATE or MODIFY the same shared source file MUST share the same parallelGroup',
    );
    expect(output).toContain('complete content is fixed by an upstream contract/spec');
  });
});
