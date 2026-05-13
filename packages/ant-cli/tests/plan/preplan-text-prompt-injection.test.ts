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

  it('renders the Parent Sub-Task Pre-Plan block when hasPrePlanText is true', async () => {
    const rendered = await adapter.render(PARTIAL_NAME, {
      hasPrePlanText: true,
      prePlanText: PRE_PLAN_JSON,
    });
    expect(rendered).toContain('Parent Sub-Task Pre-Plan');
    // After safe-braking-eagle B (slim batches[]): feature/ui/design-system
    // children receive a slice declaration ("which slice you own" + cross-batch
    // contracts), not a hypothesis to verify. The partial still names the
    // legacy "diagnostic carry" shape for error/test-code children.
    expect(rendered).toContain('Slice declaration');
    expect(rendered).toContain('Diagnostic carry');
    expect(rendered).toContain('Slice boundary is non-negotiable');
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
});
