/**
 * test-code/hooks/check.ts — TaskCheckHook.evaluate
 *
 * Produces the `incomplete_implementation` violation when a test-code
 * task signalled `<done>` but no matching test files (`*.test.*` /
 * `*.spec.*`) actually made it to disk. Replaces the inline guard that
 * used to live at `graph.ts` L142 and `parallel/workerGraph.ts` L176
 * (both removed in T6b-γ when `checkTaskStatus` was promoted to its own
 * directory). The dispatch site is now `nodes/checkTaskStatus/evaluate.ts`
 * via `hooksIfActive(state)?.check?.evaluate(state)`.
 *
 * Preconditions enforced by the caller (mirror the removed inline branch):
 *   - the shared violations array is empty
 *   - `state.llmResponse?.done === true`
 *
 * Async surface — `detectTestFilesFromDisk` touches the filesystem, so
 * `TaskCheckHook.evaluate` returns `Violation | Promise<Violation | null> | null`.
 * The async-widening was introduced here (T5b.5) to accommodate this hook;
 * the verification hook remains sync and relies on structural narrowing.
 *
 * R2 — depends only on the verify SSOT's `env.detectTestFilesFromDisk`
 * helper (a pure fs query) and graph state types. No `task.type`
 * comparison: the registry routes by type, so this module only runs for
 * test-code tasks.
 */

import type { ArchitectGraphState, Violation, ViolationType } from '../../../state';
import { detectTestFilesFromDisk } from '../../_shared/verify/env';

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
