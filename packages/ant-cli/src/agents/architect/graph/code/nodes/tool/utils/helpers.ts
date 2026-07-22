/**
 * Tool Helper Functions
 * 공통 헬퍼 함수들
 */

import { ArchitectGraphState } from '../../../state';
import { CommandExecutionResult } from '../types';
import { isVerificationTask } from '../../../tasks/verification';
import { isSetupTask } from '../../../tasks/setup';
import { hashCommandOutput } from '../../execute/drainFinalize';

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

/**
 * Recency reminder for the VERIFY-MODE PLAN tool loop (shy-crushing-bloom
 * RCA). The plan loop deliberately carries no per-round task reminder, so in
 * a long diagnostic loop the only instructions live in messages[0] — hundreds
 * of K tokens back once the loop grows. The incident's model saw 357 rounds
 * of raw tool results with zero reinforcement of the cycle's legal exits and
 * locked onto re-running the same gate. This reminder re-states the two legal
 * terminals (and only for verify-mode plan loops — other task types keep the
 * lean no-reminder plan loop).
 */
export function buildVerifyPlanReminder(taskName: string): string {
  return `\n\nTask: **${taskName}** (verification diagnosis) — a verification cycle ends in exactly ONE of two shapes: ` +
    `a remediation plan (\`batches[]\`, one batch per root cause) when any gate fails, ` +
    `or <done>true</done> when every gate passes. ` +
    `Re-running a command whose output you have already observed unchanged yields no new information — ` +
    `diagnose from the outputs you already have.`;
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
    // Output-identity signature (shy-crushing-bloom RCA): recorded for every
    // entry with observable string output so `isAllRepeatCommandBatch` and
    // the success-repeat notice below can detect a re-run that produced the
    // SAME output — the class that every failure-gated brake ignores.
    const outputHash = typeof add.result === 'string'
      ? hashCommandOutput(add.result)
      : undefined;
    history.push({
      command: add.command,
      timestamp: now,
      success: add.success,
      exitCode: add.exitCode,
      errorSnippet: add.success ? undefined : (add.error || add.result || '').toString().slice(0, 3000),
      outputHash,
    });

    if (add.success) {
      // Success-repeat advisory (in-context nudge; the hard guarantee is the
      // no-progress breaker): the exact command has now produced identical
      // output N times in the window. Failure loops get the sterner warning
      // below; success loops previously got NOTHING (shy-crushing-bloom ran
      // one passing-exit-code test 357 times without a single pushback).
      if (outputHash) {
        const identicalRuns = history.filter(h =>
          h.command === add.command && h.success &&
          h.outputHash === outputHash && h.timestamp > windowStart,
        );
        if (identicalRuns.length >= 3) {
          warnings.set(add.command, `\n\n🔁 REPEATED COMMAND NOTICE:
This exact command has run ${identicalRuns.length} times in the last 5 minutes with identical output. Nothing in the environment changes between identical invocations — running it again will return the same result. Act on the output you already have (emit your plan / apply your changes), or run a DIFFERENT diagnostic.`);
        }
      }
      continue;
    }
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

/**
 * True when some single command has failed 2+ times inside the retention
 * window — the "repetition" prerequisite for executeRouter Safety Net B.
 *
 * A failure the LLM has not yet observed cannot count as "repeating": one
 * parallel batch of N distinct first-time failures (e.g. 5 exploratory
 * read_file misses) must flow back into the conversation so the model can
 * self-correct in-context, not tear the conversation down (heavy-grading-
 * folio: teardown on the first failure batch discarded the model's own
 * stated correction and re-entered a byte-identical fresh attempt).
 */
export function hasRepeatedRecentFailure(
  commandHistory: CommandHistoryEntry[] | undefined,
  now: number = Date.now(),
): boolean {
  if (!commandHistory || commandHistory.length === 0) return false;
  const windowStart = now - HISTORY_WINDOW_MS;
  const seen = new Set<string>();
  for (const h of commandHistory) {
    if (h.success || h.timestamp <= windowStart) continue;
    if (seen.has(h.command)) return true;
    seen.add(h.command);
  }
  return false;
}

