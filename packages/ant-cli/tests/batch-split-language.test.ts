/**
 * Code-job response-language SSOT regression guards.
 *
 * Locks the contract that batch_split-generated sub-task `name` /
 * `description` (and decompose-generated task labels) follow the user's
 * detected language instead of the legacy English-forced behaviour.
 *
 * Four planes under guard:
 *   1. `jobs/code/base/system.md` no longer carries the "respond in
 *      English" directive (Fix A).
 *   2. `jobs/code/base/injections/response-language.md` partial exists,
 *      is self-gated by `userLanguage !== 'en'`, and is wired into both
 *      `plan/base.md` and `decompose/variants/default/base.md` (Fix C —
 *      template surface).
 *   3. `AutoInjectionResolver` resolves `response-language` for the
 *      code job in execute/direct paths (Fix C — build pipeline surface).
 *   4. `buildPlanPrompt` / decompose enrichedVars / `processDiagnostic
 *      BatchSplit` Final-Verification labels honour `state.context.
 *      userLanguage` (Fix B + Fix D).
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import {
  FilePromptAdapter,
  initPartials,
} from '../src/periphery/adapters/prompt/FilePromptAdapter';
import { AutoInjectionResolver } from '../src/core/prompt/builder/AutoInjectionResolver';
import { buildPlanPrompt } from '../src/agents/architect/graph/code/nodes/plan/llm/prompt';
import { processDiagnosticBatchSplit } from '../src/agents/architect/graph/code/tasks/_shared/batchSplit';
import { TaskQueue } from '../src/agents/architect/types/task';
import type { CodeTask } from '../src/agents/architect/types/task';
import type { ArchitectGraphState } from '../src/agents/architect/graph/code/state';

const TEMPLATES_DIR = join(__dirname, '../src/core/prompt/templates');
const PARTIAL_NAME = 'jobs/code/base/injections/response-language';

describe('Fix A — jobs/code/base/system.md no longer forces English responses', () => {
  it('removes the legacy "respond in English" directive line', async () => {
    const text = await fs.readFile(
      join(TEMPLATES_DIR, 'jobs/code/base/system.md'),
      'utf-8',
    );
    expect(text).not.toMatch(/respond in English/i);
  });

  it('narrows the self-check to code identifiers (not all comments)', async () => {
    const text = await fs.readFile(
      join(TEMPLATES_DIR, 'jobs/code/base/system.md'),
      'utf-8',
    );
    // Original blanket phrase removed
    expect(text).not.toMatch(/Is code in English \(comments, variable names\)/);
    // Narrower phrasing present
    expect(text).toMatch(/Are code identifiers .* in English/);
  });
});

describe('Fix C — response-language partial render contract', () => {
  let adapter: FilePromptAdapter;

  beforeAll(async () => {
    await initPartials(TEMPLATES_DIR);
    adapter = new FilePromptAdapter(TEMPLATES_DIR);
  });

  it('renders nothing when userLanguage is "en" (gate closed)', async () => {
    const rendered = await adapter.render(PARTIAL_NAME, { userLanguage: 'en' });
    expect(rendered.trim()).toBe('');
  });

  it('renders the principle + constraints block when userLanguage is "ko"', async () => {
    const rendered = await adapter.render(PARTIAL_NAME, { userLanguage: 'ko' });
    expect(rendered).toMatch(/Response Language/);
    expect(rendered).toMatch(/Principle/);
    // The user's language is interpolated into both the principle and constraint lines
    expect(rendered).toMatch(/ko/);
    // Code identifiers stay English — explicit carve-out
    expect(rendered).toMatch(/identifiers.*English/i);
  });

  it('is wired into plan/base.md as a partial include', async () => {
    const text = await fs.readFile(
      join(TEMPLATES_DIR, 'jobs/code/nodes/plan/base.md'),
      'utf-8',
    );
    expect(text).toMatch(/{{>\s*jobs\/code\/base\/injections\/response-language\s*}}/);
  });

  it('is wired into decompose/variants/default/base.md as a partial include', async () => {
    const text = await fs.readFile(
      join(
        TEMPLATES_DIR,
        'jobs/code/nodes/decompose/variants/default/base.md',
      ),
      'utf-8',
    );
    expect(text).toMatch(/{{>\s*jobs\/code\/base\/injections\/response-language\s*}}/);
  });

  it('is wired into all plan variants (error / verification / test-code)', async () => {
    for (const variant of ['error', 'verification', 'test-code']) {
      const text = await fs.readFile(
        join(
          TEMPLATES_DIR,
          `jobs/code/nodes/plan/variants/${variant}/base.md`,
        ),
        'utf-8',
      );
      expect(
        text,
        `${variant} plan variant should include response-language partial`,
      ).toMatch(
        /{{>\s*jobs\/code\/base\/injections\/response-language\s*}}/,
      );
    }
  });
});

describe('Fix C — AutoInjectionResolver wires response-language for code job', () => {
  it('includes response-language path for code job on execute node', () => {
    const resolver = new AutoInjectionResolver();
    const out = resolver.resolve({
      job: 'code',
      node: 'execute',
      taskType: 'feature',
      techContext: { taskType: 'feature' } as any,
      techTier: { language: 'typescript-browser', framework: 'react' } as any,
      data: {},
    } as any);
    expect(out).toContain('jobs/code/base/injections/response-language');
  });

  it('does NOT include response-language for design job (design has its own document-language)', () => {
    const resolver = new AutoInjectionResolver();
    const out = resolver.resolve({
      job: 'design',
      node: 'execute',
      taskType: 'feature',
      techContext: { taskType: 'feature' } as any,
      techTier: { language: 'typescript-browser', framework: 'react' } as any,
      data: {},
    } as any);
    expect(out).not.toContain('jobs/code/base/injections/response-language');
    // design keeps its sibling partial
    expect(out).toContain('jobs/design/base/injections/document-language');
  });
});

describe('Fix B — buildPlanPrompt passes userLanguage to plan/base render', () => {
  function makeStubBuilder() {
    const renderCalls: Array<{ template: string; vars: Record<string, unknown> }> = [];
    const promptBuilder = {
      render: vi.fn(async (template: string, vars: Record<string, unknown>) => {
        renderCalls.push({ template, vars });
        return `RENDERED:${template}`;
      }),
      renderBasis: vi.fn(async () => ''),
    };
    return { promptBuilder: promptBuilder as any, renderCalls };
  }

  function buildState(userLanguage: 'en' | 'ko' | undefined): ArchitectGraphState {
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
      context: userLanguage !== undefined ? { userLanguage } : {},
    } as unknown as ArchitectGraphState;
  }

  function buildFeatureTask(): CodeTask {
    return {
      id: 'feat-1',
      name: 'orchestrate',
      description: 'compose components',
      type: 'feature',
      priority: 350,
    } as CodeTask;
  }

  it('forwards state.context.userLanguage="ko" to the plan/base template vars', async () => {
    const { promptBuilder, renderCalls } = makeStubBuilder();
    const state = {
      ...buildState('ko'),
      deps: { promptBuilder },
    } as unknown as ArchitectGraphState;

    await buildPlanPrompt(state, buildFeatureTask(), undefined, undefined, undefined, undefined);

    const baseCall = renderCalls.find(c => c.template === 'jobs/code/nodes/plan/base');
    expect(baseCall, 'plan/base template not rendered').toBeDefined();
    expect(baseCall!.vars.userLanguage).toBe('ko');
  });

  it('defaults userLanguage to "en" when state.context.userLanguage is missing', async () => {
    const { promptBuilder, renderCalls } = makeStubBuilder();
    const state = {
      ...buildState(undefined),
      deps: { promptBuilder },
    } as unknown as ArchitectGraphState;

    await buildPlanPrompt(state, buildFeatureTask(), undefined, undefined, undefined, undefined);

    const baseCall = renderCalls.find(c => c.template === 'jobs/code/nodes/plan/base');
    expect(baseCall!.vars.userLanguage).toBe('en');
  });
});

describe('Fix D — Final Verification task labels are i18n-aware', () => {
  function makeState(userLanguage: string | undefined): any {
    return {
      taskQueue: new TaskQueue<CodeTask>(),
      _batchSplitRequeued: false,
      context: { featurePath: undefined, userLanguage },
      _httpJobId: undefined,
    };
  }

  const errorParent: CodeTask = {
    id: 'err-1',
    name: 'fix compile errors',
    type: 'error',
    priority: 905,
    description: '',
  } as CodeTask;

  const dropAndReplacePlan = JSON.stringify({
    diagnostics: { totalErrors: 2 },
    implementation: { modify: [] },
    batches: [
      { name: 'fix a', rationale: 'compile error in a', modify: ['a.ts'] },
      { name: 'fix b', rationale: 'compile error in b', modify: ['b.ts'] },
    ],
  });

  it('emits Korean Final Verification labels when userLanguage="ko"', () => {
    const state = makeState('ko');
    processDiagnosticBatchSplit(state, dropAndReplacePlan, errorParent);

    const all = state.taskQueue.getAll();
    const fv = all.find((t: any) => t.type === 'verification') as any;
    expect(fv, 'Final Verification task was not enqueued').toBeDefined();
    expect(fv.name).toMatch(/최종 검증/);
    expect(fv.name).toContain(errorParent.name);
    expect(fv.description).toMatch(/검증/);
  });

  it('emits English Final Verification labels when userLanguage="en"', () => {
    const state = makeState('en');
    processDiagnosticBatchSplit(state, dropAndReplacePlan, errorParent);

    const all = state.taskQueue.getAll();
    const fv = all.find((t: any) => t.type === 'verification') as any;
    expect(fv).toBeDefined();
    expect(fv.name).toMatch(/Final Verification/);
    expect(fv.description).toMatch(/Verify that the batch-split sub-tasks/);
  });

  it('defaults to English when userLanguage is missing', () => {
    const state = makeState(undefined);
    processDiagnosticBatchSplit(state, dropAndReplacePlan, errorParent);

    const all = state.taskQueue.getAll();
    const fv = all.find((t: any) => t.type === 'verification') as any;
    expect(fv).toBeDefined();
    expect(fv.name).toMatch(/Final Verification/);
  });
});
