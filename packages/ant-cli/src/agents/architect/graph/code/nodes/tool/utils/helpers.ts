/**
 * Tool Helper Functions
 * 공통 헬퍼 함수들
 */

import { ArchitectGraphState } from '../../../state';
import { CommandExecutionResult } from '../types';
import { isVerificationTask } from '../../../tasks/verification';
import { isSetupTask } from '../../../tasks/setup';

/**
 * Get temp file path for buffering
 * Note: This is a pure string manipulation, no fs access
 */
export function getTempFilePath(state: ArchitectGraphState, filePath: string): string {
  const jobId = state._httpJobId || 'unknown';
  const safeFilePath = filePath.replace(/\//g, '_');
  return `/tmp/ant-buffer-${jobId}-${safeFilePath}`;
}

/**
 * Build task reminder text for tool call loops.
 * Appended to every tool result message so the LLM keeps task identity
 * in its recency window. Full task context is already in messages[0]
 * (Block 3 / buildRuntimeContext), so this is intentionally minimal
 * to reduce per-turn token accumulation in conversation history.
 */
export function buildTaskReminder(state: ArchitectGraphState): string {
  if (!state.currentTask) return '';

  const doneInstruction = isVerificationTask(state.currentTask)
    ? 'Output <done>true</done> ONLY after build (and tests if any) pass with exit code 0.'
    : 'When all work is complete, output <done>true</done>.';
  let taskReminder = `\n\nTask: **${state.currentTask.name}** (${state.currentTask.type})` +
    ` — ${doneInstruction}` +
    ` Files marked [file written to disk: ...] are already saved — do NOT regenerate.`;

  if (isSetupTask(state.currentTask)) {
    taskReminder += `\n**SETUP:** Generate config files, run install if rules permit, then <done>true</done>. No mkdir.`;
  }

  return taskReminder;
}

/**
 * Update command history and detect repetition
 */
export function updateCommandHistory(
  state: ArchitectGraphState,
  commandExecuted: CommandExecutionResult,
  error?: string,
  result?: any
): { shouldWarn: boolean; warningMessage?: string } {
  state.commandHistory = state.commandHistory || [];
  
  const historyEntry = {
    command: commandExecuted.command,
    timestamp: Date.now(),
    success: commandExecuted.success,
    exitCode: commandExecuted.exitCode,
    errorSnippet: commandExecuted.success ? undefined : (error || result || '').toString().slice(0, 3000)
  };
  
  state.commandHistory.push(historyEntry);
  
  // ✅ Detect repetition (same command, same failure, within 5 minutes)
  const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
  const recentSimilarFailures = state.commandHistory.filter(h => 
    h.command === commandExecuted.command &&
    !h.success &&
    h.timestamp > fiveMinutesAgo
  );
  
  if (recentSimilarFailures.length >= 3) {
    console.warn(`\n⚠️  [Tool] PATTERN DETECTED: Command "${commandExecuted.command}" failed ${recentSimilarFailures.length} times in 5 minutes`);
    console.warn(`   This indicates a systemic issue that won't be resolved by retrying the same command.\n`);
    
    const warningMessage = `\n\n🚨 LOOP DETECTION WARNING:
This command has failed ${recentSimilarFailures.length} times in the last 5 minutes with similar errors.

Repeating the same command will NOT fix the issue. You need to:
1. Investigate the ROOT CAUSE (not just the symptom)
2. Check environment setup (dependencies, configuration, permissions)
3. Try a DIFFERENT approach or ask for human help

DO NOT run "${commandExecuted.command}" again without changing something fundamental.`;
    
    return { shouldWarn: true, warningMessage };
  }

  return { shouldWarn: false };
}

