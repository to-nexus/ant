/**
 * Unit tests for the shared plan↔tool loop re-entry helper.
 *
 * Code paths exercised:
 *   1. `isActive=false` → fallthrough.
 *   2. runRound returns planText → planText outcome.
 *   3. runRound returns toolCalls → toolCalls outcome.
 *   4. runRound returns null → fallthrough(no-output).
 *
 * The helper has no round cap — it drives one round per call and
 * propagates the outcome; runaway is bounded by LangGraph's
 * `recursionLimit` at the graph level.
 */

import { describe, it, expect, vi } from 'vitest';
import { runPlanToolLoopPhase } from '../../../../../../src/agents/common/graph/nodes/plan';

describe('runPlanToolLoopPhase', () => {
  it('returns fallthrough(no-output) when not active', async () => {
    const runRound = vi.fn();
    const result = await runPlanToolLoopPhase({
      history: [],
      isActive: false,
      runRound,
    });
    expect(result).toEqual({ kind: 'fallthrough', reason: 'no-output' });
    expect(runRound).not.toHaveBeenCalled();
  });

  it('propagates a planText round outcome', async () => {
    const planText = 'P'.repeat(80);
    const runRound = vi.fn().mockResolvedValue({ kind: 'planText', planText });
    const result = await runPlanToolLoopPhase({
      history: [{ role: 'user' as const, content: 'seed' }],
      isActive: true,
      runRound,
    });
    expect(result).toEqual({ kind: 'planText', planText });
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
    });
    expect(result).toEqual({ kind: 'toolCalls', llmResponse, assistantMessage });
  });

  it('returns fallthrough(no-output) when runRound returns null', async () => {
    const runRound = vi.fn().mockResolvedValue(null);
    const result = await runPlanToolLoopPhase({
      history: [{ role: 'user' as const, content: 'seed' }],
      isActive: true,
      runRound,
    });
    expect(result).toEqual({ kind: 'fallthrough', reason: 'no-output' });
  });

  it('drives one round per call regardless of history length', async () => {
    // The helper has no round cap: it calls runRound once and returns
    // its outcome, no matter how long the history is.
    const longHistory = Array.from({ length: 60 }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `m${i}`,
    }));
    const llmResponse: any = {
      toolCalls: [{ id: '1', name: 'read_file', args: { path: 'a' } }],
      textResponse: '',
      done: false,
    };
    const assistantMessage: any = { role: 'assistant', content: [] };
    const runRound = vi.fn().mockResolvedValue({ kind: 'toolCalls', llmResponse, assistantMessage });
    const result = await runPlanToolLoopPhase({
      history: longHistory,
      isActive: true,
      runRound,
    });
    expect(runRound).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe('toolCalls');
  });
});
