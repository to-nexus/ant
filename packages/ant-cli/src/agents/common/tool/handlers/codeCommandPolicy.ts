/**
 * CodeCommandPolicy — Code job-specific guards for run_command
 *
 * These guards are ONLY applied to Code job's tool registry.
 * Design/Plan/Ask jobs use the base executeCommand without these policies.
 *
 * After T6 the body is task-type-blind (R1): guard logic lives in
 * `tasks/{type}/hooks/command.ts` and is dispatched via the shared
 * registry. Only cross-task concerns (Go build block outside
 * verification, diagnostic-inspect bypass) remain inline.
 */

import type { ToolExecutionContext, ToolResult } from '../types';
import type { TaskType } from '@ant/shared';
import { isDiagnosticInspectCommand } from '../../../architect/graph/code/tasks/verification/model/gates';
import { hooksForTaskType } from '../../../architect/graph/code/tasks/_shared/registry';
import { isVerificationTask } from '../../../architect/graph/code/tasks/verification';

export interface CodeCommandPolicyResult {
  rejected: boolean;
  reason?: string;
}

/**
 * Policy-rejection `ToolResult`. Policy-level Go allow-list rejection is
 * NOT a command execution failure — the content is tagged with `[Policy]`
 * so the tool_result formatter doesn't prepend `Error:` (which would make
 * the LLM mis-handle it as a real build failure). Aligned with
 * `common/tool/handlers/runCommand.ts::makeRejection` and the task-hook
 * reject()s in verification/error.
 */
function makeRejection(command: string, reason: string): ToolResult {
  return {
    content: `[Policy] ${reason}`,
    sideEffects: [{ type: 'commandExecuted', exitCode: -1, command, success: false, hasWarnings: false }],
  };
}

/**
 * Apply Code-specific policy guards before executing a command.
 * Returns a ToolResult if the command is rejected, or null if it should proceed.
 */
export function applyCodeCommandPolicy(
  ctx: ToolExecutionContext,
  args: { command: string },
): ToolResult | null {
  const { command } = args;
  const taskType = ctx.currentTaskType;

  // Diagnostic inspect commands (cat/ls/pnpm why/tsc --version/etc.) are
  // always allowed and bypass every loop-guard below. They do not mutate
  // tracker state and are essential for config/dep-version root-cause discovery.
  // Allow-list lives in tasks/verification/model/gates.ts.
  if (isDiagnosticInspectCommand(command)) {
    return null;
  }

  // Go build/test/run/vet block. Only verification may run these (in the
  // plan phase, where tool-loop diagnoses build errors). Error tasks apply
  // fixes from a remediation plan and MUST NOT re-run build/test — the
  // diagnostic cycle re-verifies after their changes land. Feature / setup
  // / ui / doc / test-code tasks have no legitimate reason to invoke the
  // Go toolchain either. The per-task `command.guard` hook further narrows
  // (verification enforces gate ordering; error blocks all of
  // build/test/typecheck in the execute phase).
  const GO_BUILD_PATTERNS = /\bgo\s+(build|test|run|vet)\b/;
  if (GO_BUILD_PATTERNS.test(command) && !isVerificationTask({ type: taskType })) {
    console.warn(`   ⛔ [RunCommand] Blocked Go build command in ${taskType} task: ${command}`);
    return makeRejection(
      command,
      `⛔ BLOCKED: ${command}\n\nGo build/test/run/vet commands are only allowed in verification tasks (plan phase). Error tasks apply fixes from the remediation plan — the next diagnostic cycle re-verifies automatically.\nContinue writing code files and output <done>true</done> when complete.`,
    );
  }

  // Task-type-specific guards (verification loop/order gating lives here).
  // Phase layer is blind — dispatch via the shared registry (R1).
  return hooksForTaskType(taskType as TaskType | undefined)?.command?.guard(ctx, args) ?? null;
}
