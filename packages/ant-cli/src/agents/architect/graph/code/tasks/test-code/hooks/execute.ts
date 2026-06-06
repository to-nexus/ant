/**
 * test-code/hooks/execute.ts — TaskExecuteHook for test-code tasks.
 *
 * Test-code is NON-forking: it rides the shared `execute/variants/default`
 * template (which gate-includes the `test-code-task` / `test-code-rules`
 * overlays), so this hook publishes NO `templatePaths`. It only keeps
 * `skipExamples` — the LLM writes test files against an already-completed
 * implementation and does not need the broad example scaffolding.
 */

import type { TaskExecuteHook } from '../../_shared/types';

export const executeHook: TaskExecuteHook = {
  skipExamples: true,
};
