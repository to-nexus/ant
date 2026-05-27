/**
 * The path that actually crashed (dim-beating-brass): `feature` tasks
 * finalise their plan in the code-job plan↔tool loop
 * (`nodes/plan/llm/toolLoop.ts`). When that finalize throws
 * `FlatPlanTooLargeViolation` (size gate), the tool loop must re-emit the
 * flat plan as `batches[]` via a single-shot re-round — and soft-fail
 * terminally once the reframe budget is spent, NOT execute the flat plan
 * into a recursion crash.
 *
 * The two LLM-calling modules are mocked; the real `finalizePlanOutcome`
 * → `processDiagnosticBatchSplit` → size gate runs, so the control flow is
 * exercised end-to-end.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/agents/architect/graph/code/nodes/plan/llm/tools', () => ({
  runPlanLLMWithTools: vi.fn(),
}));
vi.mock('../../src/agents/architect/graph/code/nodes/plan/llm/single', () => ({
  generatePlanText: vi.fn(),
}));

import { runPlanToolLoopPhase } from '../../src/agents/architect/graph/code/nodes/plan/llm/toolLoop';
import { runPlanLLMWithTools } from '../../src/agents/architect/graph/code/nodes/plan/llm/tools';
import { generatePlanText } from '../../src/agents/architect/graph/code/nodes/plan/llm/single';
import { CONV_KEYS } from '../../src/agents/common/graph/conversations';
import { VerificationTerminalError, classifyTerminalError } from '../../src/agents/architect/graph/code/tasks/_shared/verify/terminal/errors';
import { TaskQueue } from '../../src/agents/architect/types/task';
import type { CodeTask } from '../../src/agents/architect/types/task';

const mockedTools = vi.mocked(runPlanLLMWithTools);
const mockedSingle = vi.mocked(generatePlanText);

// Wide aggregator flat plan: 16 entries across 7 domains — track-parent.
function wideFlatPlan(): string {
  const targets = [
    'codebase/src/application/capsule/index.ts',
    'codebase/src/application/capsule/view-model.ts',
    'codebase/src/application/dashboard/factory.ts',
    'codebase/src/application/dashboard/index.ts',
    'codebase/src/application/feed/index.ts',
    'codebase/src/application/assignment/index.ts',
    'codebase/src/application/submission/index.ts',
    'codebase/src/application/comment/index.ts',
    'codebase/src/application/notification/index.ts',
    'codebase/src/presentation/parent/home.tsx',
    'codebase/src/presentation/parent/dashboard.tsx',
    'codebase/src/presentation/auth/state-views.tsx',
    'codebase/src/domain/dashboard/model.ts',
    'codebase/src/domain/capsule/model.ts',
    'codebase/src/domain/feed/model.ts',
    'codebase/src/domain/notification/model.ts',
  ];
  return JSON.stringify({
    task: { id: 'track-parent', goal: 'parent read-only across domains' },
    implementation: { modify: targets.map((t) => ({ target: t, action: 'wire view' })) },
  });
}

function batchesPlan(): string {
  return JSON.stringify({
    task: { id: 'track-parent', goal: 'parent read-only across domains' },
    parentReasoning: 'Per-domain slices share the parent read-only invariant; split per domain.',
    batches: [
      { name: 'capsule-parent-views', rationale: 'parent read-only capsule screens' },
      { name: 'dashboard-parent-views', rationale: 'parent read-only dashboard screens' },
    ],
  });
}

function makeState(): any {
  return {
    taskQueue: new TaskQueue<CodeTask>(),
    conversations: { [CONV_KEYS.NODE_PLAN]: [{ role: 'user', content: 'seed investigation' }] },
    _activePhase: 'plan',
    recursionLimit: 200,
    recursionCount: 120, // remaining 80; est 16*6=96 > 48 → gate trips
    context: { featurePath: undefined },
    _httpJobId: undefined,
    deps: { llm: {} /* truthy */ },
    violations: [],
    _batchSplitRequeued: false,
  };
}

function makeFeatureTask(overrides: Partial<CodeTask> = {}): CodeTask {
  return {
    id: 'track-parent',
    name: 'Route Track: 학부모 화면',
    type: 'feature',
    priority: 550,
    ...overrides,
  } as CodeTask;
}

describe('toolLoop flat-plan size gate reframe', () => {
  beforeEach(() => {
    mockedTools.mockReset();
    mockedSingle.mockReset();
  });

  it('over-large flat plan → reframe re-emits as batches[] → fan-out fires (no crash)', async () => {
    // Tool loop emits the over-large flat plan; the reframe single-shot
    // returns a proper batches[] plan.
    mockedTools.mockResolvedValue({ planText: wideFlatPlan() } as any);
    mockedSingle.mockResolvedValue(batchesPlan());

    const state = makeState();
    const task = makeFeatureTask();
    const outcome = await runPlanToolLoopPhase(state, task);

    expect(outcome.kind).toBe('return');
    // generatePlanText (the no-tools reframe) called exactly once.
    expect(mockedSingle).toHaveBeenCalledTimes(1);
    expect((task as any)._flatPlanReframeCount).toBe(1);
    if (outcome.kind === 'return') {
      expect(outcome.state._batchSplitRequeued).toBe(true);
      // two feature sub-tasks queued from the batches.
      const subs = outcome.state.taskQueue.getAll().filter((t: any) => t.type === 'feature');
      expect(subs.length).toBe(2);
    }
  });

  it('LLM refuses to split (flat every reframe) → terminal soft-fail, NOT execute', async () => {
    mockedTools.mockResolvedValue({ planText: wideFlatPlan() } as any);
    // Every reframe returns a flat plan again.
    mockedSingle.mockResolvedValue(wideFlatPlan());

    const state = makeState();
    const task = makeFeatureTask();

    let thrown: unknown;
    try {
      await runPlanToolLoopPhase(state, task);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(VerificationTerminalError);
    expect(classifyTerminalError(thrown as Error)).toEqual({ terminal: true, kind: 'flatplan_too_large' });
    expect((task as any)._failed).toBe(true);
    // Reframe budget spent exactly MAX times before the terminal throw.
    expect(mockedSingle).toHaveBeenCalledTimes(2);
  });
});
