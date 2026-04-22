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
 *
 * Phase-agnostic invariants:
 *   - `already-passed`  — a gate already green in the current Session is
 *     never re-run (applies to both plan-phase and execute-phase callers).
 *   - `ordering`        — typecheck must pass before build; build must
 *     pass before test (bypassed in deep-diagnostic mode only).
 *
 * Execute-phase is now allowed to run `tsc / build / test` directly. The
 * previous blanket rejection ("Do not run build/test/typecheck during
 * execute") was removed alongside the verification-loop postmortem: the
 * LLM can and should validate its own fix in one execute pass when the
 * plan phase already ran the diagnostic cycle. `routeAfterDone` picks
 * `checkTaskStatus` (instead of `plan`/reverify) the moment
 * `session.isComplete()` flips true, so a self-validated execute ends
 * the task in a single cycle.
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
  if (!session) return null;

  const deep = ctx.isDeepDiagnostic === true;
  const passed = new Set(session.passed());
  const required = new Set(session.required());

  // Already-passed guard — authoritative across retry / reverify /
  // batch-split boundaries because `passed` is invalidated only by an
  // actual source-file change via `onFileChanged`. Applies to both plan
  // and execute phases (an execute-phase self-validation should not
  // re-run a gate that just passed).
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
  // enforced via `passed` alone. Applies to both plan and execute phases.
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
