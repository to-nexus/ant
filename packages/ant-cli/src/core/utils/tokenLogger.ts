/**
 * Token Logger
 * 
 * Logs per-LLM-call token usage for debugging and cost analysis.
 * - Actual API token usage (inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens)
 * - Context metrics (conversation history length, project code files count)
 * - Derived metrics (cache hit ratio, cumulative totals)
 * 
 * Creates files in sessions/debug/tokens/ directory.
 * 
 * File naming: {jobId}.json
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { getSessionDebugDir } from './sessionPaths';

export interface TokenLogEntry {
  /** Task identifier */
  taskId: string;
  /** Task display name */
  taskName: string;
  /** Graph node that made the LLM call */
  node: string;
  /** nth LLM call within this task (0-based) */
  callIndex: number;
  /** ISO timestamp */
  timestamp: string;

  /** Actual API input tokens (non-cache) */
  inputTokens: number;
  /** Actual API output tokens */
  outputTokens: number;
  /** Tokens served from prompt cache */
  cacheReadTokens: number;
  /** Tokens used to create cache entries */
  cacheCreationTokens: number;

  /** Number of messages in conversation history */
  conversationHistoryLength: number;
  /** Number of project code context files loaded */
  projectCodeContextFiles: number;
  /** Estimated prompt size in characters */
  estimatedPromptChars: number;

  /** cacheRead / (cacheRead + input), 0-1 */
  cacheHitRatio: number;
  /** Running total of input tokens for this task */
  taskCumulativeInput: number;
  /** Running total of output tokens for this task */
  taskCumulativeOutput: number;
}

/** Context passed from LLM call sites to TokenLogger */
export interface TokenLogContext {
  taskId: string;
  taskName: string;
  node: string;
  callIndex: number;
  conversationHistoryLength: number;
  projectCodeContextFiles: number;
  estimatedPromptChars: number;
  taskCumulativeInput: number;
  taskCumulativeOutput: number;
}

export interface TokenLoggerOptions {
  featurePath: string;
  jobId: string;
}

/**
 * Token Logger class for tracking per-call LLM token usage
 */
export class TokenLogger {
  private options: TokenLoggerOptions;
  private logDirPath: string;
  private logFilePath: string;
  private initialized = false;
  private hasEntries = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options: TokenLoggerOptions) {
    this.options = options;
    this.logDirPath = getSessionDebugDir(options.featurePath, 'architect', 'tokens');
    this.logFilePath = path.join(this.logDirPath, `token-${options.jobId}.json`);
  }

  /**
   * Log a token usage entry (non-blocking, fire-and-forget)
   */
  async log(
    usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheCreationTokens?: number },
    context: TokenLogContext
  ): Promise<void> {
    try {
      const inputTokens = usage.inputTokens || 0;
      const cacheReadTokens = usage.cacheReadTokens || 0;
      const cacheCreationTokens = usage.cacheCreationTokens || 0;
      const outputTokens = usage.outputTokens || 0;
      const totalForRatio = cacheReadTokens + inputTokens;

      const cacheHitRatio = totalForRatio > 0 ? Math.round((cacheReadTokens / totalForRatio) * 1000) / 1000 : 0;

      const entry: TokenLogEntry = {
        taskId: context.taskId,
        taskName: context.taskName,
        node: context.node,
        callIndex: context.callIndex,
        timestamp: new Date().toISOString(),
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
        conversationHistoryLength: context.conversationHistoryLength,
        projectCodeContextFiles: context.projectCodeContextFiles,
        estimatedPromptChars: context.estimatedPromptChars,
        cacheHitRatio,
        taskCumulativeInput: context.taskCumulativeInput + inputTokens,
        taskCumulativeOutput: context.taskCumulativeOutput + outputTokens,
      };

      // ━━━ Monitoring alerts ━━━
      if (context.callIndex > 0 && cacheHitRatio < 0.5 && context.node === 'codeGen') {
        console.warn(
          `⚠️  [TokenMonitor] Low cache hit: ${(cacheHitRatio * 100).toFixed(1)}% ` +
          `(task=${context.taskId}, call=${context.callIndex}). ` +
          `cacheRead=${cacheReadTokens} input=${inputTokens} creation=${cacheCreationTokens}`
        );
      }

      if (context.callIndex > 0 && context.callIndex % 5 === 0 && context.node === 'codeGen') {
        const cumInput = context.taskCumulativeInput + inputTokens;
        const cumOutput = context.taskCumulativeOutput + outputTokens;
        console.log(
          `📊 [TokenMonitor] Task ${context.taskId} iteration ${context.callIndex}: ` +
          `cumulative ${cumInput + cumOutput} tokens (in=${cumInput} out=${cumOutput})`
        );
      }

      if (context.callIndex >= 15 && context.node === 'codeGen') {
        console.warn(
          `⚠️  [TokenMonitor] High iteration count: ${context.callIndex} calls ` +
          `(task=${context.taskId} "${context.taskName}")`
        );
      }

      await this.appendEntry(entry);
    } catch (error) {
      // Non-blocking: don't let logging failures affect execution
      console.warn(`⚠️  [TokenLogger] Failed to log token usage:`, error);
    }
  }

  /**
   * Serialize all writes through a promise queue to prevent race conditions.
   * Without this, concurrent appendEntry calls can read the file simultaneously,
   * both decide no comma is needed, and produce `}{` instead of `},{`.
   */
  private enqueue(fn: () => Promise<void>): Promise<void> {
    this.writeQueue = this.writeQueue.then(fn, fn);
    return this.writeQueue;
  }

  private async appendEntry(entry: TokenLogEntry): Promise<void> {
    return this.enqueue(async () => {
      await this.ensureLogDir();
      const entryJson = JSON.stringify(entry, null, 2);

      if (!this.initialized) {
        await this.initLogFile();
      } else {
        // File always ends with \n]\n (3 bytes) — truncate to reopen the array
        const stat = await fs.stat(this.logFilePath);
        if (stat.size > 3) {
          await fs.truncate(this.logFilePath, stat.size - 3);
        }
      }

      const prefix = this.hasEntries ? ',\n' : '';
      await fs.appendFile(this.logFilePath, prefix + entryJson + '\n]\n');
      this.hasEntries = true;
    });
  }

  /**
   * No-op: file is always valid JSON after each appendEntry.
   * Kept for API compatibility with clearTokenLogger.
   */
  async finalize(): Promise<void> {}

  /**
   * Read existing log file to determine state, handling both properly closed
   * files (\n]\n trailer) and crash-recovered files (no closing bracket).
   */
  private async initLogFile(): Promise<void> {
    try {
      const stat = await fs.stat(this.logFilePath);
      if (stat.size >= 3) {
        const fh = await fs.open(this.logFilePath, 'r');
        try {
          const buf = Buffer.alloc(3);
          await fh.read(buf, 0, 3, stat.size - 3);

          if (buf.toString('utf-8') === '\n]\n') {
            await fs.truncate(this.logFilePath, stat.size - 3);
            this.hasEntries = stat.size > 5;
          } else {
            this.hasEntries = stat.size > 2;
          }
        } finally {
          await fh.close();
        }
      } else {
        await fs.writeFile(this.logFilePath, '[\n');
        this.hasEntries = false;
      }
    } catch {
      await fs.writeFile(this.logFilePath, '[\n');
      this.hasEntries = false;
    }
    this.initialized = true;
  }

  private async ensureLogDir(): Promise<void> {
    try {
      await fs.mkdir(this.logDirPath, { recursive: true });
    } catch {
      // Directory might already exist
    }
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
 * Get or create a token logger for a job
 */
export function getTokenLogger(options: TokenLoggerOptions): TokenLogger {
  const key = options.jobId;
  if (!loggerInstances.has(key)) {
    loggerInstances.set(key, new TokenLogger(options));
  }
  return loggerInstances.get(key)!;
}

/**
 * Clear and finalize token logger instance (call when job completes)
 */
export async function clearTokenLogger(jobId: string): Promise<void> {
  const logger = loggerInstances.get(jobId);
  if (logger) {
    await logger.finalize();
    loggerInstances.delete(jobId);
  }
}
