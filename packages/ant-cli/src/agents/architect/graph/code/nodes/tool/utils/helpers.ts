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
 * (Block 2 / buildTaskInvariantContext for the plan + Current Task,
 * Block 3 / buildTurnVariableContext for parallel-task manifests and
 * modify-target current contents), so this is intentionally minimal
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

export type CommandHistoryEntry = NonNullable<ArchitectGraphState['commandHistory']>[number];

export interface CommandHistoryAddition extends CommandExecutionResult {
  error?: string;
  result?: any;
}

/** Retention window shared with `detectRecentToolFailures` / `summarizeDominantFailure`. */
const HISTORY_WINDOW_MS = 5 * 60 * 1000;
/** Hard cap so the channel value cannot grow unbounded over a long job. */
const HISTORY_MAX_ENTRIES = 100;

/**
 * Append executions to command history and detect repetition — PURE.
 *
 * Returns the new history array for the tool node to commit as a channel
 * delta (`hookUpdates.commandHistory`). Mutating `state.commandHistory` in
 * place never propagated: no node returned the channel, so its value stayed
 * `undefined` at every superstep and Safety Net B / the loop-detection
 * warning / the dominant-failure diagnostic all read an empty history
 * (trim-grinding-motif RCA — 371 identical read_file failures, zero brakes).
 *
 * `warnings` maps command label → LOOP DETECTION WARNING for commands whose
 * recent same-command failure count reached the threshold in this batch.
 */
export function appendCommandHistory(
  prev: CommandHistoryEntry[] | undefined,
  additions: CommandHistoryAddition[],
  now: number = Date.now(),
): { history: CommandHistoryEntry[]; warnings: Map<string, string> } {
  const windowStart = now - HISTORY_WINDOW_MS;
  const history: CommandHistoryEntry[] = (prev ?? []).filter(h => h.timestamp > windowStart);
  const warnings = new Map<string, string>();

  for (const add of additions) {
    history.push({
      command: add.command,
      timestamp: now,
      success: add.success,
      exitCode: add.exitCode,
      errorSnippet: add.success ? undefined : (add.error || add.result || '').toString().slice(0, 3000),
    });

    if (add.success) continue;
    const recentSimilarFailures = history.filter(h =>
      h.command === add.command && !h.success && h.timestamp > windowStart,
    );
    if (recentSimilarFailures.length >= 3) {
      console.warn(`\n⚠️  [Tool] PATTERN DETECTED: Command "${add.command}" failed ${recentSimilarFailures.length} times in 5 minutes`);
      console.warn(`   This indicates a systemic issue that won't be resolved by retrying the same command.\n`);

      warnings.set(add.command, `\n\n🚨 LOOP DETECTION WARNING:
This command has failed ${recentSimilarFailures.length} times in the last 5 minutes with similar errors.

Repeating the same command will NOT fix the issue. You need to:
1. Investigate the ROOT CAUSE (not just the symptom)
2. Check environment setup (dependencies, configuration, permissions)
3. Try a DIFFERENT approach or ask for human help

DO NOT run "${add.command}" again without changing something fundamental.`);
    }
  }

  return {
    history: history.length > HISTORY_MAX_ENTRIES ? history.slice(-HISTORY_MAX_ENTRIES) : history,
    warnings,
  };
}

