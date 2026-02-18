/**
 * Tool Helper Functions
 * 공통 헬퍼 함수들
 */

import { ArchitectGraphState } from '../../../state';
import { CommandExecutionResult } from '../types';

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
 * Appended to every tool result message so budget awareness stays
 * in the LLM's recency window (not only in messages[0]).
 */
export function buildTaskReminder(state: ArchitectGraphState): string {
  if (!state.currentTask) return '';

  let taskReminder = `\n\n# Current Task Reminder\n` +
    `**${state.currentTask.name}** (${state.currentTask.type})\n\n` +
    `${state.currentTask.description}`;
  
  if (state.currentTask.type === 'setup') {
    taskReminder += `\n\n⚠️  **SETUP TASK - MANDATORY STEPS:**\n` +
      `1. ✅ Generate ALL config files (package.json, tsconfig.json, etc.)\n` +
      `2. ⚠️  **RUN: npm install** (or pnpm/yarn install)\n` +
      `3. ✅ Output: <done>true</done>\n\n` +
      `🚫 DO NOT create directories (mkdir) - folders are created automatically when files are added!\n` +
      `🚫 If you skip "npm install", setup FAILS!\n` +
      `✅ After "npm install" completes, output <done>true</done>`;
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
    errorSnippet: commandExecuted.success ? undefined : (error || result || '').toString().slice(0, 200)
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

/**
 * Check if command is attempting to kill orchestrator port
 */
export function checkOrchestratorPortSafeguard(command: string, orchestratorPort: string): void {
  const killPortPattern = /lsof\s+-ti:(\d+)/;
  const match = command.match(killPortPattern);
  
  if (match) {
    const targetPort = match[1];
    if (targetPort === orchestratorPort) {
      const errorMsg = `🚨 BLOCKED: Cannot kill port ${orchestratorPort} (Ant orchestrator)

Killing this port crashes the entire Ant system.

CORRECT approach to restart YOUR server:

1. Just run your server (don't kill preemptively)

2. If EADDRINUSE error:
   run_command("pwd")  → Get YOUR project path
   run_command("ps aux | grep '<project-name>'")  → Find YOUR process

3. Kill by YOUR project path (NOT port number):
   run_command("pkill -f '<workspaces-path>/<project>'")
   
   ✅ Matches YOUR project path: /workspaces/.../project-name/
   ❌ NEVER match: /ant/packages/ant-cli/ (orchestrator)

4. Retry starting server

Rule: Identify processes by PATH, not port numbers.
Port ${orchestratorPort} is the orchestrator. Any process in /ant/packages/ant-cli/ is orchestrator.`;
      
      console.error(`\n❌ [SAFEGUARD] ${errorMsg}\n`);
      throw new Error(errorMsg);
    }
  }
}

