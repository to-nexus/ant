/**
 * setup/hooks/execute.ts — TaskExecuteHook for setup tasks.
 *
 * Setup flows through the generic execute template but skips the
 * examples injection: foundation work should not be steered by
 * feature-style examples that assume the project already exists.
 * Cross-task context (Foundation Contract / Schema Anchor) stays
 * enabled — setup may want to inspect migrations when scaffolding.
 */

import type { TaskExecuteHook } from '../../_shared/types';

export const executeHook: TaskExecuteHook = {
  skipExamples: true,
};
