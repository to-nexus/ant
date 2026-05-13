/**
 * error/hooks/command.ts — TaskCommandHook.guard
 *
 * Error tasks apply fixes from an upstream remediation plan (batch-split
 * output carried on `prePlanText`, or a freshly-generated plan in the rare
 * no-prePlanText path).
 *
 * **Apply-phase semantics:** error tasks do NOT run build/test/typecheck.
 * Diagnostics belong to a separate verification cycle:
 *
 *   - Tier 3/4: a dedicated verification task follows in the queue. That
 *     task does not compose error's apply hooks, so this guard never fires
 *     there.
 *   - Tier 2 self-verify: this same task transitions into verify-mode
 *     after applying fixes (`resolvePlanEntry → handleReverifyEntry` flips
 *     `_verifyEntered`; `nodes/tool/index.ts` propagates it as
 *     `ctx.verifyModeActive`). From that point the guard short-circuits
 *     on its first line — verify-mode is the gate cycle, so build/test/
 *     typecheck calls become exactly what the LLM is supposed to run
 *     (`_shared/verify/hooks/executeHook` + `variants/verification/{base,
 *     rules}.md`).
 *
 * The legacy `_shared/verify/commandGuard` that an older docstring claimed
 * "took over" in verify-mode was retired in the `vast-curling-perch`
 * cleanup; no replacement was created because verify-mode's whole purpose
 * is to run gate commands. The apply guard self-disabling on the first
 * line replaces that retired surface (civil-flying-golem regression RCA).
 *
 * Install commands (npm/pnpm/pip/go mod) pass through regardless because
 * the remediation plan may legitimately add dependencies in any tier.
 *
 * R1 — task-type-specific command logic lives here; the common handler
 *      stays blind to `task.type`. Reading `ctx.verifyModeActive` does NOT
 *      violate R1: the same flag is already read by the Go-build gate at
 *      `agents/common/tool/handlers/codeCommandPolicy.ts` — it is the
 *      command-policy layer's public phase signal, not an internal
 *      verify-mode channel.
 */

import type { ToolExecutionContext, ToolResult } from '../../../../../../common/tool/types';

/**
 * Policy-rejection `ToolResult`. See `_shared/verify/commandGuard.ts` for
 * the `[Policy]` prefix rationale: it keeps the tool_result formatter
 * from disguising an internal guard as a command execution failure.
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
  args: { command: string; verifies?: string },
): ToolResult | null {
  // Verify-mode bypass — once the task crosses into its verify cycle
  // (`_verifyEntered === true` → tool node sets `verifyModeActive: true`),
  // `_shared/verify/hooks/executeHook` + `variants/verification/{base,
  // rules}.md` direct the LLM to self-validate with tsc/build/test. The
  // apply-phase block below would silently reject those calls, leaving the
  // verify cycle stuck (civil-flying-golem regression). The Go-build gate
  // at `agents/common/tool/handlers/codeCommandPolicy.ts` follows the same
  // pattern.
  if (ctx.verifyModeActive === true) return null;

  const { command, verifies } = args;

  // Apply-phase block (uniform across tiers): build/test/typecheck are the
  // diagnostic surface and belong to the verification cycle. Gate identity
  // is the LLM's `verifies` declaration on the `run_command` call.
  if (ctx.activePhase !== 'plan') {
    if (verifies) {
      return reject(
        command,
        'BLOCKED: Error tasks apply fixes from the remediation plan and must not run build/test/typecheck. ' +
          'Apply the code changes and output <done>true</done> — the verification cycle re-verifies automatically. ' +
          'Installing dependencies (npm/pnpm/pip/go mod) is still allowed when the remediation plan requires it.',
      );
    }
  }

  return null;
}
