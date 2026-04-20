/**
 * verification/hooks/decompose.ts — TaskDecomposeHook
 *
 * Replaces the verification arm of the `isTypeExclusive` check in
 * `nodes/decompose/responseParser.ts` L358. Verification tasks are always
 * exclusive — they act as a barrier so downstream tasks do not race against
 * an in-flight diagnostic cycle. This hook is invoked per task during
 * normalisation in T6.
 */

import type { CodeTask } from '../../../../../types/task';

/** Verification tasks are always exclusive. */
export function isExclusive(_task: CodeTask): boolean {
  return true;
}
