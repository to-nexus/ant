/**
 * L1 — `routeAfterPlan` purity invariants (T6b-α).
 *
 * The plan router must be a read-only function of `state`:
 *   - It never writes `state.llmResponse` (that flag is now flipped by the
 *     plan node when diagnostic / empty-implementation short-circuit fires).
 *   - It never calls task-type predicates directly; branching lives on the
 *     plan node / verification router hook.
 *
 * This suite freezes the router's state argument via `Object.freeze` so any
 * mutation would surface as an exception in strict mode, locking in the
 * contract described in handoff §7.5.
 */

import { describe, it, expect } from 'vitest';
import { routeAfterPlan } from '../src/agents/architect/graph/code/routers/planRouter';
import type { ArchitectGraphState } from '../src/agents/architect/graph/code/state';

function freezeState(partial: Partial<ArchitectGraphState>): ArchitectGraphState {
  if (partial.llmResponse) Object.freeze(partial.llmResponse);
  return Object.freeze(partial) as unknown as ArchitectGraphState;
}

describe('routeAfterPlan — pure read-only predicate', () => {
  it('routes to checkTaskStatus when plan signalled done=true', () => {
    const state = freezeState({
      _activePhase: 'execute',
      llmResponse: { done: true, textResponse: '', thinking: '', toolCalls: [] },
    });
    expect(routeAfterPlan(state)).toBe('checkTaskStatus');
  });

  it('does NOT route to checkTaskStatus when done=true but still in plan phase', () => {
    const state = freezeState({
      _activePhase: 'plan',
      llmResponse: { done: true, textResponse: '', thinking: '', toolCalls: [] },
    });
    // done=true inside plan phase is an intermediate signal (tool loop is
    // still expected to re-enter) — router must fall through to 'execute'.
    expect(routeAfterPlan(state)).toBe('execute');
  });

  it('routes to tool when plan phase has tool calls', () => {
    const state = freezeState({
      _activePhase: 'plan',
      llmResponse: {
        done: false,
        textResponse: '',
        thinking: '',
        toolCalls: [{ id: 't1', name: 'read_file', args: {} }],
      },
    });
    expect(routeAfterPlan(state)).toBe('tool');
  });

  it('routes to execute when plan finished without done or tool calls', () => {
    const state = freezeState({
      _activePhase: 'execute',
      llmResponse: { done: false, textResponse: '', thinking: '', toolCalls: [] },
    });
    expect(routeAfterPlan(state)).toBe('execute');
  });

  it('does NOT mutate llmResponse even on empty-implementation plan', () => {
    const llmResponse = { done: false, textResponse: '', thinking: '', toolCalls: [] };
    Object.freeze(llmResponse);
    const state = Object.freeze({
      _activePhase: 'execute',
      planText: '{"implementation":{"modify":[],"create":[],"delete":[]}}',
      currentTask: { id: 't1', name: 'v', type: 'verification' as const, priority: 1000, description: '' },
      llmResponse,
    }) as unknown as ArchitectGraphState;
    // The plan node is responsible for flipping done:true when it detects an
    // empty implementation; the router never touches llmResponse. Frozen
    // state asserts this: any mutation attempt would throw in strict mode.
    expect(() => routeAfterPlan(state)).not.toThrow();
    expect(state.llmResponse?.done).toBe(false);
  });
});
