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
  deps?: { kanbanUpdate?: { updateCurrentPhaseTokenUsage?: (snap: any) => void } };
};

describe('withPhaseTracking — phase snapshot seed', () => {
  it('initializes currentPhaseTokenUsage with zero counts before node runs', async () => {
    const state: StateWithDeps = {};
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
    expect(observed[0]?.tokenUsage.callCount).toBe(0);
  });

  it('resolves English label by default and Korean when _uiLocale is ko', async () => {
    const en: StateWithDeps = {};
    await withPhaseTracking('plan', (_s: StateWithDeps) => ({}) as any)(en);
    expect(en.currentPhaseTokenUsage?.label).toBe('Planning');

    const ko: StateWithDeps = { _uiLocale: 'ko' };
    await withPhaseTracking('plan', (_s: StateWithDeps) => ({}) as any)(ko);
    expect(ko.currentPhaseTokenUsage?.label).toBe('작업 계획 중');
  });

  it('falls back to the phaseId itself for unknown ids', async () => {
    const state: StateWithDeps = {};
    await withPhaseTracking('made-up-phase', (_s: StateWithDeps) => ({}) as any)(state);
    expect(state.currentPhaseTokenUsage?.label).toBe('made-up-phase');
  });

  it('re-seeds on re-entry so a second invocation overwrites the prior snapshot', async () => {
    const state: StateWithDeps = {};
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
    const state: StateWithDeps = {};
    beginNodePhase(state, 'plan', 'Planning');

    accumulateTokenUsage(state, mkUsage(100, 10));
    expect(state.currentPhaseTokenUsage?.tokenUsage.inputTokens).toBe(100);

    accumulateTokenUsage(state, mkUsage(500, 50));
    expect(state.currentPhaseTokenUsage?.tokenUsage.inputTokens).toBe(500);
    expect(state.currentPhaseTokenUsage?.tokenUsage.outputTokens).toBe(50);
    expect(state.currentPhaseTokenUsage?.tokenUsage.callCount).toBe(1);
  });

  it('broadcasts exactly once per accumulate invocation via kanbanUpdate', () => {
    const updateCurrentPhaseTokenUsage = vi.fn();
    const state: StateWithDeps = {
      deps: { kanbanUpdate: { updateCurrentPhaseTokenUsage } },
    };
    beginNodePhase(state, 'plan', 'Planning');

    accumulateTokenUsage(state, mkUsage(100, 10));
    accumulateTokenUsage(state, mkUsage(200, 20));
    accumulateTokenUsage(state, mkUsage(300, 30));

    expect(updateCurrentPhaseTokenUsage).toHaveBeenCalledTimes(3);
    const lastCall = updateCurrentPhaseTokenUsage.mock.calls[2][0];
    expect(lastCall.phase).toBe('plan');
    expect(lastCall.tokenUsage.inputTokens).toBe(300);
  });

  it('does NOT broadcast when the phase snapshot is not initialized', () => {
    const updateCurrentPhaseTokenUsage = vi.fn();
    const state: StateWithDeps = {
      deps: { kanbanUpdate: { updateCurrentPhaseTokenUsage } },
    };

    accumulateTokenUsage(state, mkUsage(100, 10));

    expect(updateCurrentPhaseTokenUsage).not.toHaveBeenCalled();
    expect(state.tokenUsage?.inputTokens).toBe(100);
  });

  it('is safe when kanbanUpdate is absent (optional chain guards both deps and method)', () => {
    const state: StateWithDeps = {};
    beginNodePhase(state, 'plan');

    expect(() => accumulateTokenUsage(state, mkUsage(100, 10))).not.toThrow();
    expect(state.currentPhaseTokenUsage?.tokenUsage.inputTokens).toBe(100);
  });
});

describe('withPhaseTracking — end-to-end broadcast SSOT', () => {
  it('a single LLM call inside a wrapped node results in exactly one gauge broadcast', async () => {
    const updateCurrentPhaseTokenUsage = vi.fn();
    const state: StateWithDeps = {
      deps: { kanbanUpdate: { updateCurrentPhaseTokenUsage } },
    };

    await withPhaseTracking('execute', (s: StateWithDeps) => {
      accumulateTokenUsage(s, mkUsage(12_000, 2_000));
      return {} as any;
    })(state);

    expect(updateCurrentPhaseTokenUsage).toHaveBeenCalledTimes(1);
    const snapshot = updateCurrentPhaseTokenUsage.mock.calls[0][0];
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
      deps: { kanbanUpdate: { updateCurrentPhaseTokenUsage } },
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
      deps: { kanbanUpdate: { updateCurrentPhaseTokenUsage } },
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
