/**
 * executeRouter — Safety Net C (no-progress circuit breaker), rocky-beating-
 * coral RCA.
 *
 * The degenerate loop carries a SUCCESSFUL tool call every turn, so the
 * breaker MUST be evaluated above the toolCalls route — below it, it would
 * never fire (the incident's exact geometry: 296 rounds of read_file, each
 * routed to the tool node). Contracts:
 *
 *   1. streak ≥ NO_PROGRESS_HARD_CAP with pending toolCalls → checkTaskStatus
 *      (divert precedence over the tool route).
 *   2. streak = CAP − 1 with toolCalls → 'tool' (no premature divert).
 *   3. R1 task-type blindness: identical routing across task types.
 *   4. Existing net ordering intact: Safety Net B (failures) still fires,
 *      fileErrors still divert, `<done>` still routes via the done branch
 *      when the streak is clean (execute resets the streak on explicitDone
 *      before the router runs — locked by the execute-node static test).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { routeAfterExecute } from '../../src/agents/architect/graph/code/routers/executeRouter';
import { NO_PROGRESS_HARD_CAP, NO_OUTPUT_HARD_CAP } from '../../src/agents/architect/graph/code/state';

function makeState(overrides: Record<string, any> = {}) {
  return {
    llmResponse: {
      toolCalls: [{ id: 'c1', name: 'read_file', args: { path: 'codebase/src/a.ts' } }],
      done: false,
    },
    currentTask: { id: 't1', name: 'task', type: 'test-code', priority: 800 },
    commandHistory: [],
    ...overrides,
  } as any;
}

describe('executeRouter — Safety Net C (no-progress breaker)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    debugSpy.mockRestore();
  });

  it('diverts to checkTaskStatus at the cap EVEN WITH pending tool calls', () => {
    const state = makeState({ _noProgressStreak: NO_PROGRESS_HARD_CAP });
    expect(routeAfterExecute(state)).toBe('checkTaskStatus');
  });

  it('diverts above the cap too (streak keeps growing during stripped turns)', () => {
    const state = makeState({ _noProgressStreak: NO_PROGRESS_HARD_CAP + 3 });
    expect(routeAfterExecute(state)).toBe('checkTaskStatus');
  });

  it('routes to tool at CAP − 1 (no premature divert)', () => {
    const state = makeState({ _noProgressStreak: NO_PROGRESS_HARD_CAP - 1 });
    expect(routeAfterExecute(state)).toBe('tool');
  });

  it('routes to tool when the channel is unset', () => {
    expect(routeAfterExecute(makeState())).toBe('tool');
  });

  it('is task-type-blind (R1): identical routing for feature/ui/verification/test-code', () => {
    for (const type of ['feature', 'ui', 'verification', 'test-code']) {
      const tripped = makeState({
        _noProgressStreak: NO_PROGRESS_HARD_CAP,
        currentTask: { id: 't', name: 'n', type, priority: 1 },
      });
      expect(routeAfterExecute(tripped)).toBe('checkTaskStatus');

      const clean = makeState({
        _noProgressStreak: 0,
        currentTask: { id: 't', name: 'n', type, priority: 1 },
      });
      expect(routeAfterExecute(clean)).toBe('tool');
    }
  });

  it('Safety Net C2 (no-output) diverts at NO_OUTPUT_HARD_CAP with pending tool calls (cyan-catching-cedar)', () => {
    // _noProgressStreak stays 0 (novel reads); _noOutputStreak alone trips.
    const state = makeState({ _noProgressStreak: 0, _noOutputStreak: NO_OUTPUT_HARD_CAP });
    expect(routeAfterExecute(state)).toBe('checkTaskStatus');
  });

  it('C2 routes to tool at NO_OUTPUT_HARD_CAP − 1 (no premature divert)', () => {
    const state = makeState({ _noProgressStreak: 0, _noOutputStreak: NO_OUTPUT_HARD_CAP - 1 });
    expect(routeAfterExecute(state)).toBe('tool');
  });

  it('C2 is task-type-blind (R1): identical routing across task types', () => {
    for (const type of ['feature', 'ui', 'verification', 'test-code']) {
      const tripped = makeState({
        _noProgressStreak: 0,
        _noOutputStreak: NO_OUTPUT_HARD_CAP,
        currentTask: { id: 't', name: 'n', type, priority: 1 },
      });
      expect(routeAfterExecute(tripped)).toBe('checkTaskStatus');
    }
  });

  it('Safety Net B (repeated failures) still fires first — ordering intact', () => {
    const now = Date.now();
    const state = makeState({
      _noProgressStreak: 0,
      commandHistory: Array.from({ length: 5 }, (_, i) => ({
        command: 'tool:read_file:x', success: false, timestamp: now - i * 1000,
      })),
    });
    expect(routeAfterExecute(state)).toBe('checkTaskStatus');
  });

  it('fileErrors still divert when the streak is clean', () => {
    const state = makeState({
      _noProgressStreak: 0,
      llmResponse: { toolCalls: [], done: false },
      fileErrors: ['Cannot edit non-existing file "x.ts"'],
    });
    expect(routeAfterExecute(state)).toBe('checkTaskStatus');
  });

  it('`<done>` with a clean streak routes through the done branch (checkTaskStatus default)', () => {
    const state = makeState({
      _noProgressStreak: 0,
      llmResponse: { toolCalls: [], done: true },
    });
    expect(routeAfterExecute(state)).toBe('checkTaskStatus');
  });
});
