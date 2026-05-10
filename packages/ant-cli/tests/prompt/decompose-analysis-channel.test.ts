/**
 * Tier 3 cross-task `<analysis>` channel regression guard.
 *
 * Locks the SSOT wire for the cross-task analysis brief that decompose
 * seals at executionTier=3 and every per-task plan reads via
 * `state.analysis` → prompt vars → analysis-block partial.
 *
 * Invariants this test pins:
 * - tier-deep-think.md Tier 3 block requires `<analysis>` emission
 *   (per-case content axes: feature / error) and forbids it at Tier 4.
 * - tier-deep-think.md Tier 3 block uses the precision-corrected mental
 *   moves: "Problem identification + Solution direction" (decompose) /
 *   "Solution implementation detail" (plan).
 * - plan/base.md includes the analysis-block partial.
 * - analysis-block partial gates on `{{#if hasAnalysis}}` and renders
 *   the brief body via triple-stash `{{{analysis}}}`.
 * - responseParser extracts `<analysis>` body and surfaces it as
 *   `parsed.analysis` for decompose/index.ts to write into state.
 * - OutputTagRegistry registers `<analysis>` with the consumed-suppressed
 *   sealed-state axis so the canonical tag walker auto-suppresses raw
 *   XML in chat.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'path';
import { readFileSync } from 'node:fs';
import {
  FilePromptAdapter,
  initPartials,
} from '../../src/periphery/adapters/prompt/FilePromptAdapter';
import { parseLLMResponse } from '../../src/agents/architect/graph/code/nodes/decompose/responseParser';
import { allTags, findTag } from '../../src/core/streaming/OutputTagRegistry';
import { SpecialTagTransformer } from '../../src/core/streaming/transformers/SpecialTagTransformer';

const TEMPLATES_DIR = join(__dirname, '../../src/core/prompt/templates');
const TIER_DEEP_THINK_PATH = join(
  TEMPLATES_DIR,
  'jobs/code/nodes/decompose/variants/default/tier-deep-think.md',
);
const PLAN_BASE_PATH = join(
  TEMPLATES_DIR,
  'jobs/code/nodes/plan/base.md',
);
const ANALYSIS_BLOCK_PATH = join(
  TEMPLATES_DIR,
  'jobs/code/nodes/plan/injections/analysis-block.md',
);
const ANALYSIS_BLOCK_NAME =
  'jobs/code/nodes/plan/injections/analysis-block';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

const MINIMAL_DECOMPOSE_RESPONSE = `
<executionTier>3</executionTier>
<techTier>{"stack":"frontend","language":"typescript","framework":null}</techTier>
<analysis>
Macro goal: add debounce to search input so typing pauses settle before query.
Cross-cutting concerns: input handler memoization, controlled component state.
</analysis>
<tasks>
<task>{"id":"feature-1","name":"Debounce search input","type":"feature","priority":300,"description":"Wire a debounced handler for the search input so the query fires after typing settles.","selfVerifyOnDone":false}</task>
<task>{"id":"verify-1","name":"Verify","type":"verification","priority":1000,"description":"Build / typecheck / test."}</task>
</tasks>
`;

describe('decompose analysis channel — source files', () => {
  describe('tier-deep-think.md (decompose contract)', () => {
    const src = read(TIER_DEEP_THINK_PATH);

    it('Tier 3 block uses the precision-corrected mental moves', () => {
      // Phase 2 정정: Phase 1 의 too-absolute "Solution design (NOT decompose's job)"
      // 를 "Solution direction (decompose) / Solution implementation detail (plan)"
      // 로 교체. 사용자 정의 — 솔루션 방향은 decompose, 구현 디테일은 plan.
      expect(src).toContain('Problem identification + Solution direction');
      expect(src).toContain('Solution implementation detail');
      expect(src).toContain('Feature case');
      expect(src).toContain('Error case');
      expect(src).toContain('silver bullet');
    });

    it('Tier 3 block requires <analysis> emission with per-case content axes', () => {
      expect(src).toContain('Required emission — `<analysis>...</analysis>` (Tier 3 only)');
      expect(src).toContain('System-integration direction');
      expect(src).toContain('side-effect avoidance');
      expect(src).toContain('Cross-cutting concerns');
      expect(src).toContain('implicit surfaces');
      // Position contract — body must precede <tasks>.
      expect(src).toContain('BEFORE `<tasks>`');
    });

    it('Tier 4 block forbids <analysis> emission', () => {
      expect(src).toContain('Do NOT emit `<analysis>...</analysis>`');
      expect(src).toContain('cross-task SSOT at Tier 4');
    });

    it('Tier 3 block keeps the Forbidden-in-description boundary (plan owns implementation detail)', () => {
      expect(src).toContain('concrete file paths');
      expect(src).toContain('API names / signatures');
    });
  });

  describe('plan template wiring', () => {
    it('plan/base.md includes the analysis-block partial', () => {
      const src = read(PLAN_BASE_PATH);
      expect(src).toContain(`{{> ${ANALYSIS_BLOCK_NAME}}}`);
    });

    it('analysis-block partial gates on hasAnalysis and renders the brief verbatim', () => {
      const src = read(ANALYSIS_BLOCK_PATH);
      expect(src).toContain('{{#if hasAnalysis}}');
      // Triple-stash so markdown content renders without HTML escaping.
      expect(src).toContain('{{{analysis}}}');
      // Responsibility contract: alignment, not override.
      expect(src).toContain('aligned with this brief');
      expect(src).toContain('Cross-cutting concerns');
    });
  });

  describe('responseParser <analysis> extraction', () => {
    it('extracts the body from a Tier 3 response', () => {
      const parsed = parseLLMResponse(MINIMAL_DECOMPOSE_RESPONSE);
      expect(parsed.analysis).toBeDefined();
      expect(parsed.analysis).toContain('Macro goal');
      expect(parsed.analysis).toContain('Cross-cutting concerns');
    });

    it('returns undefined when <analysis> is missing', () => {
      const noAnalysis = MINIMAL_DECOMPOSE_RESPONSE.replace(
        /<analysis>[\s\S]*?<\/analysis>/,
        '',
      );
      const parsed = parseLLMResponse(noAnalysis);
      expect(parsed.analysis).toBeUndefined();
    });

    it('returns undefined for an empty <analysis> body', () => {
      const empty = MINIMAL_DECOMPOSE_RESPONSE.replace(
        /<analysis>[\s\S]*?<\/analysis>/,
        '<analysis>   \n  </analysis>',
      );
      const parsed = parseLLMResponse(empty);
      expect(parsed.analysis).toBeUndefined();
    });

    it('handles multiline markdown body without truncation', () => {
      const multiline = `
<executionTier>3</executionTier>
<techTier>{"stack":"frontend","language":"typescript","framework":null}</techTier>
<analysis>
## Diagnosis

Root cause is a race in the auth flow.

- step 1
- step 2
- step 3
</analysis>
<tasks>
<task>{"id":"error-1","name":"Fix auth race","type":"error","priority":600,"description":"Address the auth race surfaced by the diagnosis."}</task>
<task>{"id":"verify-1","name":"Verify","type":"verification","priority":1000,"description":"Build / test."}</task>
</tasks>
`;
      const parsed = parseLLMResponse(multiline);
      expect(parsed.analysis).toContain('## Diagnosis');
      expect(parsed.analysis).toContain('step 3');
    });
  });

  describe('OutputTagRegistry <analysis> entry', () => {
    it('is registered under the metadata / consumed-suppressed / sealed-state axis', () => {
      const entry = findTag('analysis');
      expect(entry).toBeDefined();
      expect(entry.axis.intent).toBe('metadata');
      expect(entry.axis.processing).toContain('consumed-suppressed');
      expect(entry.axis.persistence).toContain('sealed-state');
      expect(entry.axis.blocking).toBe('non-blocking');
    });

    it('is in the canonical tag walk so SpecialTagTransformer auto-suppresses raw XML', () => {
      // Walker pattern (SpecialTagTransformer line 21-25, 66-68): a registry
      // entry without a `transform` hook consumes silently. Confirm the
      // <analysis> match goes through that fallback so the body never leaks
      // to chat as raw XML.
      const names = allTags().map((t) => t.name);
      expect(names).toContain('analysis');

      const transformer = new SpecialTagTransformer('en');
      const result = transformer.transform(
        '<analysis>internal brief — must not reach chat</analysis>',
      );
      expect(result.consumed).toBe(true);
      expect((result as { text?: string }).text).toBeUndefined();
    });
  });
});

describe('decompose analysis channel — rendered plan output', () => {
  let adapter: FilePromptAdapter;

  beforeAll(async () => {
    await initPartials(TEMPLATES_DIR);
    adapter = new FilePromptAdapter(TEMPLATES_DIR);
  });

  // Minimal vars to render plan/base without exploding on missing fields.
  // The rest of plan/base.md gracefully falls through `{{#if X}}` gates
  // when their flags are absent, so this set is enough to exercise the
  // analysis-block injection path.
  const baseVars: Record<string, any> = {
    taskName: 'task',
    taskDescription: 'desc',
    directive: '',
    taskType: 'feature',
    documents: [],
    hasDocuments: false,
    isSpecDriven: false,
    projectCodeContext: '',
    directoryTree: '',
    hasProjectCodeContext: false,
    violationsText: '',
    isRetry: false,
    remainingTasks: [],
    hasRemainingTasks: false,
    hasTools: false,
    resolvedAction: undefined,
    hasSystemDesign: false,
    hasUi: false,
    uiSource: undefined,
    featureContext: undefined,
    antrulesContent: '',
    hasFrontend: false,
    hasBackend: false,
    serviceVirtualizationContractActive: false,
    serviceVirtualizationDataActive: false,
    serviceVirtualizationImageryActive: false,
  };

  it('renders the brief body and the alignment principle when hasAnalysis is true', async () => {
    const rendered = await adapter.render(
      'jobs/code/nodes/plan/base',
      {
        ...baseVars,
        analysis:
          'Macro goal: stabilize login flow.\n\nCross-cutting: redirect race.',
        hasAnalysis: true,
      },
    );
    expect(rendered).toContain('Job-Level Analysis Brief');
    expect(rendered).toContain('Macro goal: stabilize login flow.');
    expect(rendered).toContain('aligned with this brief');
  });

  it('renders nothing for the analysis block when hasAnalysis is false', async () => {
    const rendered = await adapter.render(
      'jobs/code/nodes/plan/base',
      {
        ...baseVars,
        analysis: '',
        hasAnalysis: false,
      },
    );
    expect(rendered).not.toContain('Job-Level Analysis Brief');
  });
});
