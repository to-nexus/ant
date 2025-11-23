/**
 * Retry Context Builder - Extract retry context for template injection
 */

import { ArchitectGraphState } from "../../state";

export interface RetryContext {
  attemptNumber: number;
  originalDirective: string;
  previousAttempts: Array<{
    attemptNumber: number;
    approach: string;
    error: string;
    wasCloseToSuccess: boolean;
  }>;
  currentError: string;
}

/**
 * Build retry context for template injection
 */
export function buildRetryContext(state: ArchitectGraphState): RetryContext | null {
  if (!state.retries || state.retries === 0) {
    return null;
  }
  
  // Extract original directive
  const originalDirective = state.directive || state.context.task || '';
  
  // Build previous attempts history
  const previousAttempts = (state.previousAttempts || []).map(attempt => ({
    attemptNumber: attempt.attemptNumber,
    approach: attempt.keyChanges.join(', ') || 'No changes recorded',
    error: attempt.errorsAttemptedToFix.join('; ') || 'Unknown error',
    wasCloseToSuccess: attempt.filesGenerated.length > 0
  }));
  
  // Current error (from enforcementReason)
  const currentError = state.enforcementReason || 'See violations below';
  
  return {
    attemptNumber: state.retries,
    originalDirective,
    previousAttempts,
    currentError
  };
}