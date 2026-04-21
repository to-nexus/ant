/**
 * Phase B — Plan Detect Tier classification
 *
 * Verifies that planDetectStrategy.run() parses the LLM's
 * `<executionTier>` tag and forwards it via stateUpdates so the factory
 * merges it into the PlanGraphState.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { planDetectStrategy } from '../../../src/agents/planner/graph/plan/nodes/detect/strategy';
import { ExecutionTierId } from '@ant/shared';

beforeAll(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

async function* makeStream(response: string) {
  yield { type: 'text', text: response };
  yield { type: 'done' };
}

function buildState(opts: { directive?: string; hasExistingTarget?: boolean; llmResponse?: string }) {
  const llm = {
    stream: () => makeStream(opts.llmResponse ?? ''),
  };
  const promptBuilder = {
    render: async () => '(rendered prompt)',
  };
  return {
    directive: opts.directive ?? 'expand the auth chapter with OIDC',
    featurePath: '/tmp/test-feature',
    workspaceState: {
      sourceFileNames: opts.hasExistingTarget ? ['prd.md'] : [],
    },
    deps: { llm, promptBuilder },
    resolvedArtifacts: [],
  } as any;
}

describe('planDetectStrategy — executionTier', () => {
  it('forwards LLM-emitted tier via stateUpdates', async () => {
    const state = buildState({
      llmResponse: `<executionTier>3</executionTier>
<detect>{"intentId":"gen-plan","reasoning":"new plan from scratch"}</detect>`,
    });

    const result = await planDetectStrategy.run(state);

    expect(result.stateUpdates?.executionTier).toBe(ExecutionTierId.Task);
    expect(result.inferred?.intentId).toBe('gen-plan');
  });

  it('promotes RefsGrounded tier when LLM emits it', async () => {
    const state = buildState({
      hasExistingTarget: true,
      llmResponse: `<executionTier>4</executionTier>
<detect>{"intentId":"rev-plan","reasoning":"expand based on supplied refs"}</detect>`,
    });

    const result = await planDetectStrategy.run(state);

    expect(result.stateUpdates?.executionTier).toBe(ExecutionTierId.RefsGrounded);
  });

  it('degrades to Tier 0 Reflex when LLM omits the tag', async () => {
    const state = buildState({
      llmResponse: `<detect>{"intentId":"rev-plan","reasoning":"no tier"}</detect>`,
    });

    const result = await planDetectStrategy.run(state);

    expect(result.stateUpdates?.executionTier).toBe(ExecutionTierId.Reflex);
  });

  it('returns intent fallback + Reflex when directive is empty', async () => {
    const state = buildState({ directive: '', llmResponse: '' });

    const result = await planDetectStrategy.run(state);

    expect(result.stateUpdates?.executionTier).toBe(ExecutionTierId.Reflex);
    // No directive → gen-plan (no existing target) or rev-plan (existing).
    // Either way, tier must default to Reflex since no LLM judgment ran.
    expect(['gen-plan', 'rev-plan']).toContain(result.inferred?.intentId);
  });
});
