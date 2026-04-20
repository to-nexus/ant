/**
 * setup/hooks/decompose.ts — TaskDecomposeHook
 *
 * Replaces the setup arm of `isTypeExclusive` in
 * `nodes/decompose/responseParser.ts` L358. Setup tasks mutate project
 * infrastructure (package.json, lockfiles, config) so they must run
 * exclusively — any other task running concurrently would race on the
 * filesystem state setup is establishing.
 */

import type { CodeTask } from '../../../../../types/task';

/** Setup tasks are always exclusive. */
export function isExclusive(_task: CodeTask): boolean {
  return true;
}
