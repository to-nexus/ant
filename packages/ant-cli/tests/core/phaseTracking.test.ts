/**
 * Phase tracking invariants — `withPhaseTracking` + `accumulateTokenUsage`
 * as SSOT for the chat-input token gauge.
 *
 * See docs/architecture/35-token-usage-tracking.md.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  accumulateTokenUsage,
  withPhaseTracking,
  beginNodePhase,
  type TokenTrackingState,
  type TokenUsage,
} from '../../src/agents/common/graph/llmHelpers';

function mkUsage(input: number, output: number): TokenUsage {
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: input + output,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };
}

type StateWithDeps = TokenTrackingState & {
  _uiLocale?: string;
  deps?: {
    /** Phase-3: required for getModelContextWindow stamp in beginNodePhase. */
    llm?: { modelName: string };
    kanbanUpdate?: { updateCurrentPhaseTokenUsage?: (snap: any) => void };
  };
};

/** Default LLM stub for tests — Phase-3 SSOT requires `state.deps.llm.modelName`. */
const TEST_LLM = { modelName: 'claude-opus-4-8' };

describe('withPhaseTracking — phase snapshot seed', () => {
  it('initializes currentPhaseTokenUsage with zero counts before node runs', async () => {
    const state: StateWithDeps = { deps: { llm: TEST_LLM } };
    const observed: Array<TokenTrackingState['currentPhaseTokenUsage']> = [];

    const node = (s: StateWithDeps) => {
      observed.push(s.currentPhaseTokenUsage);
      return {} as any;
    };

    await withPhaseTracking('plan', node)(state);

    expect(observed).toHaveLength(1);
    expect(observed[0]?.phase).toBe('plan');
    expect(observed[0]?.tokenUsage.inputTokens).toBe(0);
    expect(observed[0]?.tokenUsage.outputTokens).toBe(0);
    // Phase-3: zero-seed retains callCount=0 from initTokenUsage. Subsequent
    // overwrites by accumulate/updatePhaseTokenUsageSnapshot drop callCount
    // because phase snapshots are LATEST-call, not cumulative.
    expect(observed[0]?.tokenUsage.callCount).toBe(0);
    // Phase-3: zero-seed carries mode='live' and the model's contextWindow.
    expect(observed[0]?.mode).toBe('live');
    expect(observed[0]?.contextWindow).toBe(1_000_000); // claude-opus-4-8
  });

  it('resolves English label by default and Korean when _uiLocale is ko', async () => {
    const en: StateWithDeps = { deps: { llm: TEST_LLM } };
    await withPhaseTracking('plan', (_s: StateWithDeps) => ({}) as any)(en);
    expect(en.currentPhaseTokenUsage?.label).toBe('Planning');

    const ko: StateWithDeps = { _uiLocale: 'ko', deps: { llm: TEST_LLM } };
    await withPhaseTracking('plan', (_s: StateWithDeps) => ({}) as any)(ko);
    expect(ko.currentPhaseTokenUsage?.label).toBe('작업 계획 중');
  });

  it('falls back to the phaseId itself for unknown ids', async () => {
    const state: StateWithDeps = { deps: { llm: TEST_LLM } };
    await withPhaseTracking('made-up-phase', (_s: StateWithDeps) => ({}) as any)(state);
    expect(state.currentPhaseTokenUsage?.label).toBe('made-up-phase');
  });

  it('re-seeds on re-entry so a second invocation overwrites the prior snapshot', async () => {
    const state: StateWithDeps = { deps: { llm: TEST_LLM } };
    await withPhaseTracking('plan', (s: StateWithDeps) => {
      accumulateTokenUsage(s, mkUsage(500, 100));
      return {} as any;
    })(state);

    expect(state.currentPhaseTokenUsage?.tokenUsage.inputTokens).toBe(500);

    await withPhaseTracking('plan', (_s: StateWithDeps) => ({}) as any)(state);
    expect(state.currentPhaseTokenUsage?.phase).toBe('plan');
    expect(state.currentPhaseTokenUsage?.tokenUsage.inputTokens).toBe(0);
  });
});

describe('accumulateTokenUsage — SSOT broadcast', () => {
  it('overwrites (not accumulates) the node-phase snapshot on each call', async () => {
    const state: StateWithDeps = { deps: { llm: TEST_LLM } };
    beginNodePhase(state, 'plan', 'Planning');

    accumulateTokenUsage(state, mkUsage(100, 10));
    expect(state.currentPhaseTokenUsage?.tokenUsage.inputTokens).toBe(100);

    accumulateTokenUsage(state, mkUsage(500, 50));
    expect(state.currentPhaseTokenUsage?.tokenUsage.inputTokens).toBe(500);
    expect(state.currentPhaseTokenUsage?.tokenUsage.outputTokens).toBe(50);
    // Phase-3: PhaseTokenUsage.tokenUsage carries NO callCount on overwrite.
    // The single-call snapshot is exactly that — no accumulator counter
    // belongs in a value with overwrite semantics.
    expect(state.currentPhaseTokenUsage?.tokenUsage.callCount).toBeUndefined();
    expect(state.currentPhaseTokenUsage?.mode).toBe('live');
  });

  it('broadcasts exactly once per accumulate invocation via kanbanUpdate', () => {
    const updateCurrentPhaseTokenUsage = vi.fn();
    const state: StateWithDeps = {
      deps: { llm: TEST_LLM, kanbanUpdate: { updateCurrentPhaseTokenUsage } },
    };
    beginNodePhase(state, 'plan', 'Planning');

    accumulateTokenUsage(state, mkUsage(100, 10));
    accumulateTokenUsage(state, mkUsage(200, 20));
    accumulateTokenUsage(state, mkUsage(300, 30));

    // 1 zero-seed broadcast from beginNodePhase + 3 from accumulateTokenUsage
    expect(updateCurrentPhaseTokenUsage).toHaveBeenCalledTimes(4);
    const lastCall = updateCurrentPhaseTokenUsage.mock.calls[3][0];
    expect(lastCall.phase).toBe('plan');
    expect(lastCall.tokenUsage.inputTokens).toBe(300);
  });

  it('does NOT broadcast when the phase snapshot is not initialized', () => {
    const updateCurrentPhaseTokenUsage = vi.fn();
    // Note: no `beginNodePhase` call below, so `resolveModelName` is never
    // invoked — deps.llm intentionally omitted to keep this exercise focused
    // on the "no phase seeded" path.
    const state: StateWithDeps = {
      deps: { kanbanUpdate: { updateCurrentPhaseTokenUsage } },
    };

    accumulateTokenUsage(state, mkUsage(100, 10));

    expect(updateCurrentPhaseTokenUsage).not.toHaveBeenCalled();
    expect(state.tokenUsage?.inputTokens).toBe(100);
  });

  it('is safe when kanbanUpdate is absent (optional chain guards both deps and method)', () => {
    const state: StateWithDeps = { deps: { llm: TEST_LLM } };
    beginNodePhase(state, 'plan');

    expect(() => accumulateTokenUsage(state, mkUsage(100, 10))).not.toThrow();
    expect(state.currentPhaseTokenUsage?.tokenUsage.inputTokens).toBe(100);
  });
});

describe('withPhaseTracking — end-to-end broadcast SSOT', () => {
  it('a single LLM call inside a wrapped node results in exactly one gauge broadcast', async () => {
    const updateCurrentPhaseTokenUsage = vi.fn();
    const state: StateWithDeps = {
      deps: { llm: TEST_LLM, kanbanUpdate: { updateCurrentPhaseTokenUsage } },
    };

    await withPhaseTracking('execute', (s: StateWithDeps) => {
      accumulateTokenUsage(s, mkUsage(12_000, 2_000));
      return {} as any;
    })(state);

    // 1 zero-seed broadcast from withPhaseTracking/beginNodePhase + 1 from accumulateTokenUsage
    expect(updateCurrentPhaseTokenUsage).toHaveBeenCalledTimes(2);
    const snapshot = updateCurrentPhaseTokenUsage.mock.calls[1][0];
    expect(snapshot.phase).toBe('execute');
    expect(snapshot.tokenUsage.inputTokens).toBe(12_000);
    expect(snapshot.tokenUsage.outputTokens).toBe(2_000);
    expect(snapshot.tokenUsage.totalTokens).toBe(14_000);
  });
});

describe('withPhaseTracking — parallel worker identity', () => {
  it('propagates state.workerId onto the phase snapshot for broadcast keying', async () => {
    const updateCurrentPhaseTokenUsage = vi.fn();
    const state: StateWithDeps & { workerId?: number; currentTask?: { name: string } } = {
      workerId: 2,
      currentTask: { name: 'setup-design-system' },
      deps: { llm: TEST_LLM, kanbanUpdate: { updateCurrentPhaseTokenUsage } },
    };

    await withPhaseTracking('plan', (s: typeof state) => {
      accumulateTokenUsage(s, mkUsage(100, 10));
      return {} as any;
    })(state);

    const snapshot = updateCurrentPhaseTokenUsage.mock.calls[0][0];
    expect(snapshot.workerId).toBe(2);
    expect(snapshot.taskName).toBe('setup-design-system');
  });

  it('omits workerId on the snapshot when the state has none (main / sequential)', async () => {
    const updateCurrentPhaseTokenUsage = vi.fn();
    const state: StateWithDeps = {
      deps: { llm: TEST_LLM, kanbanUpdate: { updateCurrentPhaseTokenUsage } },
    };

    await withPhaseTracking('plan', (s: StateWithDeps) => {
      accumulateTokenUsage(s, mkUsage(100, 10));
      return {} as any;
    })(state);

    const snapshot = updateCurrentPhaseTokenUsage.mock.calls[0][0];
    expect(snapshot.workerId).toBeUndefined();
    expect(snapshot.taskName).toBeUndefined();
  });
});
