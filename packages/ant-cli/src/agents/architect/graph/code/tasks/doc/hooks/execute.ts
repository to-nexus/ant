/**
 * doc/hooks/execute.ts — TaskExecuteHook for doc tasks.
 *
 * Doc tasks use the `docgen` variant. Heavy context (examples / foundation
 * contract / schema anchor) is skipped — documentation writing stays
 * focused on the curated RAC context. When the LLM needs directory
 * awareness it uses the `list_files` tool.
 */

import type { TaskExecuteHook } from '../../_shared/types';
import { TEMPLATE_PATHS } from '../../../../../../../core/prompt/builder/templatePaths';

export const executeHook: TaskExecuteHook = {
  templatePaths: {
    base: TEMPLATE_PATHS.codeExecuteDocgen.base,
    rules: TEMPLATE_PATHS.codeExecuteDocgen.rules!,
  },
  skipExamples: true,
};
