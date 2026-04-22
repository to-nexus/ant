/**
 * verification/hooks/command.ts — TaskCommandHook.guard
 *
 * Verification-specific loop guard for `run_command`. Delegated from
 * `common/tool/handlers/codeCommandPolicy.ts`: the common handler stays
 * blind to `task.type` and forwards the call to this hook via
 * `hooksForTaskType('verification')?.command?.guard(ctx, args)`.
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
import { isDiagnosticInspectCommand } from '../model/gates';

/**
 * Policy-rejection `ToolResult`. The `[Policy]` prefix signals to the LLM
 * that this is an internal guard (not a command execution failure), so the
 * `messageBuilder` tool_result formatter leaves it untouched instead of
 * prepending `Error:` (which would happen if the `error` field were set).
 * Dropping `error` is the SSOT fix: policy rejection ≠ execution failure.
 */
function reject(command: string, reason: string): ToolResult {
  return {
    content: `[Policy] ${reason}`,
    sideEffects: [
      { type: 'commandExecuted', exitCode: -1, command, success: false, hasWarnings: false },
    ],
  };
}

/**
 * Verification guard. Returns a rejection `ToolResult` when the command
 * should be blocked, or `null` to let the command proceed. The `null` path
 * lets `applyCodeCommandPolicy` fall through to its default execution path.
 */
export function guard(
  ctx: ToolExecutionContext,
  args: { command: string },
): ToolResult | null {
  const { command } = args;

  // Read-only inspection commands bypass every loop guard — already-passed
  // gates or exhausted attempts should not block a `cat`/`ls`/`pnpm why`.
  if (isDiagnosticInspectCommand(command)) return null;

  const session = ctx.verificationSession;
  const deep = ctx.isDeepDiagnostic === true;

  // Execute-phase guard: verification tasks must not re-run build/test/
  // typecheck while in the execute phase. The plan phase is the sole owner
  // of diagnostic-gate commands for a verification task.
  if (ctx.activePhase !== 'plan' && session) {
    if (isBuildCommand(command) || isTestCommand(command) || isTypecheckCommand(command)) {
      return reject(
        command,
        'BLOCKED: Do not run build/test/typecheck commands during the execute phase. ' +
          'Apply the code fixes from the remediation plan and output <done>true</done>. ' +
          'The diagnostic phase will re-verify after your changes.',
      );
    }
    return null;
  }

  // Plan-phase loop guard — all decisions derive from `passed` + `required`.
  // Per-cycle "attempted" tracking was retired (see postmortem on
  // `attemptedThisCycle`): every legitimate guard reduces to a query on
  // observable gate state, and the retired marker was the direct cause of
  // the `fatal-ironing-judge` regression (batch-split carry-over blocked
  // the post-error-fix typecheck).
  if (ctx.activePhase !== 'plan' || !session) return null;

  const passed = new Set(session.passed());
  const required = new Set(session.required());

  // Already-passed guard — authoritative across retry / reverify /
  // batch-split boundaries because `passed` is invalidated only by an
  // actual source-file change via `onFileChanged`.
  if (isTypecheckCommand(command) && passed.has('typecheck')) {
    return reject(
      command,
      'ALREADY PASSED: tsc --noEmit succeeded earlier in this task and the affected scope has not been invalidated. Proceed to the next verification step.',
    );
  }
  if (isBuildCommand(command) && passed.has('build')) {
    return reject(
      command,
      'ALREADY PASSED: build succeeded earlier in this task and the affected scope has not been invalidated. Proceed to the next verification step.',
    );
  }
  if (isTestCommand(command) && passed.has('test')) {
    return reject(
      command,
      'ALREADY PASSED: tests succeeded earlier in this task and the affected scope has not been invalidated. Proceed to the next verification step.',
    );
  }

  // Gate-ordering guards — deep-diagnostic mode bypasses the ordering so
  // the LLM can probe config / dependency variants. Within normal mode
  // the project's declared-gate order (typecheck → build → test) is
  // enforced via `passed` alone.
  if (isBuildCommand(command) && required.has('typecheck') && !passed.has('typecheck') && !deep) {
    return reject(
      command,
      'BLOCKED: Run tsc --noEmit first and confirm it passes. Build embeds type checking, so running it before typecheck passes produces duplicate noise.',
    );
  }

  if (isTestCommand(command) && !passed.has('build') && !deep) {
    return reject(
      command,
      'BLOCKED: run the build command and confirm it passes before running tests. Tests against an unbuilt project waste a diagnostic cycle.',
    );
  }

  // Re-run discipline lives in the prompt (`Gate Re-run Principle` in
  // `plan/variants/verification/rules.md`), bounded by
  // `PLAN_TOOL_LOOP_MAX`. No per-cycle attempt counter here.
  return null;
}
