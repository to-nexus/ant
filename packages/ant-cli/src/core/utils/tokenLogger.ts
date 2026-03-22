/**
 * Token Logger — JSONL format
 *
 * Logs per-LLM-call token usage for debugging and cost analysis.
 * Each line is a self-contained JSON object (JSONL / newline-delimited JSON).
 *
 * File location: sessions/debug/tokens/token-{jobId}.json
 *
 * Entry types:
 *   - "call"           Per-LLM-call token usage (default)
 *   - "resume_marker"  Written on job resume to mark run boundaries
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { getSessionDebugDir } from './sessionPaths';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface TokenLogEntry {
  type: 'call';
  taskId: string;
  taskName: string;
  node: string;
  callIndex: number;
  timestamp: string;

  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;

  /** Cost-weighted input: input*1.0 + cacheCreation*1.25 + cacheRead*0.1 */
  billableInputTokens: number;

  conversationHistoryLength: number;
  projectCodeContextFiles: number;
  estimatedPromptChars: number;

  /** cacheRead / (cacheRead + input), 0-1 */
  cacheHitRatio: number;
  /** Running total of raw input tokens for this task */
  taskCumulativeInput: number;
  /** Running total of output tokens for this task */
  taskCumulativeOutput: number;
  /** Running total of billable input for this task */
  taskCumulativeBillableInput: number;
  recursionCount?: number;
}

export interface ResumeMarkerEntry {
  type: 'resume_marker';
  timestamp: string;
  jobId: string;
  message: string;
}

export type TokenLogLine = TokenLogEntry | ResumeMarkerEntry;

/** Context passed from LLM call sites to TokenLogger */
export interface TokenLogContext {
  taskId: string;
  taskName: string;
  node: string;
  callIndex: number;
  conversationHistoryLength?: number;
  projectCodeContextFiles?: number;
  estimatedPromptChars?: number;
  taskCumulativeInput?: number;
  taskCumulativeOutput?: number;
  recursionCount?: number;
}

export interface TokenLoggerOptions {
  featurePath: string;
  jobId: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function computeBillableInput(
  inputTokens: number,
  cacheCreationTokens: number,
  cacheReadTokens: number,
): number {
  return Math.round(inputTokens * 1.0 + cacheCreationTokens * 1.25 + cacheReadTokens * 0.1);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TokenLogger
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class TokenLogger {
  private logDirPath: string;
  private logFilePath: string;
  private dirEnsured = false;
  private writeQueue: Promise<void> = Promise.resolve();
  private jobId: string;

  /** Per-task cumulative billable input (tracked internally so call sites don't need to) */
  private taskBillableCumulative = new Map<string, number>();

  constructor(private options: TokenLoggerOptions) {
    this.jobId = options.jobId;
    this.logDirPath = getSessionDebugDir(options.featurePath, 'architect', 'tokens');
    this.logFilePath = path.join(this.logDirPath, `token-${options.jobId}.json`);
  }

  /**
   * Log a per-call token usage entry.
   */
  async log(
    usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheCreationTokens?: number },
    context: TokenLogContext,
  ): Promise<void> {
    try {
      const inputTokens = usage.inputTokens || 0;
      const cacheReadTokens = usage.cacheReadTokens || 0;
      const cacheCreationTokens = usage.cacheCreationTokens || 0;
      const outputTokens = usage.outputTokens || 0;
      const totalForRatio = cacheReadTokens + inputTokens;

      const cacheHitRatio = totalForRatio > 0 ? Math.round((cacheReadTokens / totalForRatio) * 1000) / 1000 : 0;
      const billable = computeBillableInput(inputTokens, cacheCreationTokens, cacheReadTokens);

      const prevBillable = this.taskBillableCumulative.get(context.taskId) ?? 0;
      const newBillableCum = prevBillable + billable;
      this.taskBillableCumulative.set(context.taskId, newBillableCum);

      const entry: TokenLogEntry = {
        type: 'call',
        taskId: context.taskId,
        taskName: context.taskName,
        node: context.node,
        callIndex: context.callIndex,
        timestamp: new Date().toISOString(),
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
        billableInputTokens: billable,
        conversationHistoryLength: context.conversationHistoryLength ?? 0,
        projectCodeContextFiles: context.projectCodeContextFiles ?? 0,
        estimatedPromptChars: context.estimatedPromptChars ?? 0,
        cacheHitRatio,
        taskCumulativeInput: (context.taskCumulativeInput ?? 0) + inputTokens,
        taskCumulativeOutput: (context.taskCumulativeOutput ?? 0) + outputTokens,
        taskCumulativeBillableInput: newBillableCum,
        ...(context.recursionCount !== undefined ? { recursionCount: context.recursionCount } : {}),
      };

      // ━━━ Monitoring alerts (applies to iterative LLM nodes: execute, docGen) ━━━
      const isIterativeNode = context.node === 'execute' || context.node === 'docGen';
      
      if (context.callIndex > 0 && cacheHitRatio < 0.5 && isIterativeNode) {
        console.warn(
          `⚠️  [TokenMonitor] Low cache hit: ${(cacheHitRatio * 100).toFixed(1)}% ` +
          `(node=${context.node}, task=${context.taskId}, call=${context.callIndex}). ` +
          `cacheRead=${cacheReadTokens} input=${inputTokens} creation=${cacheCreationTokens}`,
        );
      }

      if (context.callIndex > 0 && context.callIndex % 5 === 0 && isIterativeNode) {
        const cumInput = (context.taskCumulativeInput ?? 0) + inputTokens;
        const cumOutput = (context.taskCumulativeOutput ?? 0) + outputTokens;
        console.log(
          `📊 [TokenMonitor] Task ${context.taskId} iteration ${context.callIndex}: ` +
          `cumulative ${cumInput + cumOutput} tokens (in=${cumInput} out=${cumOutput})`,
        );
      }

      if (context.callIndex >= 15 && isIterativeNode) {
        console.warn(
          `⚠️  [TokenMonitor] High iteration count: ${context.callIndex} calls ` +
          `(node=${context.node}, task=${context.taskId} "${context.taskName}")`,
        );
      }

      await this.appendLine(entry);
    } catch (error) {
      console.warn(`⚠️  [TokenLogger] Failed to log token usage:`, error);
    }
  }

  /**
   * Write a resume marker to the log.
   * Called on job resume to clearly separate run boundaries.
   */
  async logResumeMarker(): Promise<void> {
    try {
      const marker: ResumeMarkerEntry = {
        type: 'resume_marker',
        timestamp: new Date().toISOString(),
        jobId: this.jobId,
        message: 'Job resumed — entries below are from a new run',
      };
      await this.appendLine(marker);
    } catch (error) {
      console.warn(`⚠️  [TokenLogger] Failed to write resume marker:`, error);
    }
  }

  /**
   * Serialize writes through a promise queue to prevent interleaving.
   */
  private enqueue(fn: () => Promise<void>): Promise<void> {
    this.writeQueue = this.writeQueue.then(fn, fn);
    return this.writeQueue;
  }

  /**
   * Append a single JSONL line. Each line is compact JSON + newline.
   */
  private async appendLine(data: TokenLogLine): Promise<void> {
    return this.enqueue(async () => {
      if (!this.dirEnsured) {
        await fs.mkdir(this.logDirPath, { recursive: true }).catch(() => {});
        this.dirEnsured = true;
      }
      await fs.appendFile(this.logFilePath, JSON.stringify(data) + '\n');
    });
  }

  getLogFilePath(): string {
    return this.logFilePath;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Global instances (one per job)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const loggerInstances: Map<string, TokenLogger> = new Map();

/**
 * Get or create a token logger for a job.
 */
export function getTokenLogger(options: TokenLoggerOptions): TokenLogger {
  const key = options.jobId;
  if (!loggerInstances.has(key)) {
    loggerInstances.set(key, new TokenLogger(options));
  }
  return loggerInstances.get(key)!;
}

/**
 * Clear token logger instance (call when job completes).
 */
export async function clearTokenLogger(jobId: string): Promise<void> {
  loggerInstances.delete(jobId);
}
