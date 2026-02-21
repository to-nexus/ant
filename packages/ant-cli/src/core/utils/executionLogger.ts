/**
 * Execution Logger
 * 
 * Logs structured execution events for job/task lifecycle debugging.
 * Works in both CLI and HTTP modes (unlike TaskLogger which only captures console output in CLI).
 * 
 * Events capture: job lifecycle, task transitions, errors, retries, timing, and decisions.
 * 
 * Creates files in sessions/debug/logs/ directory.
 * 
 * File naming: log-{jobId}.json
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { getSessionDebugDir } from './sessionPaths';

export type ExecutionEventType =
  | 'job_start'
  | 'job_complete'
  | 'task_start'
  | 'task_complete'
  | 'task_fail'
  | 'task_error'
  | 'task_retry'
  | 'parallel_start'
  | 'parallel_complete'
  | 'violation_detected'
  | 'phase_complete';

export interface ExecutionEvent {
  /** ISO timestamp */
  timestamp: string;
  /** Event type */
  type: ExecutionEventType;
  /** Task ID (if task-scoped) */
  taskId?: string;
  /** Event-specific payload */
  data: Record<string, any>;
}

export interface ExecutionLoggerOptions {
  featurePath: string;
  jobId: string;
  jobType: string;
}

/**
 * Execution Logger class for tracking job/task lifecycle events
 */
export class ExecutionLogger {
  private options: ExecutionLoggerOptions;
  private logDirPath: string;
  private logFilePath: string;
  private initialized = false;
  private hasEntries = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options: ExecutionLoggerOptions) {
    this.options = options;
    this.logDirPath = getSessionDebugDir(options.featurePath, 'architect', 'logs');
    this.logFilePath = path.join(this.logDirPath, `log-${options.jobId}.json`);
  }

  /**
   * Log an execution event (non-blocking)
   */
  async log(type: ExecutionEventType, data: Record<string, any>, taskId?: string): Promise<void> {
    try {
      const event: ExecutionEvent = {
        timestamp: new Date().toISOString(),
        type,
        ...(taskId ? { taskId } : {}),
        data,
      };
      await this.appendEvent(event);
    } catch (error) {
      // Non-blocking: don't let logging failures affect execution
      console.warn(`⚠️  [ExecutionLogger] Failed to log event:`, error);
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Convenience methods for common events
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  async logJobStart(data: {
    jobType: string;
    environment?: string;
    language?: string;
    framework?: string;
    taskCount?: number;
  }): Promise<void> {
    await this.log('job_start', data);
  }

  async logJobComplete(data: {
    totalTasks: number;
    totalTokens: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheReadTokens: number;
    elapsedMs: number;
  }): Promise<void> {
    await this.log('job_complete', data);
  }

  async logTaskStart(taskId: string, data: {
    taskName: string;
    taskType: string;
    priority: number;
    isParallel: boolean;
    parallelGroup?: string;
  }): Promise<void> {
    await this.log('task_start', data, taskId);
  }

  async logTaskComplete(taskId: string, data: {
    taskName: string;
    elapsedMs: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    llmCallCount: number;
  }): Promise<void> {
    await this.log('task_complete', data, taskId);
  }

  async logTaskFail(taskId: string, data: {
    taskName: string;
    reason: 'recursion_limit' | 'deterministic_error' | 'max_retries' | 'unknown';
    errorMessage: string;
    elapsedMs?: number;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    llmCallCount?: number;
    recursionCount?: number;
  }): Promise<void> {
    await this.log('task_fail', data, taskId);
  }

  async logTaskError(taskId: string, data: {
    taskName: string;
    violationType?: string;
    violationCount: number;
    retryCount: number;
    message: string;
  }): Promise<void> {
    await this.log('task_error', data, taskId);
  }

  async logViolation(taskId: string, data: {
    violationType: string;
    message: string;
    retryCount: number;
  }): Promise<void> {
    await this.log('violation_detected', data, taskId);
  }

  async logParallelStart(data: {
    taskIds: string[];
    concurrency: number;
  }): Promise<void> {
    await this.log('parallel_start', data);
  }

  async logParallelComplete(data: {
    taskIds: string[];
    elapsedMs: number;
  }): Promise<void> {
    await this.log('parallel_complete', data);
  }

  async logPhaseComplete(data: {
    phase: string;
    elapsedMs: number;
    details?: Record<string, any>;
  }): Promise<void> {
    await this.log('phase_complete', data);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // File I/O
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Serialize all writes through a promise queue to prevent race conditions.
   * Without this, concurrent appendEvent calls can read the file simultaneously,
   * both decide no comma is needed, and produce `}{` instead of `},{`.
   */
  private enqueue(fn: () => Promise<void>): Promise<void> {
    this.writeQueue = this.writeQueue.then(fn, fn);
    return this.writeQueue;
  }

  private async appendEvent(event: ExecutionEvent): Promise<void> {
    return this.enqueue(async () => {
      await this.ensureLogDir();
      const eventJson = JSON.stringify(event, null, 2);

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
      await fs.appendFile(this.logFilePath, prefix + eventJson + '\n]\n');
      this.hasEntries = true;
    });
  }

  /**
   * No-op: file is always valid JSON after each appendEvent.
   * Kept for API compatibility with clearExecutionLogger.
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

const loggerInstances: Map<string, ExecutionLogger> = new Map();

/**
 * Get or create an execution logger for a job
 */
export function getExecutionLogger(options: ExecutionLoggerOptions): ExecutionLogger {
  const key = options.jobId;
  if (!loggerInstances.has(key)) {
    loggerInstances.set(key, new ExecutionLogger(options));
  }
  return loggerInstances.get(key)!;
}

/**
 * Clear and finalize execution logger instance (call when job completes)
 */
export async function clearExecutionLogger(jobId: string): Promise<void> {
  const logger = loggerInstances.get(jobId);
  if (logger) {
    await logger.finalize();
    loggerInstances.delete(jobId);
  }
}
