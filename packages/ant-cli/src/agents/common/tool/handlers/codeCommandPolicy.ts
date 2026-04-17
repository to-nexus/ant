/**
 * CodeCommandPolicy — Code job-specific guards for run_command
 *
 * These guards are ONLY applied to Code job's tool registry.
 * Design/Plan/Ask jobs use the base executeCommand without these policies.
 *
 * Guards:
 * - Go build block in non-verification tasks
 * - Verification execute-phase guard (no build/test in execute phase)
 * - Plan-phase loop guard (no re-runs of already-attempted verifications)
 * - Bare install skip (dep-hash unchanged)
 */

import type { ToolExecutionContext, ToolResult } from '../types';
import { isBuildCommand, isTestCommand, isTypecheckCommand } from '../constants';
import { isDiagnosticInspectCommand } from './diagnosticInspect';

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
  const tracker = ctx.verificationTracker;

  // Axis G-5 — diagnostic inspect commands (cat/ls/pnpm why/tsc --version/etc.)
  // are always allowed and bypass every loop-guard below. They do not mutate
  // tracker state and are essential for config/dep-version root-cause discovery.
  if (isDiagnosticInspectCommand(command)) {
    return null;
  }

  // Go build/test/run/vet block in non-verification tasks
  const GO_BUILD_PATTERNS = /\bgo\s+(build|test|run|vet)\b/;
  const isAllowedBuildTask = taskType === 'verification' || taskType === 'error';
  if (GO_BUILD_PATTERNS.test(command) && !isAllowedBuildTask) {
    console.warn(`   ⛔ [RunCommand] Blocked Go build command in ${taskType} task: ${command}`);
    return makeRejection(command, `⛔ BLOCKED: ${command}\n\nGo build/test/run/vet commands are only allowed in verification and error tasks.\nContinue writing code files and output <done>true</done> when complete.`);
  }

  // Execute-phase guard
  const isVerificationExecute = taskType === 'verification' && ctx.activePhase !== 'plan';
  if (isVerificationExecute && tracker) {
    if (isBuildCommand(command) || isTestCommand(command) || isTypecheckCommand(command)) {
      console.warn(`   ⛔ [RunCommand] Execute guard: blocked verification command in execute phase: ${command}`);
      return makeRejection(command,
        'BLOCKED: Do not run build/test/typecheck commands during the execute phase. ' +
        'Apply the code fixes from the remediation plan and output <done>true</done>. ' +
        'The diagnostic phase will re-verify after your changes.');
    }
  }

  // Plan-phase loop guard
  if (ctx.activePhase === 'plan' && tracker) {
    const deep = ctx.isDeepDiagnostic === true;

    // Axis G-4 — in deep-diagnostic mode, only "already passed" blocks remain.
    // Re-running a failed verification with different options (e.g. tsc --noEmit --pretty,
    // tsc -p tsconfig.app.json) is explicitly allowed so the LLM can probe.
    if (isTypecheckCommand(command) && tracker.typecheckAttempted) {
      if (tracker.typecheckPassed) {
        return makeRejection(command, 'ALREADY PASSED: tsc --noEmit already succeeded in this diagnostic cycle. Proceed to the next verification step.');
      }
      if (!deep) {
        return makeRejection(command, 'BLOCKED: typecheck already failed in this diagnostic cycle. Produce the remediation plan from the existing error output.');
      }
    }

    if (isBuildCommand(command) && tracker.typecheckRequired && !tracker.typecheckAttempted) {
      return makeRejection(command, 'BLOCKED: Run tsc --noEmit first for comprehensive error discovery before the build command.');
    }

    if (isBuildCommand(command) && tracker.typecheckAttempted && !tracker.typecheckPassed && !deep) {
      return makeRejection(command,
        'BLOCKED: type check (tsc --noEmit) failed. Build embeds type checking internally and will fail with the same errors. Produce the remediation plan from tsc output.');
    }

    if (isBuildCommand(command) && tracker.buildAttempted) {
      if (tracker.buildPassed) {
        return makeRejection(command, 'ALREADY PASSED: build already succeeded in this diagnostic cycle. Proceed to the next verification step.');
      }
      if (!deep) {
        return makeRejection(command, 'BLOCKED: build already failed in this diagnostic cycle. Produce the remediation plan from the existing error output.');
      }
    }

    if (isTestCommand(command) && tracker.testAttempted) {
      if (tracker.testPassed) {
        return makeRejection(command, 'ALREADY PASSED: test already succeeded in this diagnostic cycle. Proceed to the next verification step.');
      }
      if (!deep) {
        return makeRejection(command, 'BLOCKED: test already failed in this diagnostic cycle. Produce the remediation plan from the existing error output.');
      }
    }

    // Mark as attempted (side-effect for the tracker)
    if (isTypecheckCommand(command)) tracker.typecheckAttempted = true;
    if (isBuildCommand(command)) tracker.buildAttempted = true;
    if (isTestCommand(command)) tracker.testAttempted = true;
  }

  return null;
}
