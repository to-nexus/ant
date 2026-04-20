/**
 * Verification completion SSOT.
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

import type { VerificationTracker, Violation, ViolationType } from '../state';

/**
 * Verification completion evaluation shared between the main
 * `checkTaskStatus` and the worker `workerCheckTaskStatus`.
 *
 * Callers remain responsible for the `<done>` tag contract and the
 * "violations are empty" precondition; this helper only judges whether
 * the tracker's required objectives have actually succeeded and, when
 * they have not, produces the shared `verification_incomplete` violation.
 */
export interface VerificationCommandHistoryEntry {
  command: string;
  success: boolean;
  exitCode?: number;
  errorSnippet?: string;
}

export interface EvaluateVerificationCompletionParams {
  tracker: VerificationTracker | undefined;
  commandHistory: VerificationCommandHistoryEntry[] | undefined;
  logPrefix: string;
}

export function evaluateVerificationCompletion(
  params: EvaluateVerificationCompletionParams,
): Violation | null {
  const { tracker, commandHistory, logPrefix } = params;
  const completeness = isVerificationComplete(tracker);

  if (!tracker) {
    const history = commandHistory || [];
    const lastCommand = history[history.length - 1];
    if (lastCommand && lastCommand.success) return null;

    console.warn(`⚠️  [${logPrefix}] Verification: no tracker, falling back to commandHistory`);
    return {
      type: 'verification_incomplete' as ViolationType,
      severity: 'critical',
      message: lastCommand
        ? `Last command failed (exit ${lastCommand.exitCode}): ${lastCommand.command}`
        : 'Verification task completed without executing any command.',
      isRetryable: true,
      suggestedFix: 'Run the build/test command and verify it succeeds before marking done.',
    };
  }

  if (completeness.ok) return null;

  const firstMissing = completeness.missing[0];
  console.warn(`⚠️  [${logPrefix}] Verification: ${firstMissing} objective not met (missing: ${completeness.missing.join(', ')})`);
  const history = commandHistory || [];
  const lastFailed = [...history].reverse().find(h => !h.success);
  const errorDetail = lastFailed?.errorSnippet
    ? `\n\nLast failed command: ${lastFailed.command}\nError output:\n${lastFailed.errorSnippet}`
    : '';
  const detail = getMissingStepDetail(firstMissing);
  return {
    type: 'verification_incomplete' as ViolationType,
    severity: 'critical',
    message: detail.message + errorDetail,
    isRetryable: true,
    suggestedFix: detail.fix,
  };
}

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
 * Enumerate the steps this verification task is required to run, in
 * observation order. Single source of truth for "which gates matter"
 * so that `isVerificationComplete` (missing steps) and
 * `formatCachedPassedSteps` (passed steps) cannot drift apart.
 */
export function enumerateRequiredSteps(tracker: VerificationTracker | undefined): MissingStep[] {
  if (!tracker) return ['build'];
  const required: MissingStep[] = [];
  if (tracker.typecheckRequired) required.push('typecheck');
  required.push('build');
  if (tracker.testsRequired) required.push('test');
  return required;
}

/**
 * Compute the steps that have already passed in the current diagnostic
 * cycle. Derived from `enumerateRequiredSteps` ∖ `isVerificationComplete.missing`
 * so that the "what's cached" prompt hint and the "what's missing"
 * violation rendering share a single judgment.
 */
export function enumeratePassedSteps(tracker: VerificationTracker | undefined): MissingStep[] {
  const required = enumerateRequiredSteps(tracker);
  const { missing } = isVerificationComplete(tracker);
  const missingSet = new Set(missing);
  return required.filter(s => !missingSet.has(s));
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
