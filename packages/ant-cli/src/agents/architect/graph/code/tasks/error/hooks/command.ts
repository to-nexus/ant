/**
 * error/hooks/command.ts — TaskCommandHook.guard
 *
 * Error tasks apply fixes from an upstream remediation plan (batch-split
 * output carried on `prePlanText`, or a freshly-generated plan in the rare
 * no-prePlanText path).
 *
 * Default (Tier 3/4) semantics: error tasks are NOT diagnostic tasks — they
 * do not discover errors, they do not gate build/test/typecheck, and they
 * do not own a `VerificationSession`. The next scheduled verification task
 * re-runs those gates after the fix lands; running them here wastes a
 * plan→execute→enforce cycle.
 *
 * Tier 2 (Exploratory) exception: when `ctx.currentTaskSelfVerifyOnDone` is
 * true, the error task IS the only task in the breakdown and owns its own
 * verification inline. In that case the execute-phase block is lifted so
 * the LLM can run install/typecheck/build/test per the
 * `self-verify-inline` partial's gate chain. Install continues to pass
 * through regardless of tier (the remediation plan may legitimately add
 * dependencies in either configuration).
 *
 * R1 — the body of this hook is where task-type-specific command logic is
 * allowed to live; the common handler stays blind to `task.type`.
 */

import type { ToolExecutionContext, ToolResult } from '../../../../../../common/tool/types';
import {
  isBuildCommand,
  isTestCommand,
  isTypecheckCommand,
} from '../../../../../../common/tool/constants';
import { isDiagnosticInspectCommand } from '../../verification/model/gates';

/**
 * Policy-rejection `ToolResult`. See verification/hooks/command.ts for the
 * `[Policy]` prefix rationale: it keeps the tool_result formatter from
 * disguising an internal guard as a command execution failure.
 */
function reject(command: string, reason: string): ToolResult {
  return {
    content: `[Policy] ${reason}`,
    sideEffects: [
      { type: 'commandExecuted', exitCode: -1, command, success: false, hasWarnings: false },
    ],
  };
}

export function guard(
  ctx: ToolExecutionContext,
  args: { command: string },
): ToolResult | null {
  const { command } = args;

  // Read-only inspection commands (cat/ls/pnpm why/tsc --version/etc.) are
  // always allowed — they don't mutate state and may be needed to confirm a
  // fix location before writing it.
  if (isDiagnosticInspectCommand(command)) return null;

  // Tier 2 exception: the sole task owns inline self-verify, so
  // build/test/typecheck are expected and required here.
  if (ctx.currentTaskSelfVerifyOnDone === true) return null;

  // Execute-phase block (Tier 3/4 default): build/test/typecheck are the
  // diagnostic surface and belong to the dedicated verification task, not
  // to fix-application. The verification task re-verifies automatically
  // after the error task completes.
  if (ctx.activePhase !== 'plan') {
    if (isBuildCommand(command) || isTestCommand(command) || isTypecheckCommand(command)) {
      return reject(
        command,
        'BLOCKED: Error tasks apply fixes from the remediation plan and must not run build/test/typecheck. ' +
          'Apply the code changes and output <done>true</done> — the next verification task re-verifies automatically. ' +
          'Installing dependencies (npm/pnpm/pip/go mod) is still allowed when the remediation plan requires it.',
      );
    }
  }

  return null;
}
