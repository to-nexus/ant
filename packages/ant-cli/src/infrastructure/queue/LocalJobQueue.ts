/**
 * LocalJobQueue
 * 
 * Local implementation of JobQueuePort.
 * Directly spawns child processes for job execution (single-server mode).
 * 
 * This wraps the existing JobExecutionManager pattern while implementing
 * the JobQueuePort interface for future cloud migration.
 * 
 * @see 10-cloud-scalability-design.md Section 3.2.2
 */

import { ChildProcess, spawn } from 'child_process';
import * as path from 'path';
import {
  JobQueuePort,
  JobPayload,
  JobProgress,
  JobExecutionResult,
  JobQueueStatusValue,
  QueuePositionInfo
} from '../../core/ports/queue';
import { StateStorePort, LogEntry } from '../../core/ports/stateStore';
import { logger } from '../../utils/logger';

// Callback registries
type ProgressCallback = (progress: JobProgress) => void;
type CompleteCallback = (result: JobExecutionResult) => void;

export class LocalJobQueue implements JobQueuePort {
  private processes = new Map<string, ChildProcess>();
  private progressCallbacks = new Map<string, Set<ProgressCallback>>();
  private completeCallbacks = new Map<string, Set<CompleteCallback>>();
  
  constructor(private stateStore: StateStorePort) {}

  /**
   * Enqueue a job for execution
   * In local mode, this directly spawns the process
   */
  async enqueue(payload: JobPayload): Promise<string> {
    const { jobId, projectId, feature, type: jobType, userContext } = payload;
    
    logger.info(`Enqueuing job: ${jobId}`, {
      component: 'LocalJobQueue',
      jobId,
      projectId,
      featureName: feature
    });
    
    // Initialize job status in state store
    await this.stateStore.setJobStatus(jobId, {
      jobId,
      status: 'pending',
      projectId,
      featureName: feature,
      type: jobType,
      userContext,
      startedAt: new Date().toISOString()
    });
    
    // Set job mapping
    await this.stateStore.setJobMapping(jobId, {
      projectId,
      featureName: feature,
      jobType,
      userContext
    });
    
    // Emit initial progress
    this.emitProgress(jobId, {
      jobId,
      phase: 'pending',
      message: 'Job queued for execution',
      timestamp: new Date().toISOString()
    });
    
    // Start execution asynchronously
    this.executeJob(payload).catch(error => {
      logger.error(`Job ${jobId} execution failed`, {
        component: 'LocalJobQueue',
        jobId
      }, error);
    });
    
    return jobId;
  }

  /**
   * Execute job in child process
   */
  private async executeJob(payload: JobPayload): Promise<void> {
    const { jobId, agent, type: jobType, projectId, feature, userContext } = payload;
    
    // Update status to running
    await this.stateStore.updateJobStatus(jobId, { status: 'running' });
    
    this.emitProgress(jobId, {
      jobId,
      phase: 'starting',
      message: 'Starting job execution',
      timestamp: new Date().toISOString()
    });
    
    try {
      // Build CLI arguments
      const antCliSrc = path.join(process.cwd(), 'src/index.ts');
      const args: string[] = [antCliSrc, agent, jobType];
      
      // Add input file or feature path (will be resolved by the child process)
      if (payload.inputFile) {
        args.push(payload.inputFile);
      }
      
      if (payload.mode && jobType === 'code') {
        args.push('--mode', payload.mode);
      }
      
      if (projectId) {
        args.push('--project', projectId);
      }
      
      if (payload.enableEvaluation && jobType === 'code') {
        args.push('--eval');
      }
      
      logger.debug(`Spawning process with args: ${args.join(' ')}`, {
        component: 'LocalJobQueue',
        jobId
      });
      
      // Build environment
      const childEnv = this.buildChildEnvironment(payload);
      
      // Spawn child process
      const childProcess = spawn('npx', ['tsx', ...args], {
        cwd: process.cwd(),
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false
      });
      
      this.processes.set(jobId, childProcess);
      
      // Setup log streaming
      this.setupLogStreaming(jobId, childProcess);
      
      this.emitProgress(jobId, {
        jobId,
        phase: 'running',
        message: 'Job is running',
        timestamp: new Date().toISOString()
      });
      
      // Wait for process to complete
      await this.waitForProcess(jobId, childProcess);
      
    } catch (error: any) {
      await this.handleJobError(jobId, error);
    }
  }

  /**
   * Build environment variables for child process
   */
  private buildChildEnvironment(payload: JobPayload): Record<string, string> {
    const { jobId, projectId, feature, userContext, overrideDirective, chatSource } = payload;
    
    const ensuredPath = process.env.PATH 
      ? `${process.env.PATH}:/usr/local/bin:/usr/bin:/bin`
      : '/usr/local/bin:/usr/bin:/bin';
    
    const userEmail = userContext 
      ? `${userContext.userId}@${userContext.organizationId}`
      : undefined;
    
    const env: Record<string, string> = {
      PATH: ensuredPath,
      HOME: process.env.HOME || '/tmp',
      USER: process.env.USER || 'ant',
      LANG: process.env.LANG || 'en_US.UTF-8',
      NODE_ENV: process.env.NODE_ENV || 'production',
      ANT_JOB_ID: jobId,
      ANT_CLI_PORT: process.env.ANT_CLI_PORT || '4100',
      ANT_SERVER_MODE: process.env.ANT_SERVER_MODE || 'local',
      ANT_WORKSPACE_BASE_PATH: process.env.ANT_WORKSPACE_BASE_PATH || '',
      ANT_PROJECT_ID: projectId || '',
      ANT_FEATURE_NAME: feature || ''
    };
    
    if (userEmail) {
      env.ANT_USER_EMAIL = userEmail;
    }
    
    if (overrideDirective) {
      env.ANT_OVERRIDE_DIRECTIVE = overrideDirective;
    }
    
    if (chatSource) {
      env.ANT_CHAT_SOURCE = 'true';
    }
    
    return env;
  }

  /**
   * Setup log streaming for child process
   */
  private setupLogStreaming(jobId: string, childProcess: ChildProcess): void {
    let stdoutBuffer = '';
    let stderrBuffer = '';
    
    const processLine = async (line: string, type: 'stdout' | 'stderr') => {
      const logEntry: LogEntry = {
        type,
        message: line,
        timestamp: new Date().toISOString()
      };
      
      await this.stateStore.appendJobLog(jobId, logEntry);
      
      // Forward to console
      if (type === 'stdout') {
        process.stdout.write(line);
      } else {
        process.stderr.write(line);
      }
    };
    
    childProcess.stdout?.on('data', async (data: Buffer) => {
      stdoutBuffer += data.toString();
      let newlineIndex;
      while ((newlineIndex = stdoutBuffer.indexOf('\n')) !== -1) {
        const line = stdoutBuffer.substring(0, newlineIndex + 1);
        stdoutBuffer = stdoutBuffer.substring(newlineIndex + 1);
        await processLine(line, 'stdout');
      }
    });
    
    childProcess.stderr?.on('data', async (data: Buffer) => {
      stderrBuffer += data.toString();
      let newlineIndex;
      while ((newlineIndex = stderrBuffer.indexOf('\n')) !== -1) {
        const line = stderrBuffer.substring(0, newlineIndex + 1);
        stderrBuffer = stderrBuffer.substring(newlineIndex + 1);
        await processLine(line, 'stderr');
      }
    });
    
    // Store buffers for final flush
    (childProcess as any)._stdoutBuffer = () => stdoutBuffer;
    (childProcess as any)._stderrBuffer = () => stderrBuffer;
  }

  /**
   * Wait for process to complete
   */
  private async waitForProcess(jobId: string, childProcess: ChildProcess): Promise<void> {
    return new Promise((resolve, reject) => {
      childProcess.on('exit', async (code, signal) => {
        this.processes.delete(jobId);
        
        // Flush remaining buffers
        const stdoutBuffer = (childProcess as any)._stdoutBuffer?.() || '';
        const stderrBuffer = (childProcess as any)._stderrBuffer?.() || '';
        
        if (stdoutBuffer) {
          await this.stateStore.appendJobLog(jobId, {
            type: 'stdout',
            message: stdoutBuffer,
            timestamp: new Date().toISOString()
          });
        }
        
        if (stderrBuffer) {
          await this.stateStore.appendJobLog(jobId, {
            type: 'stderr',
            message: stderrBuffer,
            timestamp: new Date().toISOString()
          });
        }
        
        if (code === 0) {
          await this.handleJobSuccess(jobId);
          resolve();
        } else {
          const isUserStop = code === 143 || signal === 'SIGTERM';
          await this.handleJobFailure(jobId, code, signal, isUserStop);
          
          if (await this.stateStore.isUserStopped(jobId)) {
            await this.stateStore.clearUserStopped(jobId);
            resolve();
          } else {
            reject(new Error(`Job failed with exit code ${code}`));
          }
        }
      });
      
      childProcess.on('error', async (error) => {
        this.processes.delete(jobId);
        await this.handleJobError(jobId, error);
        reject(error);
      });
    });
  }

  /**
   * Handle successful job completion
   */
  private async handleJobSuccess(jobId: string): Promise<void> {
    await this.stateStore.updateJobStatus(jobId, {
      status: 'completed',
      completedAt: new Date().toISOString()
    });
    
    await this.stateStore.appendJobLog(jobId, {
      type: 'info',
      message: '\n✅ Job completed successfully!',
      timestamp: new Date().toISOString()
    });
    
    this.emitProgress(jobId, {
      jobId,
      phase: 'completed',
      message: 'Job completed successfully',
      timestamp: new Date().toISOString()
    });
    
    this.emitComplete(jobId, {
      jobId,
      success: true,
      message: 'Job completed successfully',
      completedAt: new Date().toISOString()
    });
    
    logger.info(`Job completed: ${jobId}`, { component: 'LocalJobQueue', jobId });
  }

  /**
   * Handle job failure
   */
  private async handleJobFailure(
    jobId: string, 
    code: number | null, 
    signal: NodeJS.Signals | null,
    isUserStop: boolean
  ): Promise<void> {
    const errorMessage = signal ? `Killed by ${signal}` : `Exit code: ${code}`;
    
    await this.stateStore.updateJobStatus(jobId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      error: errorMessage
    });
    
    if (!isUserStop) {
      await this.stateStore.appendJobLog(jobId, {
        type: 'stderr',
        message: signal 
          ? `\n🛑 Job stopped (${signal})`
          : `\n❌ Job failed with exit code ${code}`,
        timestamp: new Date().toISOString()
      });
    }
    
    this.emitProgress(jobId, {
      jobId,
      phase: isUserStop ? 'paused' : 'failed',
      message: errorMessage,
      timestamp: new Date().toISOString()
    });
    
    this.emitComplete(jobId, {
      jobId,
      success: false,
      error: errorMessage,
      completedAt: new Date().toISOString(),
      interruption: isUserStop ? {
        reason: 'user_stopped',
        message: 'Job stopped by user',
        canResume: true
      } : undefined
    });
    
    logger.info(`Job failed: ${jobId} - ${errorMessage}`, { component: 'LocalJobQueue', jobId });
  }

  /**
   * Handle job error
   */
  private async handleJobError(jobId: string, error: Error): Promise<void> {
    await this.stateStore.updateJobStatus(jobId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      error: error.message
    });
    
    await this.stateStore.appendJobLog(jobId, {
      type: 'stderr',
      message: `\n❌ Job error: ${error.message}`,
      timestamp: new Date().toISOString()
    });
    
    this.emitProgress(jobId, {
      jobId,
      phase: 'failed',
      message: error.message,
      timestamp: new Date().toISOString()
    });
    
    this.emitComplete(jobId, {
      jobId,
      success: false,
      error: error.message,
      completedAt: new Date().toISOString()
    });
    
    logger.error(`Job error: ${jobId}`, { component: 'LocalJobQueue', jobId }, error);
  }

  /**
   * Get job status
   */
  async getStatus(jobId: string): Promise<JobQueueStatusValue> {
    const status = await this.stateStore.getJobStatus(jobId);
    if (!status) return null;
    
    return status.status as JobQueueStatusValue;
  }

  /**
   * Cancel a running job
   */
  async cancel(jobId: string): Promise<void> {
    logger.info(`Cancelling job: ${jobId}`, { component: 'LocalJobQueue', jobId });
    
    await this.stateStore.markUserStopped(jobId);
    
    const process = this.processes.get(jobId);
    if (process) {
      process.kill('SIGTERM');
      
      // Wait briefly, then force kill if needed
      setTimeout(() => {
        if (this.processes.has(jobId)) {
          process.kill('SIGKILL');
        }
      }, 5000);
    }
    
    await this.stateStore.updateJobStatus(jobId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      error: 'Cancelled by user'
    });
  }

  /**
   * Get queue position for a job
   * In local mode, jobs are executed immediately (no queue)
   */
  async getQueuePosition(jobId: string): Promise<QueuePositionInfo> {
    const status = await this.getStatus(jobId);
    
    // In local mode, there's no queue - jobs run immediately
    // So position is always 0 (running) or null (not in queue)
    if (status === 'running') {
      return { status: 'running', position: 0, totalWaiting: 0 };
    }
    
    return { status, position: null, totalWaiting: 0 };
  }

  /**
   * Register progress callback
   */
  onProgress(jobId: string, callback: ProgressCallback): () => void {
    if (!this.progressCallbacks.has(jobId)) {
      this.progressCallbacks.set(jobId, new Set());
    }
    this.progressCallbacks.get(jobId)!.add(callback);
    
    return () => {
      this.progressCallbacks.get(jobId)?.delete(callback);
    };
  }

  /**
   * Register completion callback
   */
  onComplete(jobId: string, callback: CompleteCallback): () => void {
    if (!this.completeCallbacks.has(jobId)) {
      this.completeCallbacks.set(jobId, new Set());
    }
    this.completeCallbacks.get(jobId)!.add(callback);
    
    return () => {
      this.completeCallbacks.get(jobId)?.delete(callback);
    };
  }

  /**
   * Emit progress to registered callbacks
   */
  private emitProgress(jobId: string, progress: JobProgress): void {
    const callbacks = this.progressCallbacks.get(jobId);
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback(progress);
        } catch (error) {
          logger.error(`Progress callback error`, { component: 'LocalJobQueue', jobId }, error);
        }
      }
    }
  }

  /**
   * Emit completion to registered callbacks
   */
  private emitComplete(jobId: string, result: JobExecutionResult): void {
    const callbacks = this.completeCallbacks.get(jobId);
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback(result);
        } catch (error) {
          logger.error(`Complete callback error`, { component: 'LocalJobQueue', jobId }, error);
        }
      }
    }
    
    // Clean up callbacks after completion
    this.progressCallbacks.delete(jobId);
    this.completeCallbacks.delete(jobId);
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<{
    pending: number;
    running: number;
    completed: number;
    failed: number;
  }> {
    // In local mode, we don't have a persistent queue
    // Return current running jobs count
    return {
      pending: 0,
      running: this.processes.size,
      completed: 0,
      failed: 0
    };
  }

  /**
   * Close and cleanup
   */
  async close(): Promise<void> {
    logger.info('Closing LocalJobQueue', { component: 'LocalJobQueue' });
    
    // Kill all running processes
    for (const [jobId, process] of this.processes) {
      logger.info(`Killing job: ${jobId}`, { component: 'LocalJobQueue', jobId });
      process.kill('SIGTERM');
    }
    
    this.processes.clear();
    this.progressCallbacks.clear();
    this.completeCallbacks.clear();
  }
}
