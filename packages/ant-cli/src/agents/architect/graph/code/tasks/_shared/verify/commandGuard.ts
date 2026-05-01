/**
 * `_shared/verify/commandGuard` — TaskCommandHook.guard for verify-mode.
 *
 * SSOT: previously `tasks/verification/hooks/command.ts::guard`. Moved
 * here so self-verify Tier 2 tasks share the same gate-ordering and
 * already-passed semantics as Tier 3/4 verification tasks once they
 * enter verify-mode.
 *
 * Phase-agnostic invariants enforced here:
 *   - `already-passed` — a gate already green in the current Session is
 *     never re-run.
 *   - `ordering`       — typecheck must pass before build; build must
 *     pass before test (bypassed in deep-diagnostic mode only).
 *
 * Execute-phase is allowed to run `tsc / build / test` directly. The
 * blanket "Do not run build/test/typecheck during execute" rejection was
 * removed alongside the verification-loop postmortem: the LLM can and
 * should validate its own fix in one execute pass when the plan phase
 * already ran the diagnostic cycle. `routeAfterDone` picks
 * `checkTaskStatus` (instead of `plan`/reverify) the moment
 * `session.isComplete()` flips true, so a self-validated execute ends
 * the task in a single cycle.
 *
 * R1 — phase-blind dispatch. The common handler delegates to this guard
 * via `composeBundle` when `requiresVerification(task) &&
 * state._verifyEntered === true`.
 */

import type { ToolExecutionContext, ToolResult } from '../../../../../../common/tool/types';
import type { Gate } from './gates';
import { isDiagnosticInspectCommand } from './gates';

/**
 * Policy-rejection `ToolResult`. The `[Policy]` prefix signals to the LLM
 * that this is an internal guard (not a command execution failure), so the
 * `messageBuilder` tool_result formatter leaves it untouched instead of
 * prepending `Error:` (which would happen if the `error` field were set).
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
 * Verify-mode guard. Returns a rejection `ToolResult` when the command
 * should be blocked, or `null` to let the command proceed. The `null`
 * path lets `applyCodeCommandPolicy` fall through to its default
 * execution path.
 */
export function guard(
  ctx: ToolExecutionContext,
  args: { command: string; verifies?: Gate },
): ToolResult | null {
  const { command, verifies } = args;

  // Read-only inspection commands bypass every loop guard — already-passed
  // gates or exhausted attempts should not block a `cat`/`ls`/`pnpm why`.
  if (isDiagnosticInspectCommand(command)) return null;

  const session = ctx.verificationSession;
  if (!session) return null;

  // Non-gate commands (`verifies` omitted) carry no gate semantics — let
  // them through. Gate identity is the LLM's declared `verifies` value;
  // the previous regex-based command-string inference was retired (see
  // `docs/tmp/gate-classification-postmortem.md`).
  if (!verifies) return null;

  const deep = ctx.isDeepDiagnostic === true;
  const passed = new Set(session.passed());
  const required = new Set(session.required());

  // Already-passed guard — authoritative across retry / reverify /
  // batch-split boundaries because `passed` is invalidated only by an
  // actual source-file change via `onFileChanged`. Applies to both plan
  // and execute phases (an execute-phase self-validation should not
  // re-run a gate that just passed).
  if (passed.has(verifies)) {
    const noun = verifies === 'typecheck' ? 'tsc --noEmit' : verifies === 'build' ? 'build' : 'tests';
    const missing = session.missing();
    const nextHint = missing.length === 0
      ? 'All required gates have passed — emit `<done>true</done>` to finish.'
      : `Next required gate: ${missing[0]}. Run the corresponding command, or emit \`<done>true</done>\` if every gate is already green.`;
    return reject(
      command,
      `ALREADY PASSED: ${noun} succeeded earlier in this task and the affected scope has not been invalidated. ${nextHint}`,
    );
  }

  // Gate-ordering guards — deep-diagnostic mode bypasses the ordering so
  // the LLM can probe config / dependency variants. Within normal mode
  // the project's declared-gate order (typecheck → build → test) is
  // enforced via `passed` alone. Applies to both plan and execute phases.
  const passedList = session.passed().join(', ') || 'none';

  if (verifies === 'build' && required.has('typecheck') && !passed.has('typecheck') && !deep) {
    return reject(
      command,
      `BLOCKED: typecheck must pass before build (already-passed: ${passedList}). Run tsc --noEmit first.`,
    );
  }

  if (verifies === 'test' && !passed.has('build') && !deep) {
    return reject(
      command,
      `BLOCKED: build must pass before tests (already-passed: ${passedList}). Run the build command first.`,
    );
  }

  return null;
}
