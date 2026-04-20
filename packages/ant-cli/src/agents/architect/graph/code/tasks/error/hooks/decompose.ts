/**
 * error/hooks/decompose.ts — TaskDecomposeHook
 *
 * Replaces the error arm of the `isTypeExclusive` check in
 * `nodes/decompose/responseParser.ts` L358. Error tasks are always
 * exclusive: they sit at the head of the queue so their remediation
 * runs before any other feature / verification work can race against
 * the same files.
 */

import type { CodeTask } from '../../../../../types/task';

/** Error tasks are always exclusive. */
export function isExclusive(_task: CodeTask): boolean {
  return true;
}
