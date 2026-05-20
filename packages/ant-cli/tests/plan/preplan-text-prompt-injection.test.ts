/**
 * Plan B — `parent-pre-plan` partial wiring + `buildPlanPrompt` var contract.
 *
 * After Plan B, feature / UI batch-split sub-tasks enter the plan-tool-loop
 * (no identity-shortcut) and the parent's `prePlanText` is surfaced as plan
 * INPUT via `nodes/plan/injections/parent-pre-plan.md`. This locks:
 *
 *   1. The partial renders its `Parent Sub-Task Pre-Plan` block when
 *      `hasPrePlanText` is true; it renders nothing when false.
 *   2. The partial uses triple-stash `{{{prePlanText}}}` so JSON braces /
 *      backticks in the parent's batch shape are preserved verbatim.
 *   3. `buildPlanPrompt` (generic path — feature / UI) populates
 *      `prePlanText` + `hasPrePlanText` vars on the render call.
 *
 * Regression guard: a renderer change that double-escapes `prePlanText` or
 * a wiring change that drops the vars would silently strip drift-detection
 * guidance from the LLM input.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { join } from 'path';
import {
  FilePromptAdapter,
  initPartials,
} from '../../src/periphery/adapters/prompt/FilePromptAdapter';
import { buildPlanPrompt } from '../../src/agents/architect/graph/code/nodes/plan/llm/prompt';
import type { ArchitectGraphState } from '../../src/agents/architect/graph/code/state';
import type { CodeTask } from '../../src/agents/architect/types/task';

const TEMPLATES_DIR = join(__dirname, '../../src/core/prompt/templates');
const PARTIAL_NAME = 'jobs/code/nodes/plan/injections/parent-pre-plan';

const PRE_PLAN_JSON = JSON.stringify({
  task: { id: 'batch-3', goal: 'tweet-detail-orchestration' },
  goal: 'tweet-detail-orchestration',
  rationale: 'compose sibling components into the orchestrator',
  implementation: {
    modify: [],
    create: ['app/(tweet)/[id]/page.tsx'],
    delete: [],
  },
  parentReasoning:
    'parent decided `TweetOriginalDisplay` is the canonical export name for the original-tweet body; siblings must import that symbol',
});

describe('parent-pre-plan partial — render contract', () => {
  let adapter: FilePromptAdapter;

  beforeAll(async () => {
    await initPartials(TEMPLATES_DIR);
    adapter = new FilePromptAdapter(TEMPLATES_DIR);
  });

  it('renders the slice-declaration block when isSliceDeclaration is true', async () => {
    const rendered = await adapter.render(PARTIAL_NAME, {
      hasPrePlanText: true,
      isSliceDeclaration: true,
      prePlanText: PRE_PLAN_JSON,
    });
    expect(rendered).toContain('Parent Sub-Task Pre-Plan');
    expect(rendered).toContain('Slice declaration');
    expect(rendered).toContain('Slice boundary is non-negotiable');
    // diagnostic-carry body is gated separately
    expect(rendered).not.toContain('Diagnostic carry');
  });

  it('renders the diagnostic-carry block when isDiagnosticCarry is true', async () => {
    const rendered = await adapter.render(PARTIAL_NAME, {
      hasPrePlanText: true,
      isDiagnosticCarry: true,
      prePlanText: PRE_PLAN_JSON,
    });
    expect(rendered).toContain('Parent Sub-Task Pre-Plan');
    expect(rendered).toContain('Diagnostic carry');
    expect(rendered).toContain('Verify file existence and export names');
    expect(rendered).not.toContain('Slice declaration');
  });

  it('renders the sibling-divergence blind spot only when hasCrossBatchContracts is true', async () => {
    const withContracts = await adapter.render(PARTIAL_NAME, {
      hasPrePlanText: true,
      isSliceDeclaration: true,
      hasCrossBatchContracts: true,
      prePlanText: PRE_PLAN_JSON,
    });
    expect(withContracts).toContain('Sibling sub-tasks ran in parallel');
    expect(withContracts).toContain('Cross-batch contracts are non-negotiable');

    // dotv1 fix lock — test-code-shape sub-task (slice-decl without cross-batch
    // contracts) must NOT receive the sibling-output verification mandate.
    // Sibling test-code sub-tasks write disjoint test files; there is no
    // shared export to verify, so the mandate would be unsatisfiable and
    // drive the LLM into a re-read cycle.
    const withoutContracts = await adapter.render(PARTIAL_NAME, {
      hasPrePlanText: true,
      isSliceDeclaration: true,
      hasCrossBatchContracts: false,
      prePlanText: PRE_PLAN_JSON,
    });
    expect(withoutContracts).not.toContain('Sibling sub-tasks ran in parallel');
    expect(withoutContracts).not.toContain('Cross-batch contracts are non-negotiable');
  });

  it('renders empty (or whitespace-only) when hasPrePlanText is false', async () => {
    const rendered = await adapter.render(PARTIAL_NAME, {
      hasPrePlanText: false,
      prePlanText: '',
    });
    expect(rendered).not.toContain('Parent Sub-Task Pre-Plan');
    expect(rendered).not.toContain('Parent pre-plan');
    expect(rendered.trim()).toBe('');
  });

  it('preserves prePlanText verbatim via triple-stash (JSON braces, backticks)', async () => {
    const tricky =
      '{"k":"v","nested":{"a":1}} `inline` and "double-quote" — verbatim';
    const rendered = await adapter.render(PARTIAL_NAME, {
      hasPrePlanText: true,
      prePlanText: tricky,
    });
    expect(rendered).toContain(tricky);
    // No HTML entity escaping ({ &#x7B; / } &#x7D; / ` &#x60;)
    expect(rendered).not.toContain('&#x7B;');
    expect(rendered).not.toContain('&#x7D;');
    expect(rendered).not.toContain('&#x60;');
  });

  it('emits the verbatim prePlanText surrounded by a fenced block', async () => {
    const rendered = await adapter.render(PARTIAL_NAME, {
      hasPrePlanText: true,
      prePlanText: PRE_PLAN_JSON,
    });
    expect(rendered).toMatch(/```[\s\S]*"parentReasoning"[\s\S]*```/);
  });
});

describe('buildPlanPrompt — generic path passes prePlanText vars', () => {
  function makeStubBuilder() {
    const renderCalls: Array<{ template: string; vars: Record<string, unknown> }> = [];
    return {
      promptBuilder: {
        render: vi.fn(async (template: string, vars: Record<string, unknown>) => {
          renderCalls.push({ template, vars });
          return `RENDERED:${template}`;
        }),
        renderBasis: vi.fn(async () => ''),
      } as any,
      renderCalls,
    };
  }

  function buildFeatureSubTask(prePlanText: string | undefined): CodeTask {
    return {
      id: 'feat-batch-3',
      name: 'tweet-detail-orchestration',
      description: 'compose sibling components',
      type: 'feature',
      priority: 350,
      ...(prePlanText !== undefined ? { prePlanText } : {}),
    } as CodeTask;
  }

  function buildState(overrides: Partial<ArchitectGraphState> = {}): ArchitectGraphState {
    const { promptBuilder } = makeStubBuilder();
    return {
      deps: { promptBuilder },
      artifacts: [],
      resolvedAction: undefined,
      directive: '',
      featureContext: undefined,
      virtualizationSnapshot: undefined,
      _verifyEntered: false,
      conversations: {},
      recursionCount: 0,
      recursionLimit: 200,
      ...overrides,
    } as unknown as ArchitectGraphState;
  }

  it('passes prePlanText + hasPrePlanText=true when the feature sub-task carries a pre-plan', async () => {
    const { promptBuilder, renderCalls } = makeStubBuilder();
    const task = buildFeatureSubTask(PRE_PLAN_JSON);
    const state = buildState({ deps: { promptBuilder } as any });

    await buildPlanPrompt(state, task, undefined, undefined, undefined, undefined, { hasTools: true });

    const baseCall = renderCalls.find(c => c.template === 'jobs/code/nodes/plan/base');
    expect(baseCall, 'plan/base template was not rendered').toBeDefined();
    expect(baseCall!.vars.hasPrePlanText).toBe(true);
    expect(baseCall!.vars.prePlanText).toBe(PRE_PLAN_JSON);
  });

  it('passes hasPrePlanText=false when no pre-plan is present', async () => {
    const { promptBuilder, renderCalls } = makeStubBuilder();
    const task = buildFeatureSubTask(undefined);
    const state = buildState({ deps: { promptBuilder } as any });

    await buildPlanPrompt(state, task, undefined, undefined, undefined, undefined, { hasTools: true });

    const baseCall = renderCalls.find(c => c.template === 'jobs/code/nodes/plan/base');
    expect(baseCall).toBeDefined();
    expect(baseCall!.vars.hasPrePlanText).toBe(false);
    // Empty string sentinel keeps the Handlebars triple-stash from
    // rendering the literal "undefined".
    expect(baseCall!.vars.prePlanText).toBe('');
  });

  it('treats a sub-50-char prePlanText as absent (matches shortcut gate)', async () => {
    const { promptBuilder, renderCalls } = makeStubBuilder();
    const task = buildFeatureSubTask('short');
    const state = buildState({ deps: { promptBuilder } as any });

    await buildPlanPrompt(state, task, undefined, undefined, undefined, undefined, { hasTools: true });

    const baseCall = renderCalls.find(c => c.template === 'jobs/code/nodes/plan/base');
    expect(baseCall).toBeDefined();
    expect(baseCall!.vars.hasPrePlanText).toBe(false);
  });

  // 5-vars predicate matrix lock — type-based partial gating contract.
  // Each row asserts the four predicate vars derived from `task.type` +
  // `hasPrePlanText`, plus the lineage `batchSplitCount` passthrough.
  // Drift = silent misclassification of a sub-task → wrong partial branch.
  describe('predicate vars matrix (isSliceDeclaration / isDiagnosticCarry / hasCrossBatchContracts)', () => {
    function buildSubTaskOfType(type: CodeTask['type'], prePlanText?: string, batchSplitCount?: number): CodeTask {
      return {
        id: `${type}-batch-x`,
        name: `${type}-batch`,
        description: 'sub-task',
        type,
        priority: 350,
        ...(prePlanText !== undefined ? { prePlanText } : {}),
        ...(batchSplitCount !== undefined ? { batchSplitCount } : {}),
      } as CodeTask;
    }

    async function renderVars(task: CodeTask) {
      const { promptBuilder, renderCalls } = makeStubBuilder();
      const state = buildState({ deps: { promptBuilder } as any });
      await buildPlanPrompt(state, task, undefined, undefined, undefined, undefined, { hasTools: true });
      const baseCall = renderCalls.find(c => c.template === 'jobs/code/nodes/plan/base');
      expect(baseCall, 'plan/base template was not rendered').toBeDefined();
      return baseCall!.vars;
    }

    it('feature sub-task with prePlanText → slice + cross-batch contracts', async () => {
      const vars = await renderVars(buildSubTaskOfType('feature', PRE_PLAN_JSON));
      expect(vars.hasPrePlanText).toBe(true);
      expect(vars.isSliceDeclaration).toBe(true);
      expect(vars.isDiagnosticCarry).toBe(false);
      expect(vars.hasCrossBatchContracts).toBe(true);
    });

    it('ui sub-task with prePlanText → slice + cross-batch contracts', async () => {
      const vars = await renderVars(buildSubTaskOfType('ui', PRE_PLAN_JSON));
      expect(vars.isSliceDeclaration).toBe(true);
      expect(vars.hasCrossBatchContracts).toBe(true);
    });

    it('design-system sub-task with prePlanText → slice + cross-batch contracts', async () => {
      const vars = await renderVars(buildSubTaskOfType('design-system', PRE_PLAN_JSON));
      expect(vars.isSliceDeclaration).toBe(true);
      expect(vars.hasCrossBatchContracts).toBe(true);
    });

    // dotv1 fix — test-code is a slice declaration but has NO cross-batch
    // contracts (sibling tests are disjoint). Verification mandate must
    // not fire here.
    it('test-code sub-task with prePlanText → slice WITHOUT cross-batch contracts', async () => {
      const vars = await renderVars(buildSubTaskOfType('test-code', PRE_PLAN_JSON));
      expect(vars.hasPrePlanText).toBe(true);
      expect(vars.isSliceDeclaration).toBe(true);
      expect(vars.isDiagnosticCarry).toBe(false);
      expect(vars.hasCrossBatchContracts).toBe(false);
    });

    it('error sub-task with prePlanText → diagnostic carry, no slice, no cross-batch', async () => {
      const vars = await renderVars(buildSubTaskOfType('error', PRE_PLAN_JSON));
      expect(vars.hasPrePlanText).toBe(true);
      expect(vars.isSliceDeclaration).toBe(false);
      expect(vars.isDiagnosticCarry).toBe(true);
      expect(vars.hasCrossBatchContracts).toBe(false);
    });

    it('task without prePlanText → all four predicates false (regardless of type)', async () => {
      for (const type of ['feature', 'ui', 'design-system', 'test-code', 'error'] as const) {
        const vars = await renderVars(buildSubTaskOfType(type, undefined));
        expect(vars.hasPrePlanText, `${type}/hasPrePlanText`).toBe(false);
        expect(vars.isSliceDeclaration, `${type}/isSliceDeclaration`).toBe(false);
        expect(vars.isDiagnosticCarry, `${type}/isDiagnosticCarry`).toBe(false);
        expect(vars.hasCrossBatchContracts, `${type}/hasCrossBatchContracts`).toBe(false);
      }
    });

    it('batchSplitCount is surfaced verbatim for lineage tracking', async () => {
      const vars = await renderVars(buildSubTaskOfType('test-code', PRE_PLAN_JSON, 3));
      expect(vars.batchSplitCount).toBe(3);

      const varsDefault = await renderVars(buildSubTaskOfType('test-code', PRE_PLAN_JSON));
      expect(varsDefault.batchSplitCount).toBe(0);
    });
  });
});
