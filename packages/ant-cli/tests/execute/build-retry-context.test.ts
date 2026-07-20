/**
 * buildRetryContext — the retry-attempt memory channel (heavy-grading-folio).
 *
 * `enforcementHistory` accumulates each failed attempt's violations
 * (checkTaskStatus append), and buildRetryContext renders them into the
 * execute prompt — but ONLY when `state.retries > 0`. When the counter was
 * clobbered back to 0 by the prePlanned fast path, this gate stayed shut and
 * every retry attempt got a byte-identical prompt with zero memory of the
 * prior failures. These tests lock the gate contract from both sides.
 */

import { describe, it, expect } from 'vitest';
import { buildRetryContext } from '../../src/agents/architect/graph/code/nodes/execute/buildMessages';

const FEEDBACK = {
  taskId: 'error-1',
  taskName: 'rename-test-files',
  attemptNumber: 1,
  violations: [
    {
      type: 'no_done_signal',
      message:
        'Repeated failure detected: "tool:read_file:codebase/a-test.ts" failed 5 time(s) in the last 5 minutes',
      isRetryable: true,
      suggestedFix: 'Do not repeat the exact same call. Verify the path with list_files.',
    },
  ],
  timestamp: Date.now(),
};

describe('buildRetryContext', () => {
  it('returns null when retries is 0 (fresh attempt — no retry memory to render)', () => {
    const state: any = { retries: 0, enforcementHistory: [FEEDBACK] };
    expect(buildRetryContext(state)).toBeNull();
  });

  it('returns null when enforcementHistory is empty', () => {
    const state: any = { retries: 1, enforcementHistory: [] };
    expect(buildRetryContext(state)).toBeNull();
  });

  it('renders prior-attempt failure detail once retries survives the plan boundary', () => {
    const state: any = {
      retries: 1,
      enforcementHistory: [FEEDBACK],
      violations: [],
      planText: 'Rename 5 test files from -test.ts to .test.ts',
      context: { task: 'rename test files' },
    };
    const ctx = buildRetryContext(state);
    expect(ctx).not.toBeNull();
    expect(ctx!.attemptNumber).toBe(2);
    expect(ctx!.previousAttempts).toHaveLength(1);
    expect(ctx!.previousAttempts[0].error).toContain('Repeated failure detected');
    expect(ctx!.previousAttempts[0].approach).toContain('Do not repeat the exact same call');
  });
});
