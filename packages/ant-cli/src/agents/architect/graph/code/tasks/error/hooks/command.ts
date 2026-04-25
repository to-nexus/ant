/**
 * error/hooks/command.ts — TaskCommandHook.guard (apply-phase)
 *
 * Error tasks apply fixes from an upstream remediation plan (batch-split
 * output carried on `prePlanText`, or a freshly-generated plan in the rare
 * no-prePlanText path).
 *
 * Apply-phase semantics: error tasks do NOT run build/test/typecheck. The
 * verification responsibility belongs to a separate cycle:
 *
 *   - Tier 3/4: a dedicated verification task follows in the queue.
 *   - Tier 2 self-verify: this same task transitions into verify-mode
 *     after applying fixes (executeRouter routes `<done>` → plan reverify
 *     → initSession → markVerifyEntered → `_shared/verify/commandGuard`
 *     takes over from there). The dispatch happens at composeBundle —
 *     this guard fires only in apply-phase when `ctx.verificationSession
 *     === undefined`.
 *
 * Install commands (npm/pnpm/pip/go mod) pass through regardless because
 * the remediation plan may legitimately add dependencies in any tier.
 *
 * R1 — task-type-specific command logic lives here; the common handler
 *      stays blind to `task.type`.
 *
 * Why no `selfVerifyOnDone` exception any more: previously this hook
 * allowed gate commands when `selfVerifyOnDone === true` so the Tier 2
 * task could "self-verify inline" in one cycle. The runtime relied
 * entirely on the LLM's prompt compliance — no Session, no gate
 * tracking, no enforcement. The two-cycle design (apply→reverify)
 * replaces that with code-level enforcement: apply-phase blocks gate
 * commands, verify-phase runs them through `_shared/verify/`. The
 * `selfVerifyOnDone` flag survives at decompose time as the Tier 2
 * marker, but command-guard semantics are now uniform across tiers.
 */

import type { ToolExecutionContext, ToolResult } from '../../../../../../common/tool/types';
import type { Gate } from '../../_shared/verify/gates';
import { isDiagnosticInspectCommand } from '../../_shared/verify/gates';

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
  args: { command: string; verifies?: Gate },
): ToolResult | null {
  const { command, verifies } = args;

  // Read-only inspection commands (cat/ls/pnpm why/tsc --version/etc.) are
  // always allowed — they don't mutate state and may be needed to confirm a
  // fix location before writing it.
  if (isDiagnosticInspectCommand(command)) return null;

  // Apply-phase block (uniform across tiers): build/test/typecheck are the
  // diagnostic surface and belong to the verification cycle (Tier 3/4
  // dedicated verification task; Tier 2 self-verify reverify phase via
  // `_shared/verify/commandGuard`). Gate identity is the LLM's `verifies`
  // declaration on the `run_command` call — the previous regex-based
  // command-string inference was retired (see
  // `docs/tmp/gate-classification-postmortem.md`).
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
