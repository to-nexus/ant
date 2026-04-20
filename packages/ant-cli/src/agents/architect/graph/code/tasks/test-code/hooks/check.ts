/**
 * test-code/hooks/check.ts — TaskCheckHook.evaluate
 *
 * Replaces the test-code guard currently duplicated in
 * `graph.ts` L142 and `parallel/workerGraph.ts` L176:
 *
 *     if (violations.length === 0 && llmExplicitlyDone && currentTask?.type === 'test-code') {
 *       const testFilesExist = detectTestFilesFromDisk(featurePath);
 *       if (!testFilesExist) violations.push(...);
 *     }
 *
 * Once T6 flips `checkTaskStatus` to consult `hooksIfActive(state)?.check`,
 * the branch disappears from both phase files. The disk scan is async
 * because `detectTestFilesFromDisk` touches the filesystem; the hook
 * surface was widened to `Violation | Promise<Violation | null> | null`
 * at T5b to accommodate this.
 *
 * Callers (T6 checkTaskStatus) should:
 *   1. Only consult this hook AFTER the shared violations array is empty
 *      AND `llmResponse.done === true` — i.e. the same preconditions the
 *      original branch observed.
 *   2. Await the result.
 *
 * R2 — depends only on the plan node's `testFileDetector` helper (a
 * pure fs query) and graph state types.
 */

import type { ArchitectGraphState, Violation, ViolationType } from '../../../state';
import { detectTestFilesFromDisk } from '../../../nodes/plan/testFileDetector';

const MESSAGE =
  'test-code task completed but no test files (*.test.ts / *.spec.ts / *.test.js / *.spec.js) were found in the workspace.';

const SUGGESTED_FIX = 'Create the required test files before marking this task as done.';

export async function evaluate(state: ArchitectGraphState): Promise<Violation | null> {
  const exists = detectTestFilesFromDisk(state.context?.featurePath);
  if (exists) return null;
  return {
    type: 'incomplete_implementation' as ViolationType,
    severity: 'critical',
    message: MESSAGE,
    isRetryable: true,
    suggestedFix: SUGGESTED_FIX,
  };
}
