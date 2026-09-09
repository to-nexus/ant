/**
 * Plan / visual per-model broadcast wiring — billing regression guard.
 *
 * All graphs DECLARE + ACCUMULATE `tokenUsageByModel` (locked by
 * token-usage-channel.test.ts). But plan (planner) and visual (creator) have no
 * task queue, so they never call `updateKanbanTokenUsage` — the architect's
 * per-model funnel. Before the fix they broadcast only the aggregate
 * `updateTokenUsage`, so the per-model map lived in graph state and never
 * reached `KanbanBroadcaster.cachedTokenUsageByModel`. Consequence: the persisted
 * Redis snapshot (billing settle) and the SSE snapshot (token-usage popup) had NO
 * per-model data → per-model USD blank and settle took the no-usage
 * `releaseHold` branch (no debit).
 *
 * The fix routes per-model usage through `broadcastTokenUsageByModel` at each
 * plan/visual broadcast site. This locks both the helper's behavior and the
 * presence of the wiring at every site.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { broadcastTokenUsageByModel } from '../../src/agents/common/graph/llmHelpers';

const SRC = path.resolve(__dirname, '../../src');
const read = (p: string) => fs.readFileSync(path.join(SRC, p), 'utf-8');

describe('broadcastTokenUsageByModel helper', () => {
  it('forwards the accumulated per-model map to the broadcaster', () => {
    const calls: any[] = [];
    const state: any = {
      tokenUsageByModel: { 'claude-opus-5': { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
      deps: { kanbanUpdate: { updateTokenUsageByModel: (b: any) => calls.push(b) } },
    };
    broadcastTokenUsageByModel(state);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(state.tokenUsageByModel);
  });

  it('is a no-op when no per-model data has accumulated', () => {
    const calls: any[] = [];
    const state: any = { deps: { kanbanUpdate: { updateTokenUsageByModel: (b: any) => calls.push(b) } } };
    broadcastTokenUsageByModel(state);
    expect(calls).toHaveLength(0);
  });

  it('does not throw when the kanbanUpdate port is absent', () => {
    expect(() => broadcastTokenUsageByModel({ tokenUsageByModel: { m: {} } } as any)).not.toThrow();
  });
});

describe('plan / visual broadcast sites are wired for per-model cost', () => {
  it('planner plan + execute nodes broadcast per-model before updateTaskQueue', () => {
    expect(read('agents/planner/graph/plan/nodes/plan/index.ts')).toContain('broadcastTokenUsageByModel');
    expect(read('agents/planner/graph/plan/nodes/execute/index.ts')).toContain('broadcastTokenUsageByModel');
  });

  const visualNodes = ['render', 'sketch', 'engrave', 'explain', 'direct'];
  for (const node of visualNodes) {
    it(`visual ${node} node broadcasts per-model alongside updateTokenUsage`, () => {
      expect(read(`agents/creator/graph/visual/nodes/${node}.ts`)).toContain('broadcastTokenUsageByModel');
    });
  }

  it('visual runner emits per-model on the final broadcast (settle-critical)', () => {
    expect(read('agents/creator/graph/visual/runner.ts')).toContain('updateTokenUsageByModel');
  });

  it('visual image nodes attribute tokens to the image model (not the text default)', () => {
    // render/sketch use image clients whose modelName differs from deps.llm;
    // the per-model bucket must key off the image model for accurate pricing.
    expect(read('agents/creator/graph/visual/nodes/render.ts')).toMatch(/modelId:\s*\(imageClient as any\)\.modelName/);
    expect(read('agents/creator/graph/visual/nodes/sketch.ts')).toMatch(/modelId:\s*\(imageClient as any\)\.modelName/);
  });
});

/**
 * Universal is the third job family with no task queue, and it hit the same
 * class from the other side: it DOES broadcast per-model each round, but its
 * agent node returned only the aggregate `tokenUsage`. LangGraph rebuilds a
 * node's state from the channels on every hop and `accumulateTokenUsage`
 * creates the per-model map lazily, so an omitted return restarted it at `{}`
 * each round — the broadcaster cached the newest single-call map and billing
 * settled on the LAST LLM call alone (observed: callCount 1 / 2 input tokens
 * against a 735k-token job, which the safety net then attributed to the
 * most-expensive model).
 */
describe('universal carries per-model usage across node hops', () => {
  const agentNode = read('agents/universal/graph/nodes/agent.ts');

  it('broadcasts per-model before the aggregate, like plan/visual', () => {
    expect(agentNode).toContain('broadcastTokenUsageByModel');
  });

  it('returns the per-model twin from EVERY return that carries the aggregate', () => {
    const aggregate = (agentNode.match(/tokenUsage: state\.tokenUsage,/g) ?? []).length;
    const perModel = (agentNode.match(/tokenUsageByModel: state\.tokenUsageByModel,/g) ?? []).length;
    expect(aggregate).toBeGreaterThan(0);
    expect(perModel).toBe(aggregate);
  });

  it('seeds the per-model channel so subagent usage is not dropped at the fold', () => {
    // `foldSubagentUsage` reports only channels already `in state` — returning
    // an undeclared key is an InvalidUpdateError — so an absent map silently
    // discarded every subagent's tokens.
    expect(read('agents/universal/graph/state.ts')).toMatch(/tokenUsageByModel:\s*\{\}/);
  });
});
