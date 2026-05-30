/**
 * error/hooks/execute.ts — TaskExecuteHook for error tasks.
 *
 * Error tasks share the remediation-plan framing with verification but
 * ship their own template variant and surface a `remediationMode*` vars
 * pair that the variant template reads for upstream-vs-refactor gating
 * (Phase 3-11). Directive is kept (error tasks may carry user-reported
 * error text in `state.directive`).
 *
 * R2 compliance: depends on `_shared/types` only.
 */

import type { TaskExecuteHook, ExecutePromptCtx } from '../../_shared/types';
import { TEMPLATE_PATHS } from '../../../../../../../core/prompt/builder/templatePaths';

const templatePaths = {
  base: TEMPLATE_PATHS.codeExecuteError.base,
  rules: TEMPLATE_PATHS.codeExecuteError.rules!,
} as const;

const runtimePlanFraming = {
  label: '📋 REMEDIATION PLAN (Structured JSON - FOLLOW EXACTLY)',
  description:
    'The following JSON contains the diagnostic analysis and fix instructions.\n' +
    '- `diagnostics`: Build/test error analysis\n' +
    '- `modify`: Files to modify with specific fixes\n' +
    '- `create`: Files to create (if any)\n' +
    '- `delete`: Files to delete (if any)',
} as const;

function emptyPlanFallback(): string {
  return '**Error investigation found no code changes needed. Output `<done>true</done>` immediately.**';
}

function extraTemplateVars(ctx: ExecutePromptCtx): Record<string, unknown> {
  const mode = ctx.task?.remediationMode;
  return {
    remediationModeUpstream: mode === 'upstream',
    remediationModeRefactor: mode === 'refactor',
  };
}

export const executeHook: TaskExecuteHook = {
  templatePaths,
  skipExamples: true,
  extraTemplateVars,
  runtimePlanFraming,
  emptyPlanFallback,
};
