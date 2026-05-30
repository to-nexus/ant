/**
 * `_shared/verify/hooks/executeHook` — TaskExecuteHook for verify-mode.
 *
 * SSOT: previously `tasks/verification/hooks/execute.ts`. Moved here so
 * self-verify Tier 2 tasks render the same execute-phase template as
 * Tier 3/4 verification tasks once they enter verify-mode.
 *
 * Owns the execute-node's verification-specific knobs that used to live
 * inline in `nodes/execute/buildMessages.ts`:
 *
 *   - variant template path (`variants/verification/{base,rules}`)
 *   - heavy-context skip (no examples / foundation contract / schema anchor
 *     while diagnosing)
 *   - directive blanking (verification runs from the plan JSON, not the
 *     user directive — preserving a stale directive would bias the agent)
 *   - remediation plan framing in runtime context
 *   - "build/test passed" fallback when the plan is empty
 *
 * R2 — depends on `_shared/types` only; no imports from `nodes/`,
 * `routers/`, or `parallel/`.
 */

import type { TaskExecuteHook } from '../../types';
import { TEMPLATE_PATHS } from '../../../../../../../../core/prompt/builder/templatePaths';

const templatePaths = {
  base: TEMPLATE_PATHS.codeExecuteVerification.base,
  rules: TEMPLATE_PATHS.codeExecuteVerification.rules!,
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
  return '**Build/test passed successfully. No code changes needed. Output `<done>true</done>` immediately.**';
}

export const executeHook: TaskExecuteHook = {
  templatePaths,
  skipExamples: true,
  skipCrossTaskContext: true,
  sanitizeDirective: () => '',
  runtimePlanFraming,
  emptyPlanFallback,
};
