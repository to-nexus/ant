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

  constructor(options: TokenLoggerOptions) {
    this.options = options;
    this.logDirPath = getSessionDebugDir(options.featurePath, 'architect', 'tokens');
    this.logFilePath = path.join(this.logDirPath, `${options.jobId}.json`);
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
        cacheHitRatio: totalForRatio > 0 ? Math.round((cacheReadTokens / totalForRatio) * 1000) / 1000 : 0,
        taskCumulativeInput: context.taskCumulativeInput + inputTokens,
        taskCumulativeOutput: context.taskCumulativeOutput + outputTokens,
      };

      await this.appendEntry(entry);
    } catch (error) {
      // Non-blocking: don't let logging failures affect execution
      console.warn(`⚠️  [TokenLogger] Failed to log token usage:`, error);
    }
  }

  private async appendEntry(entry: TokenLogEntry): Promise<void> {
    await this.ensureLogDir();

    if (!this.initialized) {
      // First entry: create file with JSON array start
      try {
        await fs.access(this.logFilePath);
        // File already exists (e.g., resumed job) — read and parse to append
        this.initialized = true;
      } catch {
        // File doesn't exist, create with opening bracket
        await fs.writeFile(this.logFilePath, '[\n');
        this.initialized = true;
      }
    }

    // Read current file to check if we need a comma
    const content = await fs.readFile(this.logFilePath, 'utf-8');
    const needsComma = content.trim().length > 2; // More than just "[\n"

    const entryJson = JSON.stringify(entry, null, 2);
    const prefix = needsComma ? ',\n' : '';
    await fs.appendFile(this.logFilePath, prefix + entryJson);
  }

  /**
   * Finalize the JSON array (call when job completes)
   */
  async finalize(): Promise<void> {
    try {
      if (this.initialized) {
        await fs.appendFile(this.logFilePath, '\n]\n');
      }
    } catch {
      // Non-blocking
    }
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
