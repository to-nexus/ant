/**
 * verification/hooks/command.ts — TaskCommandHook.guard
 *
 * Verification-specific loop guard for `run_command`. Mirrors the inline
 * guard currently in `common/tool/handlers/codeCommandPolicy.ts`
 * (the block fenced by `if (taskType === 'verification' ...)` plus its
 * execute-phase and plan-phase sub-guards). T6 migration deletes that inline
 * block and delegates to this hook.
 *
 * During T5 coexistence, this hook is unreferenced by the phase layer — it
 * exists so unit tests can lock the contract and so T6 can flip a single
 * line in `applyCodeCommandPolicy`. The legacy `ctx.verificationTracker`
 * is the authoritative input surface until T8 removes it; once the session
 * replaces the tracker in `ToolExecutionContext`, this hook will be rewritten
 * to consume `ctx.verification` instead.
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

function reject(command: string, reason: string): ToolResult {
  return {
    content: reason,
    error: reason,
    sideEffects: [
      { type: 'commandExecuted', exitCode: -1, command, success: false, hasWarnings: false },
    ],
  };
}

/**
 * Verification guard. Returns a rejection `ToolResult` when the command
 * should be blocked, or `null` to let the command proceed. The `null` path
 * lets `applyCodeCommandPolicy` fall through to its default execution path
 * after T6.
 */
export function guard(
  ctx: ToolExecutionContext,
  args: { command: string },
): ToolResult | null {
  const { command } = args;

  // Read-only inspection commands bypass every loop guard — already-passed
  // gates or exhausted attempts should not block a `cat`/`ls`/`pnpm why`.
  if (isDiagnosticInspectCommand(command)) return null;

  const tracker = ctx.verificationTracker;
  const deep = ctx.isDeepDiagnostic === true;

  // Execute-phase guard: verification tasks must not re-run build/test/
  // typecheck while in the execute phase. The plan phase is the sole owner
  // of diagnostic-gate commands for a verification task.
  if (ctx.activePhase !== 'plan' && tracker) {
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

  // Plan-phase loop guard — requires the tracker to reason about cached
  // pass state and in-cycle attempts.
  if (ctx.activePhase !== 'plan' || !tracker) return null;

  // Already-passed guard — independent of deep-mode so cache preservation
  // works across retry/reverify boundaries.
  if (isTypecheckCommand(command) && tracker.typecheckPassed) {
    return reject(
      command,
      'ALREADY PASSED: tsc --noEmit succeeded earlier in this task and the affected scope has not been invalidated. Proceed to the next verification step.',
    );
  }
  if (isBuildCommand(command) && tracker.buildPassed) {
    return reject(
      command,
      'ALREADY PASSED: build succeeded earlier in this task and the affected scope has not been invalidated. Proceed to the next verification step.',
    );
  }
  if (isTestCommand(command) && tracker.testPassed) {
    return reject(
      command,
      'ALREADY PASSED: tests succeeded earlier in this task and the affected scope has not been invalidated. Proceed to the next verification step.',
    );
  }

  // Failed-in-this-cycle guard — relaxed in deep-diagnostic mode so the LLM
  // can probe config / dependency variants.
  if (isTypecheckCommand(command) && tracker.typecheckAttempted && !deep) {
    return reject(
      command,
      'BLOCKED: typecheck already failed in this diagnostic cycle. Produce the remediation plan from the existing error output.',
    );
  }

  if (isBuildCommand(command) && tracker.typecheckRequired && !tracker.typecheckAttempted) {
    return reject(
      command,
      'BLOCKED: Run tsc --noEmit first for comprehensive error discovery before the build command.',
    );
  }

  if (
    isBuildCommand(command) &&
    tracker.typecheckAttempted &&
    !tracker.typecheckPassed &&
    !deep
  ) {
    return reject(
      command,
      'BLOCKED: type check (tsc --noEmit) failed. Build embeds type checking internally and will fail with the same errors. Produce the remediation plan from tsc output.',
    );
  }

  if (isBuildCommand(command) && tracker.buildAttempted && !deep) {
    return reject(
      command,
      'BLOCKED: build already failed in this diagnostic cycle. Produce the remediation plan from the existing error output.',
    );
  }

  // 3-gate ordering: tests require a passing build.
  if (isTestCommand(command) && !tracker.buildPassed && !deep) {
    return reject(
      command,
      'BLOCKED: run the build command and confirm it passes before running tests. Tests against an unbuilt project waste a diagnostic cycle.',
    );
  }

  if (isTestCommand(command) && tracker.testAttempted && !deep) {
    return reject(
      command,
      'BLOCKED: test already failed in this diagnostic cycle. Produce the remediation plan from the existing error output.',
    );
  }

  // Mark the gate as attempted — mirrors the legacy mutation so T6 can
  // flip the delegation without regressing the loop-guard's memory.
  if (isTypecheckCommand(command)) tracker.typecheckAttempted = true;
  if (isBuildCommand(command)) tracker.buildAttempted = true;
  if (isTestCommand(command)) tracker.testAttempted = true;

  return null;
}
