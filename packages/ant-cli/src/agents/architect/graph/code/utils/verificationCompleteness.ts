/**
 * Axis B — Verification completion SSOT.
 *
 * A verification task is complete only when every objective flagged as
 * required by the tracker has actually passed. This single function
 * replaces four scattered completion judgments (plan, checkTaskStatus,
 * executeRouter, worker checkTaskStatus) that had drifted out of sync —
 * the root cause of "plan passed but the graph kept re-verifying".
 *
 * The `<done>` tag contract is handled separately in `checkTaskStatus`
 * (see `llmExplicitlyDone` guard) and is NOT re-checked here.
 */

import type { VerificationTracker } from '../state';

export type MissingStep = 'typecheck' | 'build' | 'test';

export interface VerificationCompleteness {
  ok: boolean;
  missing: MissingStep[];
}

/**
 * Compute which verification objectives are still outstanding.
 *
 * `undefined` tracker → treated as incomplete with a placeholder missing step
 * so callers can produce a meaningful violation message.
 */
export function isVerificationComplete(
  tracker: VerificationTracker | undefined,
): VerificationCompleteness {
  if (!tracker) {
    return { ok: false, missing: ['build'] };
  }
  const missing: MissingStep[] = [];
  if (tracker.typecheckRequired && !tracker.typecheckPassed) missing.push('typecheck');
  if (!tracker.buildPassed) missing.push('build');
  if (tracker.testsRequired && !tracker.testPassed) missing.push('test');
  return { ok: missing.length === 0, missing };
}

/**
 * Describe the first missing step for prompt/violation messages.
 * Returns undefined when the tracker reports complete.
 */
export function describeMissingStep(tracker: VerificationTracker | undefined): string | undefined {
  const { ok, missing } = isVerificationComplete(tracker);
  if (ok) return undefined;
  return missing[0];
}

/**
 * Stock verification_incomplete violation content keyed by missing step.
 * Shared between main graph checkTaskStatus and worker checkTaskStatus so
 * the two paths produce identical phrasing.
 */
export interface MissingStepDetail {
  message: string;
  fix: string;
}

const MISSING_STEP_DETAILS: Record<MissingStep, MissingStepDetail> = {
  typecheck: {
    message: 'Type check (tsc --noEmit) has not succeeded. Resolve type errors before proceeding to build.',
    fix: 'Fix type errors found by tsc --noEmit, then re-run type check.',
  },
  build: {
    message: 'Build has not succeeded. A build command must exit 0 with no file modifications after it.',
    fix: 'Run the build command and ensure it passes. If you edited files after the last build, re-run the build.',
  },
  test: {
    message: 'Tests have not passed. Test files exist in this project — run tests and ensure they pass.',
    fix: 'Run the test command and ensure all tests pass before marking done.',
  },
};

export function getMissingStepDetail(step: MissingStep): MissingStepDetail {
  return MISSING_STEP_DETAILS[step];
}
