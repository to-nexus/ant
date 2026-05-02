/**
 * CodeCommandPolicy — Code job-specific guards for run_command
 *
 * Only applied to Code job's tool registry. Design/Plan/Ask jobs use the
 * base executeCommand without these policies.
 *
 * R1 — task-type-blind body. Guard logic lives in
 * `tasks/{type}/hooks/command.ts` and is dispatched via the shared
 * registry. Only cross-task concerns (Go build block outside
 * verification responsibility) remain inline.
 */

import type { ToolExecutionContext, ToolResult } from '../types';
import type { TaskType } from '@ant/shared';
import { hooksForTaskType } from '../../../architect/graph/code/tasks/_shared/registry';

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
  args: { command: string; verifies?: string },
): ToolResult | null {
  const { command } = args;
  const taskType = ctx.currentTaskType;

  // Go build/test/run/vet block. Verification responsibility holders run
  // these as part of their verify cycle (`ctx.verifyModeActive === true`).
  // Apply-phase callers (Tier 2 self-verify before reverify, Tier 3/4
  // error/feature/ui/setup) never run Go build gates directly — they apply
  // fixes and defer verification to the dedicated cycle.
  const GO_BUILD_PATTERNS = /\bgo\s+(build|test|run|vet)\b/;
  const allowedByVerifyMode = ctx.verifyModeActive === true;
  if (GO_BUILD_PATTERNS.test(command) && !allowedByVerifyMode) {
    console.warn(`   ⛔ [RunCommand] Blocked Go build command in ${taskType} task: ${command}`);
    return makeRejection(
      command,
      `⛔ BLOCKED: ${command}\n\nGo build/test/run/vet commands are allowed only during a verification cycle (verification task, or self-verify task in reverify phase). For apply-phase fixes, the following verification cycle owns build/test — it re-verifies automatically after your fix lands.\nContinue writing code files and output <done>true</done> when complete.`,
    );
  }

  // Task-type-specific guards.
  return hooksForTaskType(taskType as TaskType | undefined)?.command?.guard(ctx, args as any) ?? null;
}
