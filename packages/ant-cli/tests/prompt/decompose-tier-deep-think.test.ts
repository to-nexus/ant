/**
 * decompose tier-deep-think partial regression guard.
 *
 * Locks the SSOT split between rules.md (HOW container) and the
 * tier-deep-think partial (per-tier responsibility matrix).
 *
 * Invariants:
 * - rules.md must reference the partial via `{{> }}` and must NOT
 *   re-declare the legacy line 38-44 deep-think / Tier 4 enumeration body
 *   (single SSOT — partial owns it).
 * - The partial expresses Tier 4 / Tier 3 / Tier 2 blocks side-by-side
 *   with NO Handlebars `{{#if (eq executionTier N)}}` conditionals
 *   (executionTier is the LLM's classification output, unknown at render
 *   time — gating on it would always evaluate false).
 * - Tier 3 must keep the legitimate `[feature × 1 + verification × 1]`
 *   shape escape hatch (otherwise decompose over-splits when deep-think
 *   converges on a single coherent unit).
 * - Rendered rules.md surfaces all three tier blocks in one prompt so the
 *   LLM can self-classify and apply the matching row.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'path';
import { readFileSync } from 'node:fs';
import {
  FilePromptAdapter,
  initPartials,
} from '../../src/periphery/adapters/prompt/FilePromptAdapter';

const TEMPLATES_DIR = join(__dirname, '../../src/core/prompt/templates');
const RULES_PATH = join(
  TEMPLATES_DIR,
  'jobs/code/nodes/decompose/variants/default/rules.md',
);
const PARTIAL_PATH = join(
  TEMPLATES_DIR,
  'jobs/code/nodes/decompose/variants/default/tier-deep-think.md',
);
const PARTIAL_NAME =
  'jobs/code/nodes/decompose/variants/default/tier-deep-think';

const BASE_VARS: Record<string, any> = {
  directive: 'Add a debounce to the search input',
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

describe('decompose tier-deep-think partial', () => {
  let adapter: FilePromptAdapter;

  beforeAll(async () => {
    await initPartials(TEMPLATES_DIR);
    adapter = new FilePromptAdapter(TEMPLATES_DIR);
  });

  describe('source files', () => {
    it('rules.md includes the partial via Handlebars partial reference', () => {
      const src = read(RULES_PATH);
      expect(src).toContain(`{{> ${PARTIAL_NAME}}}`);
    });

    it('rules.md no longer inlines the legacy deep-think principle body', () => {
      const src = read(RULES_PATH);
      // Legacy text moved into the partial — ensure no duplicate copy lingers in rules.md.
      expect(src).not.toContain(
        '**Constraint — deep-think principle (Tier 2 / Tier 3 directive cases, no design refs)**',
      );
      expect(src).not.toContain('**Constraint — Tier 4 task enumeration**');
    });

    it('partial expresses all three tier blocks side by side', () => {
      const src = read(PARTIAL_PATH);
      expect(src).toContain('### Tier 4 — Document-Anchored Decomposition');
      expect(src).toContain(
        '### Tier 3 — Problem Discovery, Not Solution Discovery',
      );
      expect(src).toContain('### Tier 2 — Single-Unit Problem Identification');
      expect(src).toContain('### Tier 0 / 1 — Out of Scope');
    });

    it('partial does NOT gate tier blocks behind Handlebars conditionals', () => {
      // executionTier is the LLM's classification output, unknown at render
      // time. A `{{#if (eq executionTier N)}}` block would never render the
      // matching tier guidance because the variable is undefined when the
      // prompt is built. The partial therefore expresses every tier block
      // unconditionally; the LLM self-classifies and applies the matching row.
      const src = read(PARTIAL_PATH);
      expect(src).not.toMatch(/\{\{#if\s*\(eq\s+executionTier/);
    });

    it('partial keeps the Tier 3 single-feature escape hatch', () => {
      const src = read(PARTIAL_PATH);
      // Without this clause decompose over-splits whenever a Tier 3 directive
      // truly converges on a single coherent unit (e.g. "add debounce to
      // search input") — the LLM would manufacture artificial siblings to
      // satisfy the >= 2 rule. The partial preserves the legitimate
      // [feature × 1 + verification × 1] shape so plan can fan out via
      // batches[] later.
      expect(src).toContain(
        'legitimate `[feature × 1 + verification × 1]` shape',
      );
      expect(src).toContain('ONLY when the directive itself names');
    });

    it('partial captures the Tier 4 faithful-enumeration constraint', () => {
      const src = read(PARTIAL_PATH);
      expect(src).toContain(
        'Every enumerated unit MUST appear as a distinct `<task>`',
      );
      expect(src).toContain('Do NOT collapse multiple enumerated units');
    });

    it('partial scopes problem identification to decompose and solution design to plan', () => {
      const src = read(PARTIAL_PATH);
      // The asymmetry the change fixes: decompose must own problem
      // identification at Tier 3 / 2 (otherwise plan cannot recover bad
      // boundaries), but must NOT pre-decide solutions (plan owns those).
      expect(src).toContain('Problem identification');
      expect(src).toContain('Solution design');
      expect(src).toContain("per-task `plan`");
    });
  });

  describe('rendered output via rules.md', () => {
    it('renders all three tier blocks together so LLM can self-classify', async () => {
      const rendered = await adapter.render(
        'jobs/code/nodes/decompose/variants/default/rules',
        BASE_VARS,
      );
      expect(rendered).toContain('Decompose Responsibility by Tier');
      expect(rendered).toContain('### Tier 4 — Document-Anchored Decomposition');
      expect(rendered).toContain(
        '### Tier 3 — Problem Discovery, Not Solution Discovery',
      );
      expect(rendered).toContain(
        '### Tier 2 — Single-Unit Problem Identification',
      );
    });

    it('rendered output exposes the Tier 3 self-check reminders', async () => {
      const rendered = await adapter.render(
        'jobs/code/nodes/decompose/variants/default/rules',
        BASE_VARS,
      );
      // FPOP "Reminders for Blind Spots" — these are the load-bearing
      // self-check questions that catch over-split / under-split / missing
      // cross-cutting concerns.
      expect(rendered).toContain(
        'Have I identified what is genuinely problematic',
      );
      expect(rendered).toContain('Are there implicit surfaces');
    });

    it('rendered output does NOT leak duplicate legacy phrasing', async () => {
      const rendered = await adapter.render(
        'jobs/code/nodes/decompose/variants/default/rules',
        BASE_VARS,
      );
      // The partial body should appear exactly once. If the legacy inline
      // copy were resurrected in rules.md the heading would render twice.
      const occurrences = rendered.match(/Decompose Responsibility by Tier/g);
      expect(occurrences).not.toBeNull();
      expect(occurrences!.length).toBe(1);
    });
  });
});
