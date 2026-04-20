/**
 * CodeCommandPolicy — Code job-specific guards for run_command
 *
 * These guards are ONLY applied to Code job's tool registry.
 * Design/Plan/Ask jobs use the base executeCommand without these policies.
 *
 * After T6 the body is task-type-blind (R1): guard logic lives in
 * `tasks/{type}/hooks/command.ts` and is dispatched via the shared
 * registry. Only cross-task concerns (Go build block outside
 * verification/error, diagnostic-inspect bypass) remain inline.
 */

import type { ToolExecutionContext, ToolResult } from '../types';
import type { TaskType } from '@ant/shared';
import { isDiagnosticInspectCommand } from '../../../architect/graph/code/tasks/verification/model/gates';
import { hooksForTaskType } from '../../../architect/graph/code/tasks/_shared/registry';
import { isDiagnosticTask } from '../../../architect/graph/code/tasks/_shared/classification';

export interface CodeCommandPolicyResult {
  rejected: boolean;
  reason?: string;
}

function makeRejection(command: string, reason: string): ToolResult {
  return {
    content: reason,
    error: reason,
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

  // Go build/test/run/vet block in non-diagnostic tasks. This cross-cuts
  // verification + error tasks (both are allowed) — the predicate is
  // captured in `isDiagnosticTask` (tasks/_shared/classification.ts).
  const GO_BUILD_PATTERNS = /\bgo\s+(build|test|run|vet)\b/;
  if (GO_BUILD_PATTERNS.test(command) && !isDiagnosticTask({ type: taskType })) {
    console.warn(`   ⛔ [RunCommand] Blocked Go build command in ${taskType} task: ${command}`);
    return makeRejection(
      command,
      `⛔ BLOCKED: ${command}\n\nGo build/test/run/vet commands are only allowed in verification and error tasks.\nContinue writing code files and output <done>true</done> when complete.`,
    );
  }

  // Task-type-specific guards (verification loop/order gating lives here).
  // Phase layer is blind — dispatch via the shared registry (R1).
  return hooksForTaskType(taskType as TaskType | undefined)?.command?.guard(ctx, args) ?? null;
}
