/**
 * Phase B — Fixed Tier 0 Reflex injection for read-only runners.
 *
 * Learn / Ask / inline-ask are read-only flows. The runners must
 * inject `state.executionTier = ExecutionTierId.Reflex` at graph entry
 * so `getExecutionTier(state)` returns the Reflex facade without any
 * LLM judgment.
 */

import { describe, it, expect, vi } from 'vitest';
import { createInitialAskState } from '../../src/agents/architect/graph/ask/state';
import { ExecutionTierId } from '@ant/shared';

vi.mock('../../src/agents/common/graph/runnerHelpers', async () => {
  const actual = await vi.importActual<any>(
    '../../src/agents/common/graph/runnerHelpers',
  );
  return {
    ...actual,
    invokeGraph: vi.fn(async (_graph: any, initial: any) => ({
      ...initial,
      texts: [],
    })),
  };
});

describe('createInitialAskState — executionTier fixed injection', () => {
  it('seeds executionTier = Reflex on fresh ask state', () => {
    const state = createInitialAskState({
      question: 'what does this repo do?',
      language: 'en',
      workspaceState: { featurePath: '/tmp/f' } as any,
    });

    expect(state.executionTier).toBe(ExecutionTierId.Reflex);
  });

  it('seeds executionTier = Reflex even with full deps', () => {
    const state = createInitialAskState({
      question: 'explain',
      language: 'ko',
      workspaceState: { featurePath: '/tmp/f' } as any,
      currentJob: 'ask',
      currentAgent: 'architect',
      deps: { llm: { invoke: async () => '' } as any },
      _httpJobId: 'job-1',
      featurePath: '/tmp/f',
    });

    expect(state.executionTier).toBe(ExecutionTierId.Reflex);
  });
});

describe('learn runner — executionTier fixed injection', () => {
  it('seeds executionTier = Reflex before invoking the graph', async () => {
    // The module-level vi.mock above stubs invokeGraph to a spy that
    // captures the initial state passed in. We then read back the spy
    // call to verify the runner seeded Reflex.
    const runnerHelpers = await import(
      '../../src/agents/common/graph/runnerHelpers'
    );
    const { runLearnGraph } = await import(
      '../../src/agents/architect/graph/learn/runner'
    );

    await runLearnGraph({
      context: { project: 'p', featureFolder: 'f' } as any,
      targets: [],
      texts: [],
    } as any);

    const mockedInvoke = runnerHelpers.invokeGraph as unknown as ReturnType<
      typeof vi.fn
    >;
    expect(mockedInvoke).toHaveBeenCalled();
    const [, seededState] = mockedInvoke.mock.calls[0];
    expect(seededState.executionTier).toBe(ExecutionTierId.Reflex);
  });
});
