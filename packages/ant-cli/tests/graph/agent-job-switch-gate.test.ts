/**
 * Agent/job-switch gate — `createInferDetectNode`.
 *
 * Regression: in `universal-context`, triage emits only `resolvedIntentId`
 * and the job-blind detect builds the RAC. When the resolved intent belongs
 * to a different agent/job than the currently selected one (e.g. you are in
 * `architect/code` but the request is system design → `gen-sys-*`), detect
 * used to proceed silently — building another job's tasks while the toolbar
 * stayed put. `inferRacWithTools` only gated on missing prerequisites, never
 * on the agent/job boundary.
 *
 * The fix adds a mechanical gate in the infer branch: if
 * `deriveFromIntent(resolvedIntentId)` crosses the current agent/job, detect
 * does NOT build a RAC — it surfaces a switch choice card (reusing the
 * `redirect-suggested` path) and pauses (`routeAfterDetect → __end__`).
 *
 * These tests pin the branch decision: the gate fires on a cross-job intent
 * (no RAC, `inferRacWithTools` never called), stays out of the way on an
 * in-job intent, and is exempt on the explicit path (user already chose).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the tool-loop so we can assert whether the gate short-circuited
// before it. The mock returns a trivial `proceed` result for the in-job path.
const inferRacWithToolsMock = vi.fn(async () => ({
  status: 'proceed' as const,
  resolvedAction: { intent: 'gen-code-directive', mode: 'generate', source: 'infer' } as any,
  artifacts: [],
}));

vi.mock('../../src/agents/common/graph/nodes/detect/inferRacWithTools.js', () => ({
  inferRacWithTools: (...args: unknown[]) => inferRacWithToolsMock(...(args as [])),
}));

import { createInferDetectNode } from '../../src/agents/common/graph/nodes/detect/index.js';
import type { DetectableState } from '../../src/agents/common/graph/nodes/detect/types.js';

function makeState(overrides: Partial<DetectableState>): DetectableState {
  return {
    context: {},
    currentAgent: 'architect',
    currentJob: 'code',
    deps: { llm: {} as any, promptBuilder: {} as any },
    ...overrides,
  } as DetectableState;
}

describe('createInferDetectNode — agent/job-switch gate', () => {
  beforeEach(() => {
    inferRacWithToolsMock.mockClear();
  });

  it('cross-job infer intent → no RAC, tool-loop bypassed (switch card path)', async () => {
    const node = createInferDetectNode();
    // currentJob = code, but the resolved intent is a design intent.
    const state = makeState({
      triageResult: { resolvedIntentId: 'gen-sys-full', group: 'work', mode: 'generate', domain: 'service' } as any,
    });

    const result = await node(state);

    expect(inferRacWithToolsMock).not.toHaveBeenCalled();
    expect(result.resolvedAction).toBeUndefined();
  });

  it('in-job infer intent → tool-loop runs, RAC produced', async () => {
    const node = createInferDetectNode();
    // currentJob = code, resolved intent is a code intent → no switch.
    const state = makeState({
      triageResult: { resolvedIntentId: 'gen-code-directive', group: 'work', mode: 'generate', domain: 'service' } as any,
    });

    const result = await node(state);

    expect(inferRacWithToolsMock).toHaveBeenCalledTimes(1);
    expect(result.resolvedAction).toBeDefined();
  });

  it('explicit path is exempt — cross-job explicit intent builds a RAC directly', async () => {
    const node = createInferDetectNode();
    // Explicit (user chose the action) → gate must not fire even though the
    // intent (design) crosses the current job (code).
    const state = makeState({
      actionMetadata: { intent: 'gen-sys-full', explicit: true, domain: 'service' } as any,
    });

    const result = await node(state);

    expect(inferRacWithToolsMock).not.toHaveBeenCalled();
    expect(result.resolvedAction).toBeDefined();
    expect(result.resolvedAction!.source).toBe('explicit');
  });
});
