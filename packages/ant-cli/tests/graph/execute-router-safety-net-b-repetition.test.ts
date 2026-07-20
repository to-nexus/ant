/**
 * executeRouter — Safety Net B repetition semantics (heavy-grading-folio RCA).
 *
 * B's documented intent is "repeated tool failures", but the original
 * implementation counted raw failure VOLUME in the 5-minute window. A single
 * parallel batch of 5 DISTINCT first-time failures (5 exploratory read_file
 * misses) tripped it instantly — tearing the conversation down into a fresh
 * retry before the model ever saw the failure results, which is exactly the
 * round where in-context self-correction happens ("File not found …
 * Before retrying: use list_files"). Contracts:
 *
 *   1. A failure the model has not yet observed is NOT repetition: ≥5
 *      distinct failures alone must not divert.
 *   2. A repeated failure signature (same command failing 2+ times in the
 *      window) plus volume ≥5 diverts to checkTaskStatus.
 *   3. The incident geometry — text-only response after one distinct-failure
 *      batch — falls through to the `execute` re-reason route (conversation
 *      preserved), not a fresh-retry teardown.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { routeAfterExecute } from '../../src/agents/architect/graph/code/routers/executeRouter';
import { hasRepeatedRecentFailure } from '../../src/agents/architect/graph/code/nodes/tool/utils/helpers';

function failEntry(command: string, ageMs = 1000) {
  return { command, success: false, timestamp: Date.now() - ageMs };
}

function makeState(overrides: Record<string, any> = {}) {
  return {
    llmResponse: {
      toolCalls: [{ id: 'c1', name: 'read_file', args: { path: 'codebase/src/a.ts' } }],
      done: false,
    },
    currentTask: { id: 't1', name: 'task', type: 'error', priority: 999 },
    commandHistory: [],
    ...overrides,
  } as any;
}

const DISTINCT_5 = [
  failEntry('tool:read_file:codebase/a-test.ts'),
  failEntry('tool:read_file:codebase/b-test.ts'),
  failEntry('tool:read_file:codebase/c-test.ts'),
  failEntry('tool:read_file:codebase/d-test.ts'),
  failEntry('tool:read_file:codebase/e-test.ts'),
];

describe('hasRepeatedRecentFailure', () => {
  it('false for empty / undefined history', () => {
    expect(hasRepeatedRecentFailure(undefined)).toBe(false);
    expect(hasRepeatedRecentFailure([])).toBe(false);
  });

  it('false for distinct first-time failures', () => {
    expect(hasRepeatedRecentFailure(DISTINCT_5 as any)).toBe(false);
  });

  it('true when one command fails twice inside the window', () => {
    const history = [...DISTINCT_5, failEntry('tool:read_file:codebase/a-test.ts', 500)];
    expect(hasRepeatedRecentFailure(history as any)).toBe(true);
  });

  it('ignores successes and stale entries', () => {
    const now = Date.now();
    const history = [
      { command: 'tool:read_file:x', success: true, timestamp: now - 100 },
      { command: 'tool:read_file:x', success: true, timestamp: now - 200 },
      // repeated failure, but outside the 5-minute window
      { command: 'tool:read_file:y', success: false, timestamp: now - 6 * 60 * 1000 },
      { command: 'tool:read_file:y', success: false, timestamp: now - 7 * 60 * 1000 },
    ];
    expect(hasRepeatedRecentFailure(history as any)).toBe(false);
  });
});

describe('executeRouter — Safety Net B requires a repeated failure signature', () => {
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

  it('5 distinct first-time failures with pending tool calls → tool (no divert)', () => {
    const state = makeState({ commandHistory: DISTINCT_5 });
    expect(routeAfterExecute(state)).toBe('tool');
  });

  it('incident geometry: text-only response after one distinct-failure batch → execute re-reason', () => {
    const state = makeState({
      commandHistory: DISTINCT_5,
      llmResponse: { toolCalls: [], done: false, content: 'The files do not exist — I will list the directory.' },
    });
    expect(routeAfterExecute(state)).toBe('execute');
  });

  it('repeated signature (same command failing twice) + volume ≥5 → checkTaskStatus', () => {
    const state = makeState({
      commandHistory: [...DISTINCT_5, failEntry('tool:read_file:codebase/a-test.ts', 500)],
    });
    expect(routeAfterExecute(state)).toBe('checkTaskStatus');
  });

  it('same-command hammering (the trim-grinding-motif class) still trips', () => {
    const state = makeState({
      commandHistory: Array.from({ length: 5 }, (_, i) => failEntry('tool:read_file:x', i * 100)),
    });
    expect(routeAfterExecute(state)).toBe('checkTaskStatus');
  });
});
