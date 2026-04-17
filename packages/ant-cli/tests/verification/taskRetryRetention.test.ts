import { describe, it, expect } from 'vitest';
import {
  summarizeForRetry,
  summarizeForResume,
  renderRetrySummary,
  TASK_RETRY_RETENTION_DEFAULTS,
} from '../../src/core/context/taskRetryRetention';

describe('Axis D — taskRetryRetention', () => {
  it('summarizeForRetry captures violations and truncates long plan JSON', () => {
    const longPlan = 'X'.repeat(TASK_RETRY_RETENTION_DEFAULTS.MAX_PLAN_JSON_CHARS + 500);
    const summary = summarizeForRetry({
      violations: [
        { type: 'build_error', severity: 'critical', message: 'Module not found: foo at src/a.ts:10:5' },
        { type: 'build_error', severity: 'critical', message: 'Module not found: foo at src/b.ts:3:2' },
      ] as any,
      lastPlan: longPlan,
    }, { attemptCount: 3, commandHistory: [{ command: 'pnpm build', success: false, exitCode: 1 }] });

    expect(summary.attemptCount).toBe(3);
    expect(summary.lastPlanJson).toBeDefined();
    expect(summary.lastPlanJson!.length).toBeLessThanOrEqual(
      TASK_RETRY_RETENTION_DEFAULTS.MAX_PLAN_JSON_CHARS + 50,
    );
    expect(summary.lastPlanJson).toMatch(/truncated/);
    expect(summary.normalizedErrors.length).toBeGreaterThan(0);
    expect(summary.commandHistory).toHaveLength(1);
    expect(summary.commandHistory[0].success).toBe(false);
  });

  it('summarizeForRetry deduplicates error signals across similar violations', () => {
    const summary = summarizeForRetry({
      violations: [
        { type: 'type_error', message: 'TS2304: Cannot find name "foo" at src/a.ts:1:1', severity: 'critical' },
        { type: 'type_error', message: 'TS2304: Cannot find name "foo" at src/b.ts:2:3', severity: 'critical' },
      ] as any,
    });
    // After normalization both messages become identical → dedup leaves one.
    expect(summary.normalizedErrors.length).toBe(1);
  });

  it('summarizeForResume falls back to resume reason', () => {
    const summary = summarizeForResume('some-plan');
    expect(summary.failureReason).toMatch(/interrupted/i);
    expect(summary.lastPlanJson).toBe('some-plan');
  });

  it('renderRetrySummary produces markdown with attempt number and commands', () => {
    const md = renderRetrySummary({
      attemptCount: 2,
      lastPlanJson: '{"x":1}',
      normalizedErrors: ['Some error line'],
      commandHistory: [{ command: 'pnpm build', success: false, exitCode: 1 }],
      failureReason: 'build failed',
      lastAttemptAt: '2025-01-01T00:00:00.000Z',
    });
    expect(md).toMatch(/attempt #2/i);
    expect(md).toMatch(/pnpm build/);
    expect(md).toMatch(/Some error line/);
    expect(md).toMatch(/Constraint/);
  });

  it('commandHistory is capped to most-recent N entries', () => {
    const cmds = Array.from({ length: TASK_RETRY_RETENTION_DEFAULTS.MAX_COMMAND_HISTORY + 5 })
      .map((_, i) => ({ command: `cmd-${i}`, success: i % 2 === 0, exitCode: 0 }));
    const summary = summarizeForRetry({ violations: [] }, { commandHistory: cmds });
    expect(summary.commandHistory.length).toBe(TASK_RETRY_RETENTION_DEFAULTS.MAX_COMMAND_HISTORY);
    // Tail is preserved, not head
    expect(summary.commandHistory[0].command).toMatch(/^cmd-\d+$/);
    expect(summary.commandHistory[summary.commandHistory.length - 1].command).toBe(
      `cmd-${cmds.length - 1}`,
    );
  });
});
