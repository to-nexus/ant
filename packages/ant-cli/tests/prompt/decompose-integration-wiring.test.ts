/**
 * decompose integration-wiring split regression guard.
 *
 * Locks the prompt contract that wiring ownership is scoped per integration
 * point (entry-point boundary), not a single project-global wiring task.
 *
 * Scope:
 * - `output-unit-splitting.md` wiring rubric wording
 * - `rules.md` Shared Integration Points wording
 * - Rendered `rules` output includes the same per-point contract
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
const OUTPUT_UNIT_SPLIT_PATH = join(
  TEMPLATES_DIR,
  'jobs/code/nodes/decompose/variants/default/output-unit-splitting.md',
);

const BASE_VARS: Record<string, any> = {
  directive: 'Implement multi-app console and hub wiring',
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
};

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('decompose integration wiring prompt contract', () => {
  let adapter: FilePromptAdapter;

  beforeAll(async () => {
    await initPartials(TEMPLATES_DIR);
    adapter = new FilePromptAdapter(TEMPLATES_DIR);
  });

  it('output-unit-splitting defines ONE wiring task per integration point', () => {
    const src = read(OUTPUT_UNIT_SPLIT_PATH);

    expect(src).toContain('exactly ONE wiring task per shared integration point');
    expect(src).toContain('one wiring task per integration point');
    expect(src).toContain('Multi-app or multi-package projects often have multiple entry roots');

    // Legacy global-singleton wording should not reappear.
    expect(src).not.toContain(
      'emit exactly ONE wiring task: `type: "feature"`, priority 600, owning the integration point file.',
    );
  });

  it('rules.md shared integration points section uses per-point fan-in wording', () => {
    const src = read(DECOMPOSE_RULES_PATH);

    // Neutral host-entry vocabulary: integration points are host entries only
    // (per-unit entries are not on this list). Per-point fan-in contract preserved.
    expect(src).toContain('Which host-entry integration points exist');
    expect(src).toContain('create exactly ONE dedicated integration task');
    expect(src).toContain('If the project has multiple independent host entries');

    // Legacy singleton phrasing should not reappear.
    expect(src).not.toContain(
      'Does the project have a single entry point that must import and wire components from multiple feature tasks?',
    );
  });

  it('rendered decompose rules preserve per-integration-point wiring contract', async () => {
    const output = await adapter.render(
      'jobs/code/nodes/decompose/variants/default/rules',
      BASE_VARS,
    );

    expect(output).toContain('exactly ONE wiring task per shared integration point');
    expect(output).toContain('one integration task per point');
    expect(output).toContain('one wiring owner per integration point');
  });
});

