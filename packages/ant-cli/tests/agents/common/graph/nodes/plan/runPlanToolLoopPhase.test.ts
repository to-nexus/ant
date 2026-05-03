/**
 * Unit tests for the shared plan↔tool loop re-entry helper.
 *
 * These tests exercise the four code paths the helper owns:
 *   1. `isActive=false` → fallthrough.
 *   2. `history.length >= toolLoopMax * 2` → onOverLimit synthesis.
 *   3. runRound returns planText → planText outcome.
 *   4. runRound returns toolCalls → toolCalls outcome.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  PLAN_TOOL_LOOP_MAX,
  runPlanToolLoopPhase,
} from '../../../../../../src/agents/common/graph/nodes/plan';

describe('runPlanToolLoopPhase', () => {
  it('returns fallthrough(no-output) when not active', async () => {
    const onOverLimit = vi.fn();
    const runRound = vi.fn();
    const result = await runPlanToolLoopPhase({
      history: [],
      isActive: false,
      runRound,
      onOverLimit,
    });
    expect(result).toEqual({ kind: 'fallthrough', reason: 'no-output' });
    expect(runRound).not.toHaveBeenCalled();
    expect(onOverLimit).not.toHaveBeenCalled();
  });

  it('routes to onOverLimit when history reaches the loop ceiling', async () => {
    const overLimitHistory = Array.from({ length: PLAN_TOOL_LOOP_MAX * 2 }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `m${i}`,
    }));
    const synthesizedPlan = 'X'.repeat(80);
    const onOverLimit = vi.fn().mockResolvedValue(synthesizedPlan);
    const runRound = vi.fn();
    const result = await runPlanToolLoopPhase({
      history: overLimitHistory,
      isActive: true,
      runRound,
      onOverLimit,
    });
    expect(onOverLimit).toHaveBeenCalledTimes(1);
    expect(runRound).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: 'planText', planText: synthesizedPlan, origin: 'over-limit' });
  });

  it('returns fallthrough(over-limit-failed) when onOverLimit yields null', async () => {
    const overLimitHistory = Array.from({ length: PLAN_TOOL_LOOP_MAX * 2 }, () => ({
      role: 'user' as const,
      content: 'x',
    }));
    const onOverLimit = vi.fn().mockResolvedValue(null);
    const runRound = vi.fn();
    const result = await runPlanToolLoopPhase({
      history: overLimitHistory,
      isActive: true,
      runRound,
      onOverLimit,
    });
    expect(result).toEqual({ kind: 'fallthrough', reason: 'over-limit-failed' });
    expect(runRound).not.toHaveBeenCalled();
  });

  it('propagates a planText round outcome', async () => {
    const planText = 'P'.repeat(80);
    const runRound = vi.fn().mockResolvedValue({ kind: 'planText', planText });
    const onOverLimit = vi.fn();
    const result = await runPlanToolLoopPhase({
      history: [{ role: 'user' as const, content: 'seed' }],
      isActive: true,
      runRound,
      onOverLimit,
    });
    expect(result).toEqual({ kind: 'planText', planText, origin: 'tool-loop' });
    expect(onOverLimit).not.toHaveBeenCalled();
  });

  it('propagates a toolCalls round outcome', async () => {
    const llmResponse: any = {
      toolCalls: [{ id: '1', name: 'read_file', args: { path: 'a' } }],
      textResponse: '',
      done: false,
    };
    const assistantMessage: any = { role: 'assistant', content: [{ type: 'text', text: '' }] };
    const runRound = vi.fn().mockResolvedValue({ kind: 'toolCalls', llmResponse, assistantMessage });
    const result = await runPlanToolLoopPhase({
      history: [{ role: 'user' as const, content: 'seed' }],
      isActive: true,
      runRound,
      onOverLimit: vi.fn(),
    });
    expect(result).toEqual({ kind: 'toolCalls', llmResponse, assistantMessage });
  });

  it('returns fallthrough(no-output) when runRound returns null', async () => {
    const runRound = vi.fn().mockResolvedValue(null);
    const result = await runPlanToolLoopPhase({
      history: [{ role: 'user' as const, content: 'seed' }],
      isActive: true,
      runRound,
      onOverLimit: vi.fn(),
    });
    expect(result).toEqual({ kind: 'fallthrough', reason: 'no-output' });
  });

  it('honours a custom toolLoopMax override', async () => {
    const onOverLimit = vi.fn().mockResolvedValue('Z'.repeat(60));
    const runRound = vi.fn();
    // toolLoopMax=2 → ceiling is 4 messages
    const history = Array.from({ length: 4 }, () => ({ role: 'user' as const, content: 'x' }));
    await runPlanToolLoopPhase({
      history,
      isActive: true,
      toolLoopMax: 2,
      runRound,
      onOverLimit,
    });
    expect(onOverLimit).toHaveBeenCalledTimes(1);
  });
});
