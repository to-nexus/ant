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

  // Go build/test/run/vet block. Verification tasks run these in the plan
  // phase (where the tool-loop diagnoses build errors), AND Tier 2 tasks
  // flagged `selfVerifyOnDone: true` run these in the execute phase as their
  // inline verification gates. Every other task type has no legitimate
  // reason to invoke the Go toolchain — error tasks defer to the following
  // verification task (Tier 3/4) or to their own self-verify loop (Tier 2),
  // and feature / setup / ui / doc / test-code tasks never run build gates
  // directly. The per-task `command.guard` hook further narrows behaviour
  // for each task type.
  const GO_BUILD_PATTERNS = /\bgo\s+(build|test|run|vet)\b/;
  const allowedByVerificationTask = isVerificationTask({ type: taskType });
  const allowedBySelfVerifyFlag = ctx.currentTaskSelfVerifyOnDone === true;
  if (GO_BUILD_PATTERNS.test(command) && !allowedByVerificationTask && !allowedBySelfVerifyFlag) {
    console.warn(`   ⛔ [RunCommand] Blocked Go build command in ${taskType} task: ${command}`);
    return makeRejection(
      command,
      `⛔ BLOCKED: ${command}\n\nGo build/test/run/vet commands are allowed only in verification tasks or Tier 2 single-tasks flagged with selfVerifyOnDone. For Tier 3+ error/feature tasks, the following verification task owns build/test — the diagnostic cycle re-verifies automatically after your fix lands.\nContinue writing code files and output <done>true</done> when complete.`,
    );
  }

  // Task-type-specific guards (verification loop/order gating lives here).
  // Phase layer is blind — dispatch via the shared registry (R1).
  return hooksForTaskType(taskType as TaskType | undefined)?.command?.guard(ctx, args) ?? null;
}
