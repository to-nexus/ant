/**
 * `nodes/enforce/index.ts` — pure routing gate.
 *
 * Locks the post-priority-purge contract:
 *   - `violation.isRetryable` is SSOT; enforce never re-judges retryability.
 *   - "All non-retryable" path clears `violations` and, when `currentTask`
 *     is alive, signals `_nextPlanEntry: 'retry'` so plan does NOT fall
 *     into `handleFreshTaskEntry` (which would emit a duplicate
 *     `task_start` event and reset token counters).
 *   - "Any retryable" path increments `retries`, appends an
 *     `EnforcementFeedback` entry, forwards ALL retryable violations
 *     (no focus / top-2 pruning), and signals `_nextPlanEntry: 'retry'`.
 *   - `cross_worker_conflict` / `file_operation_failed` substitute the
 *     generic formatter output with concise actionable text.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enforce } from '../../src/agents/architect/graph/code/nodes/enforce';
import type { ArchitectGraphState, Violation } from '../../src/agents/architect/graph/code/state';

function violation(overrides: Partial<Violation> = {}): Violation {
  return {
    type: 'type_error',
    severity: 'critical',
    message: 'generic error',
    isRetryable: true,
    ...overrides,
  };
}

function makeState(overrides: Partial<ArchitectGraphState> = {}): ArchitectGraphState {
  return {
    currentTask: { id: 't1', name: 'task', type: 'feature', priority: 10 },
    retries: 0,
    maxRetries: 3,
    recursionCount: 0,
    recursionLimit: 50,
    violations: [],
    enforcementHistory: [],
    context: { task: '' },
    ...overrides,
  } as any;
}

describe('nodes/enforce', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  // `src/utils/verificationTrace` is env-gated (no-op unless
  // `ANT_VERIFICATION_TRACE_FILE` is set), so no mock required here.
  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('all-retryable → forwards all violations, increments retries, sets _nextPlanEntry=retry', async () => {
    const violations = [
      violation({ type: 'type_error', message: 'e1' }),
      violation({ type: 'build_error', message: 'e2' }),
      violation({ type: 'missing_dependency', message: 'e3' }),
    ];
    const state = makeState({ violations, retries: 0 });

    const result = await enforce(state);

    expect(result.violations).toEqual(violations);
    expect(result.retries).toBe(1);
    expect(result._nextPlanEntry).toBe('retry');
    expect(result.lastViolations).toEqual(violations);
    expect(result.enforcementHistory).toHaveLength(1);
    expect(result.enforcementHistory?.[0].violations).toEqual(violations);
    expect(result.enforcementHistory?.[0].attemptNumber).toBe(1);
    expect(result.enforcementHistory?.[0].fixStrategy).toBe('retry');
  });

  it('does NOT prune to top-N same-type (priority focus removed)', async () => {
    // 6 build_errors + 2 type_errors — pre-purge would slice(0, 2) of top type.
    const violations = [
      violation({ type: 'build_error', message: 'b1' }),
      violation({ type: 'build_error', message: 'b2' }),
      violation({ type: 'build_error', message: 'b3' }),
      violation({ type: 'build_error', message: 'b4' }),
      violation({ type: 'build_error', message: 'b5' }),
      violation({ type: 'build_error', message: 'b6' }),
      violation({ type: 'type_error', message: 't1' }),
      violation({ type: 'type_error', message: 't2' }),
    ];
    const state = makeState({ violations });

    const result = await enforce(state);

    expect(result.violations).toHaveLength(8);
  });

  it('all non-retryable + currentTask alive → clears violations, _nextPlanEntry=retry (defense-in-depth)', async () => {
    const violations = [
      violation({ isRetryable: false, severity: 'minor' }),
      violation({ isRetryable: false, severity: 'minor' }),
    ];
    const state = makeState({ violations });

    const result = await enforce(state);

    expect(result.violations).toEqual([]);
    expect(result._nextPlanEntry).toBe('retry');
    // No retries increment on non-retryable path.
    expect(result.retries).toBe(0);
    expect(result.enforcementHistory).toEqual([]);
  });

  it('all non-retryable + no currentTask → clears violations, _nextPlanEntry=undefined', async () => {
    const state = makeState({
      violations: [violation({ isRetryable: false })],
      currentTask: null as any,
    });

    const result = await enforce(state);

    expect(result.violations).toEqual([]);
    expect(result._nextPlanEntry).toBeUndefined();
  });

  it('mixed isRetryable → forwards only retryable ones', async () => {
    const retryable = violation({ type: 'build_error', message: 'ret', isRetryable: true });
    const state = makeState({
      violations: [
        retryable,
        violation({ type: 'lint_error', message: 'skip', isRetryable: false }),
      ],
    });

    const result = await enforce(state);

    expect(result.violations).toEqual([retryable]);
    expect(result._nextPlanEntry).toBe('retry');
    expect(result.retries).toBe(1);
  });

  it('cross_worker_conflict formatter replaces message with merge guidance', async () => {
    const state = makeState({
      violations: [
        violation({ type: 'cross_worker_conflict', file: 'src/a.ts', message: 'conflict a' }),
        violation({ type: 'cross_worker_conflict', file: 'src/b.ts', message: 'conflict b' }),
      ],
    });

    const result = await enforce(state);

    expect(result.violationMessage).toContain('CROSS-WORKER FILE CONFLICT');
    expect(result.violationMessage).toContain('src/a.ts');
    expect(result.violationMessage).toContain('src/b.ts');
    expect(result.violationMessage).toContain('read_file');
  });

  it('file_operation_failed + search-block mismatch → replaces message with read-then-edit guidance', async () => {
    const state = makeState({
      violations: [
        violation({
          type: 'file_operation_failed',
          file: 'src/c.ts',
          message: 'Search block not found in src/c.ts',
        }),
      ],
    });

    const result = await enforce(state);

    expect(result.violationMessage).toContain('PREVIOUS ATTEMPT FAILED');
    expect(result.violationMessage).toContain('src/c.ts');
    expect(result.violationMessage).toContain('read_file');
  });

  it('file_operation_failed WITHOUT search-block keyword falls back to generic formatter', async () => {
    const state = makeState({
      violations: [
        violation({
          type: 'file_operation_failed',
          file: 'src/d.ts',
          message: 'some other failure',
        }),
      ],
    });

    const result = await enforce(state);

    // Generic formatter path — no special replacement header.
    expect(result.violationMessage).not.toContain('PREVIOUS ATTEMPT FAILED');
  });

  it('retries counter monotonically increases on each retryable enforcement', async () => {
    const s1 = makeState({ violations: [violation()], retries: 0 });
    const r1 = await enforce(s1);
    expect(r1.retries).toBe(1);

    const s2 = makeState({ violations: [violation()], retries: r1.retries });
    const r2 = await enforce(s2);
    expect(r2.retries).toBe(2);
  });
});
