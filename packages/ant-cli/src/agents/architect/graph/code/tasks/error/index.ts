/**
 * tasks/error/index.ts — error task bundle.
 *
 * Error tasks carry four domain-specific fields on `CodeTask`
 * (`prePlanText`, `errors`, `category`, `remediationMode`) read directly
 * from the task at the phase-layer call sites (plan fast-path, execute
 * framing, batch-split emission).
 *
 * Wired through `composeBundle({...})` so Tier 2 self-verify error
 * tasks (decompose-time `selfVerifyOnDone:true`) automatically pick up
 * the `_shared/verify/` hook surface (Session, plan/execute/command/
 * check/router/orchestrator/tool/budgetExhaustedHint) once they
 * transition into verify-mode via `executeRouter.routeAfterDone`.
 * Tier 3/4 error tasks (no `selfVerifyOnDone`) fall through composeBundle
 * untouched — `requiresVerification` returns false and apply-phase
 * hooks stay active end-to-end.
 *
 * Apply-phase hooks (active when `_verifyEntered === false`):
 *   - plan.buildPrompt           — error-variant plan prompt rendering
 *                                  (port of planGeneration.ts L150~172)
 *   - plan.toolLoopLogTemplate   — plan-toolLoop debug log path
 *   - execute (TaskExecuteHook)  — error-variant execute template +
 *                                  remediation plan framing
 *   - command.guard              — execute-phase build/test/typecheck
 *                                  block (Tier 3/4 default — error
 *                                  applies fixes only, diagnostics run
 *                                  in the next verification cycle).
 *
 * Bundle-static hooks (phase-mode-blind):
 *   - decompose.isExclusive       — error tasks always head-of-queue
 *   - conversations.convKey       — per-task conversation scope
 *   - orchestrator.onTaskComplete — defense-in-depth Final Verification
 *                                   fallback (logged warning when
 *                                   primary path failed to enqueue one)
 */

import { isExclusive } from './hooks/decompose';
import { convKey } from './hooks/conversations';
import { buildPrompt as planBuildPrompt } from './hooks/plan';
import { guard as commandGuard } from './hooks/command';
import { onTaskComplete as orchestratorOnTaskComplete } from './hooks/orchestrator';
import { executeHook } from './hooks/execute';
import { composeBundle } from '../_shared/verify';

export const hooks = composeBundle({
  apply: {
    plan: {
      buildPrompt: planBuildPrompt,
      toolLoopLogTemplate: 'jobs/code/nodes/plan/variants/error/base',
    },
    execute: executeHook,
    command: { guard: commandGuard },
  },
  taskTypeSpecific: {
    decompose: { isExclusive },
    conversations: { convKey },
    orchestrator: { onTaskComplete: orchestratorOnTaskComplete },
  },
});

export { isErrorTask } from './model/is';
