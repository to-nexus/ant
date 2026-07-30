/**
 * Design plan node token-channel invariant (zero-hunting-label).
 *
 * `accumulateTokenUsage` mutates the graph state in place, and LangGraph
 * DISCARDS mutations a node does not return — the unreturned-channel-drop
 * class documented in `agents/common/subagent/tokens.ts`. The design plan node
 * used to emit token channels only when a subagent fold had populated a
 * `joinTokenDelta` map, so a plan invocation with no fold returned `{}` and
 * silently dropped every LLM round it had just paid for.
 *
 * Measured on the `zero-hunting-label` design job: of 19 `design-plan` calls,
 * only the 3 in the fold-bearing invocation survived. The other 16 —
 * 96,289 input / 3,149 output tokens, ~30% of the job's input — reached
 * neither `completedTasksDetails[].tokenUsage` nor the kanban snapshot, and
 * therefore never reached `ledger.settle`. The per-model reconcile net cannot
 * catch this: both sides of its comparison derive from the same accumulate
 * path, so never-accumulated usage is missing from both.
 *
 * Two static guards, because the node's real dependency surface (LLM client,
 * prompt builder, session, subagent registry, workflow port) makes a
 * behavioural test of the return shape disproportionate:
 *   1. every channel the node returns is DECLARED on the design graph, so the
 *      unconditional return can never raise InvalidUpdateError;
 *   2. the return is unconditional — not keyed off a join/fold delta.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { DESIGN_PLAN_TOKEN_CHANNELS } from '../../src/agents/architect/graph/design/nodes/plan';

const SRC = resolve(__dirname, '../../src/agents/architect/graph/design');
const read = (rel: string) => readFileSync(resolve(SRC, rel), 'utf-8');

describe('design plan node — token channels survive the node transition', () => {
  it('every returned token channel is declared on the design graph', () => {
    const graph = read('graph.ts');
    expect(DESIGN_PLAN_TOKEN_CHANNELS.length).toBe(4);
    for (const channel of DESIGN_PLAN_TOKEN_CHANNELS) {
      // `foo: Annotation<...>` — the channel declaration form.
      expect(graph).toMatch(new RegExp(`\\b${channel}:\\s*Annotation<`));
    }
  });

  it('excludes currentPhaseTokenUsage (child conversation must not skew the parent gauge)', () => {
    expect(DESIGN_PLAN_TOKEN_CHANNELS).not.toContain('currentPhaseTokenUsage');
  });

  it('tokenDeltaOut reads state unconditionally, not from a join/fold delta', () => {
    const src = read('nodes/plan/index.ts');

    // The old shape: keys sourced from a mutable map only the folds wrote.
    expect(src).not.toContain('joinTokenDelta');
    expect(src).toContain('for (const k of DESIGN_PLAN_TOKEN_CHANNELS)');

    // Both graph-visible exits must carry the delta.
    const planTextExit = src.indexOf('return { ...finalized, ...tokenDeltaOut() }');
    expect(planTextExit).toBeGreaterThan(-1);
    expect(src.split('...tokenDeltaOut()').length - 1).toBeGreaterThanOrEqual(2);
  });
});
