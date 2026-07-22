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
import { isPrdSyncTask } from '@ant/shared';

export const executeHook: TaskExecuteHook = {
  // Per-instance dispatch: a PRD-sync doc task (carries `prdSyncTargets`) uses
  // the prd-sync template (surgical full-rewrite of the named plan docs); an
  // ordinary doc task uses the docgen template (README / API docs).
  templatePaths: (task) =>
    isPrdSyncTask(task)
      ? { base: TEMPLATE_PATHS.codeExecutePrdSync.base, rules: TEMPLATE_PATHS.codeExecutePrdSync.rules! }
      : { base: TEMPLATE_PATHS.codeExecuteDocgen.base, rules: TEMPLATE_PATHS.codeExecuteDocgen.rules! },
  skipExamples: true,
};
