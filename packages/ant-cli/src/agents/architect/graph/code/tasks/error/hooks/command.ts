/**
 * error/hooks/command.ts — TaskCommandHook.guard
 *
 * Error tasks apply fixes from an upstream remediation plan (batch-split
 * output carried on `prePlanText`, or a freshly-generated plan in the rare
 * no-prePlanText path). They are NOT diagnostic tasks: they do not discover
 * errors, they do not gate build/test/typecheck, and they do not own a
 * `VerificationSession`.
 *
 * Rule (confirmed with product owner): error tasks modify code and may
 * install dependencies when the remediation plan requires it, but they
 * must NEVER run build / test / typecheck themselves. The next scheduled
 * verification cycle re-runs those gates after the fix lands. Running
 * build here would waste a plan→execute→enforce cycle and, for Go projects,
 * was the specific path that made the legacy `isDiagnosticTask` conflation
 * unsafe (the codeCommandPolicy Go allow-list silently included error
 * tasks).
 *
 * The guard mirrors verification's execute-phase guard minus the session
 * dependency. Plan-phase commands pass through (rare, but the no-prePlanText
 * path still needs inspection to build its plan).
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

  // Execute-phase block: build/test/typecheck are the diagnostic surface and
  // belong to verification, not to fix-application. The diagnostic cycle
  // re-verifies automatically after the error task finishes.
  if (ctx.activePhase !== 'plan') {
    if (isBuildCommand(command) || isTestCommand(command) || isTypecheckCommand(command)) {
      return reject(
        command,
        'BLOCKED: Error tasks apply fixes from the remediation plan and must not run build/test/typecheck. ' +
          'Apply the code changes and output <done>true</done> — the next diagnostic cycle re-verifies automatically. ' +
          'Installing dependencies (npm/pnpm/pip/go mod) is still allowed when the remediation plan requires it.',
      );
    }
  }

  return null;
}
