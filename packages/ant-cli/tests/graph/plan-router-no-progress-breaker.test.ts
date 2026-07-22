/**
 * planRouter safety nets (shy-crushing-bloom RCA).
 *
 * The plan↔tool loop (`plan → planRouter → tool → toolRouter → plan`) never
 * visits executeRouter, so before this fix it had ZERO safety nets — the
 * incident's 357 identical test re-runs rode the raw LangGraph recursion
 * limit to a whole-job hard interrupt. Contracts:
 *
 *   C (plan): `_noProgressStreak ≥ NO_PROGRESS_HARD_CAP` diverts a would-be
 *     tool round to checkTaskStatus.
 *   A (plan): a verify-mode task near recursion-budget exhaustion diverts to
 *     checkTaskStatus (graceful drain) even with a pending tool call.
 *   Healthy loops keep routing to 'tool'; finalized plans keep routing to
 *     'execute' / 'checkTaskStatus' untouched.
 *   Retry entry: a pending `_nextPlanEntry='retry'` outranks tool-loop
 *     reentry, and the retry clears the degenerate NODE_PLAN (static locks).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { routeAfterPlan } from '../../src/agents/architect/graph/code/routers/planRouter';
import {
  NO_PROGRESS_HARD_CAP,
  RECURSION_DRAIN_THRESHOLD,
} from '../../src/agents/architect/graph/code/state';
import type { ArchitectGraphState } from '../../src/agents/architect/graph/code/state';

function planLoopState(overrides: Partial<ArchitectGraphState> = {}): ArchitectGraphState {
  return {
    _activePhase: 'plan',
    llmResponse: { done: false, textResponse: '', thinking: '', toolCalls: [{ id: 'c1', name: 'run_command', args: {} }] },
    currentTask: { id: 't1', name: 'final verification', type: 'verification', priority: 1000 },
    ...overrides,
  } as unknown as ArchitectGraphState;
}

describe('planRouter — Safety Net C (no-progress breaker)', () => {
  it('diverts to checkTaskStatus when the streak reaches the cap', () => {
    const state = planLoopState({ _noProgressStreak: NO_PROGRESS_HARD_CAP });
    expect(routeAfterPlan(state)).toBe('checkTaskStatus');
  });

  it('keeps routing to tool below the cap', () => {
    const state = planLoopState({ _noProgressStreak: NO_PROGRESS_HARD_CAP - 1 });
    expect(routeAfterPlan(state)).toBe('tool');
  });

  it('applies to non-verification tasks too (task-type blind, R1)', () => {
    const state = planLoopState({
      _noProgressStreak: NO_PROGRESS_HARD_CAP,
      currentTask: { id: 't2', name: 'feat', type: 'feature', priority: 220 } as any,
    });
    expect(routeAfterPlan(state)).toBe('checkTaskStatus');
  });
});

describe('planRouter — Safety Net A (verify-mode recursion drain)', () => {
  it('diverts a verification task near budget exhaustion even with a pending tool call', () => {
    const state = planLoopState({
      recursionLimit: 200,
      recursionCount: 200 - RECURSION_DRAIN_THRESHOLD + 1,
    });
    expect(routeAfterPlan(state)).toBe('checkTaskStatus');
  });

  it('does NOT divert a non-final task on budget (mirrors executeRouter scope)', () => {
    const state = planLoopState({
      currentTask: { id: 't2', name: 'feat', type: 'feature', priority: 220 } as any,
      recursionLimit: 200,
      recursionCount: 199,
    });
    expect(routeAfterPlan(state)).toBe('tool');
  });

  it('does NOT divert with ample budget remaining', () => {
    const state = planLoopState({ recursionLimit: 200, recursionCount: 100 });
    expect(routeAfterPlan(state)).toBe('tool');
  });
});

describe('planRouter — untouched routes', () => {
  it('done outside the loop still routes to checkTaskStatus', () => {
    const state = planLoopState({
      _activePhase: 'execute',
      llmResponse: { done: true, textResponse: '', thinking: '', toolCalls: [] } as any,
    });
    expect(routeAfterPlan(state)).toBe('checkTaskStatus');
  });

  it('planText-ready (no tool calls) still routes to execute', () => {
    const state = planLoopState({
      llmResponse: { done: false, textResponse: '', thinking: '', toolCalls: [] } as any,
    });
    expect(routeAfterPlan(state)).toBe('execute');
  });

  it('a tripped streak cannot swallow a finalized plan (breaker lives inside the tool-loop branch)', () => {
    const state = planLoopState({
      _noProgressStreak: NO_PROGRESS_HARD_CAP,
      llmResponse: { done: false, textResponse: '', thinking: '', toolCalls: [] } as any,
    });
    expect(routeAfterPlan(state)).toBe('execute');
  });
});

describe('plan entry — breaker-divert retry path (static locks)', () => {
  const resolveSrc = readFileSync(
    resolve(__dirname, '../../src/agents/architect/graph/code/nodes/plan/entry/resolve.ts'),
    'utf8',
  );

  it('a pending retry directive outranks tool-loop reentry (anti infinite-divert)', () => {
    expect(resolveSrc).toMatch(
      /state\._activePhase === 'plan' && !!state\.currentTask &&\s*\n?\s*state\._nextPlanEntry !== 'retry'/,
    );
  });

  it('retry entered mid-plan-loop clears the degenerate NODE_PLAN (mutation + delta)', () => {
    expect(resolveSrc).toMatch(/const clearNodePlan = state\._activePhase === 'plan'/);
    const clears = (resolveSrc.match(/\.\.\.\(clearNodePlan \? \{ \[CONV_KEYS\.NODE_PLAN\]: \[\] \} : \{\}\)/g) ?? []).length;
    expect(clears).toBe(2);
  });
});

describe('plan tool loop — streak accrual wiring (static lock)', () => {
  it('toolLoop commits _noProgressStreak via the single-owner computeNextNoProgressStreak', () => {
    const src = readFileSync(
      resolve(__dirname, '../../src/agents/architect/graph/code/nodes/plan/llm/toolLoop.ts'),
      'utf8',
    );
    expect(src).toContain("import { computeNextNoProgressStreak } from '../../execute/drainFinalize'");
    expect(src).toMatch(/_noProgressStreak: nextNoProgressStreak/);
  });
});
