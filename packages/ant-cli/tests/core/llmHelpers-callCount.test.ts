/**
 * T4 (verification-defects-recovery handoff) — `TaskTokenUsage.callCount`
 * accumulation invariants.
 *
 * Locks that `accumulateTokenUsage` publishes a truthful LLM-call counter at
 * both the task level and the job level so `logTaskComplete.llmCallCount`
 * reflects the actual number of LLM invocations consumed inside a task
 * boundary. Before this field existed the wrapper at
 * `checkTaskStatus/{worker,}Index` fell back to `state._executeCallIndex`
 * which is a per-execute-cycle counter (zeroed on retry / reverify / fresh
 * entry) and silently understated the real call count — `fern-nearing-medal`
 * reported `llmCallCount: 0` for a task that made 45 LLM calls.
 */

import { describe, it, expect } from 'vitest';
import {
  accumulateTokenUsage,
  resetTaskTokenUsage,
  getTaskTokenUsage,
  getJobTokenUsage,
  type TokenTrackingState,
  type TokenUsage,
} from '../../src/agents/common/graph/llmHelpers';

function mkUsage(input: number, output: number, extras: Partial<TokenUsage> = {}): TokenUsage {
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: input + output,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    ...extras,
  };
}

describe('llmHelpers — callCount accumulation', () => {
  it('increments task-level callCount by 1 per accumulate invocation', () => {
    const state: TokenTrackingState = {};
    accumulateTokenUsage(state, mkUsage(100, 10));
    accumulateTokenUsage(state, mkUsage(200, 20));
    accumulateTokenUsage(state, mkUsage(300, 30));
    expect(getTaskTokenUsage(state).callCount).toBe(3);
    expect(getTaskTokenUsage(state).inputTokens).toBe(600);
    expect(getTaskTokenUsage(state).outputTokens).toBe(60);
  });

  it('increments job-level callCount in parallel with task-level', () => {
    const state: TokenTrackingState = {};
    accumulateTokenUsage(state, mkUsage(50, 5));
    accumulateTokenUsage(state, mkUsage(50, 5));
    expect(getTaskTokenUsage(state).callCount).toBe(2);
    expect(getJobTokenUsage(state).callCount).toBe(2);
  });

  it('resetTaskTokenUsage zeroes task-level callCount but leaves job-level intact', () => {
    const state: TokenTrackingState = {};
    accumulateTokenUsage(state, mkUsage(100, 10));
    accumulateTokenUsage(state, mkUsage(100, 10));
    expect(getTaskTokenUsage(state).callCount).toBe(2);
    expect(getJobTokenUsage(state).callCount).toBe(2);

    resetTaskTokenUsage(state);

    expect(getTaskTokenUsage(state).callCount).toBe(0);
    expect(getTaskTokenUsage(state).inputTokens).toBe(0);
    // Job-level survives task boundary.
    expect(getJobTokenUsage(state).callCount).toBe(2);
    expect(getJobTokenUsage(state).inputTokens).toBe(200);

    accumulateTokenUsage(state, mkUsage(1, 1));
    expect(getTaskTokenUsage(state).callCount).toBe(1);
    expect(getJobTokenUsage(state).callCount).toBe(3);
  });

  it('taskLevel=false still bumps job-level callCount (estimating pipeline path)', () => {
    const state: TokenTrackingState = {};
    accumulateTokenUsage(state, mkUsage(10, 1), { taskLevel: false, jobLevel: true });
    expect(getTaskTokenUsage(state).callCount).toBe(0);
    expect(getJobTokenUsage(state).callCount).toBe(1);
  });
});
