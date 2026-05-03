/**
 * Routing invariants for the design-job plan↔tool integration.
 *
 * Covers:
 *   - `routeAfterPlan`: plan node response dispatch by `_activePhase` +
 *     tool-call presence.
 *   - `routeAfterTool`: tool-node return dispatch by `_activePhase`.
 *   - `routeAfterResolve` (clarify branch): clarify-resume now goes to
 *     plan rather than docGen so the new directive triggers a re-plan
 *     instead of bypassing the deep-think phase.
 *   - `routeAfterCheckTaskStatus`: continues to land on `plan` when the
 *     queue still has work (regression guard for the new plan-LLM node).
 */

import { describe, it, expect } from 'vitest';
import {
  routeAfterPlan,
  routeAfterTool,
  routeAfterResolve,
  routeAfterCheckTaskStatus,
} from '../../src/agents/architect/graph/design/routing';
import type { DesignGraphState } from '../../src/agents/architect/graph/design/state';
import { TaskQueue } from '../../src/agents/architect/types/task';

function freezeState(partial: Partial<DesignGraphState>): DesignGraphState {
  return Object.freeze(partial) as unknown as DesignGraphState;
}

describe('routeAfterPlan — design plan response dispatch', () => {
  it('routes to tool when _activePhase=plan and tool calls are present', () => {
    const state = freezeState({
      _activePhase: 'plan',
      llmResponse: {
        done: false,
        toolCalls: [{ id: '1', name: 'read_file', args: { path: 'a' } }],
      },
    });
    expect(routeAfterPlan(state)).toBe('tool');
  });

  it('routes to docGen when _activePhase=plan but no tool calls (sealed plan)', () => {
    const state = freezeState({
      _activePhase: 'plan',
      llmResponse: { done: true, toolCalls: [] },
    });
    // Plan emitted <plan> in this round → loop sealed → routes to docGen.
    expect(routeAfterPlan(state)).toBe('docGen');
  });

  it('routes to docGen when _activePhase is undefined (dispatchOnly fallthrough or sealed exit)', () => {
    const state = freezeState({
      _activePhase: undefined,
      llmResponse: { done: true, toolCalls: [] },
    });
    expect(routeAfterPlan(state)).toBe('docGen');
  });

  it('routes to docGen when llmResponse is missing (legacy dispatchOnly path)', () => {
    const state = freezeState({});
    expect(routeAfterPlan(state)).toBe('docGen');
  });
});

describe('routeAfterTool — design tool-node dispatch', () => {
  it('returns to plan when _activePhase=plan', () => {
    expect(routeAfterTool(freezeState({ _activePhase: 'plan' }))).toBe('plan');
  });

  it('returns to docGen when _activePhase is undefined', () => {
    expect(routeAfterTool(freezeState({}))).toBe('docGen');
  });
});

describe('routeAfterResolve — clarify branch goes to plan', () => {
  it('routes clarify-resume with new directive to plan (not docGen)', () => {
    const state = freezeState({
      isResume: true,
      awaitingClarify: true,
      overrideDirective: 'Add OAuth support',
    });
    expect(routeAfterResolve(state)).toBe('plan');
  });

  it('still routes detect-clarify resume to detect (unchanged path)', () => {
    const state = freezeState({
      isResume: true,
      awaitingDetectClarify: true,
      overrideDirective: 'spec',
    });
    expect(routeAfterResolve(state)).toBe('detect');
  });
});

describe('routeAfterCheckTaskStatus — regression guard', () => {
  it('still routes to plan when more tasks remain', () => {
    const queue = new TaskQueue<any>();
    queue.push({ id: 't2', name: 'next-task' } as any);
    const state = freezeState({ taskQueue: queue });
    expect(routeAfterCheckTaskStatus(state)).toBe('plan');
  });

  it('routes to learn when queue is empty and no validation retry', () => {
    const queue = new TaskQueue<any>();
    const state = freezeState({ taskQueue: queue });
    expect(routeAfterCheckTaskStatus(state)).toBe('learn');
  });
});
