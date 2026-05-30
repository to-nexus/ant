/**
 * test-code/hooks/execute.ts — TaskExecuteHook for test-code tasks.
 *
 * Test-code tasks ride their own execute template variant and skip heavy
 * context (examples / foundation contract / schema anchor) because the
 * LLM is writing test files against an already-completed implementation
 * and does not need the broad scaffolding hints.
 */

import type { TaskExecuteHook } from '../../_shared/types';
import { TEMPLATE_PATHS } from '../../../../../../../core/prompt/builder/templatePaths';

export const executeHook: TaskExecuteHook = {
  templatePaths: {
    base: TEMPLATE_PATHS.codeExecuteTestCode.base,
    rules: TEMPLATE_PATHS.codeExecuteTestCode.rules!,
  },
  skipExamples: true,
};
