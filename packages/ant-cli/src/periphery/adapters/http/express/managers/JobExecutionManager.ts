import { ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { generateHumanId } from '../../../../../utils/humanId';
import { 
  ExecuteJobParams, 
  JobResult, 
  JobStatus, 
  LogEntry 
} from '../../../../../core/ports';
import type { InterruptionDetails } from '../../../../../core/types';
import { UserContext } from '../../../../../core/types/user';
import { logger } from '../../../../../utils/logger';
import { JobStateTracker } from './JobStateTracker';
import { ServerDependencies } from '../types';

/**
 * JobExecutionManager
 * 
 * Manages job execution lifecycle: validation, spawning, monitoring, and cleanup.
 * Handles child process management and job state persistence.
 */
export class JobExecutionManager {
  constructor(
    private readonly stateTracker: JobStateTracker,
    private readonly deps: ServerDependencies,
    private readonly onJobComplete: (jobId: string, projectId?: string, featureName?: string, interruption?: InterruptionDetails) => Promise<void>
  ) {}

  /**
   * Execute a job (JobExecutionPort implementation)
   */
  async executeJob(params: ExecuteJobParams): Promise<JobResult> {
    // Validate required feature parameter
    if (!params.feature) {
      throw new Error('Feature name is required for job execution');
    }
    
    const projectId = params.project;
    const featureName = params.feature;
    const jobType = (params.jobType === 'design' || params.jobType === 'code' || params.jobType === 'learn') 
      ? params.jobType 
      : 'code';
    
    // Generate jobId
    const jobId = params.jobId || generateHumanId();
    const isResume = !!params.jobId;
    
    logger.info(`executeJob`, {
      component: 'JobExecutionManager',
      organizationId: params.userContext?.organizationId,
      userId: params.userContext?.userId,
      projectId,
      featureName,
      jobId
    }, {
      agent: params.agent,
      jobType: params.jobType,
      resume: isResume
    });
    
    // Validate prerequisites (skip if resuming)
    if (!isResume) {
      const validationResult = await this.deps.jobPrerequisitesAdapter.validate(
        projectId,
        featureName,
        jobType,
        params.userContext,
        params.overrideDirective
      );
      
      if (!validationResult.isValid) {
        logger.warn(`Prerequisites validation failed`, { 
          component: 'JobExecutionManager', 
          jobId, 
          projectId, 
          featureName 
        }, { errorMessage: validationResult.errorMessage });
        
        return {
          jobId,
          success: false,
          error: validationResult.errorMessage,
          missingMaterials: validationResult.missingMaterials
        };
      }
    }
    
    // Initialize job tracking
    this.stateTracker.initializeJob(jobId, projectId, featureName, jobType, params.userContext);
    this.stateTracker.setCurrentJobId(jobId);
    
    // Start job execution in child process (non-blocking)
    this.runJob(jobId, params).catch(error => {
      logger.error(`Job ${jobId} failed`, { 
        component: 'JobExecutionManager', 
        jobId, 
        projectId, 
        featureName 
      }, error);
    });

    return {
      jobId,
      success: true,
      message: 'Job started'
    };
  }

  /**
   * Run job in child process
   */
  private async runJob(jobId: string, params: ExecuteJobParams): Promise<void> {
    const state = this.stateTracker.getState();
    const status = state.jobs.get(jobId)!;
    status.status = 'running';
    
    try {
      // Build CLI command - use import.meta.url to get correct package path
      const currentDir = path.dirname(new URL(import.meta.url).pathname);
      const packageRoot = path.resolve(currentDir, '../../../../../');  // Go up to packages/ant-cli
      const antCliSrc = path.join(packageRoot, 'src/index.ts');
      const args = [antCliSrc, params.agent, params.jobType];
      
      // Add input file or feature path
      if (params.inputFile) {
        args.push(params.inputFile);
      } else if (params.feature && params.userContext) {
        const tenantId = `${params.userContext.organizationId}:${params.userContext.userId}`;
        const handle = await this.deps.workspaceService.createWorkspace(tenantId, params.project);
        const featurePath = path.join(handle.storagePath, 'features', params.feature);
        args.push(featurePath);
      }
      
      if (params.mode && params.jobType === 'code') {
        args.push('--mode', params.mode);
      }
      
      if (params.project) {
        args.push('--project', params.project);
      }
      
      if (params.enableEvaluation && params.jobType === 'code') {
        args.push('--eval');
      }
      
      logger.debug(`[runJob] Final CLI args`, { component: 'JobExecutionManager', jobId }, args);
      
      // Spawn child process
      const childProcess = await this.spawnChildProcess(jobId, params, args, packageRoot);
      state.childProcesses.set(jobId, childProcess);
      
      // Setup log streaming
      this.setupLogStreaming(jobId, childProcess);
      
      // Wait for process to complete
      await this.waitForProcess(jobId, childProcess, params);
    } catch (error: any) {
      await this.handleJobError(jobId, params, error);
    } finally {
      if (this.stateTracker.getCurrentJobId() === jobId) {
        this.stateTracker.setCurrentJobId(null);
      }
    }
  }

  /**
   * Spawn child process for job execution
   */
  private async spawnChildProcess(
    jobId: string, 
    params: ExecuteJobParams, 
    args: string[],
    packageRoot: string
  ): Promise<ChildProcess> {
    const { spawn } = await import('child_process');
    
    if (!params.userContext) {
      throw new Error('userContext is required to run jobs. Authentication failed.');
    }
    
    // Get workspace paths
    const tenantId = `${params.userContext.organizationId}:${params.userContext.userId}`;
    const handle = await this.deps.workspaceService.createWorkspace(tenantId, params.project);
    
    const projectPath = handle.storagePath;
    const featurePath = params.feature
      ? path.join(handle.storagePath, 'features', params.feature)
      : projectPath;
    
    // Build isolated environment
    const ensuredPath = process.env.PATH 
      ? `${process.env.PATH}:/usr/local/bin:/usr/bin:/bin`
      : '/usr/local/bin:/usr/bin:/bin';
    
    const userEmail = `${params.userContext.userId}@${params.userContext.organizationId}`;
    
    const childEnv: Record<string, string> = {
      PATH: ensuredPath,
      HOME: process.env.HOME || '/tmp',
      USER: process.env.USER || 'ant',
      LANG: 'en_US.UTF-8',
      NODE_ENV: process.env.NODE_ENV || 'production',
      ANT_JOB_ID: jobId,
      ANT_API_URL: process.env.ANT_API_URL || `http://localhost:${process.env.PORT || '4100'}`,
      ANT_SERVER_MODE: process.env.ANT_SERVER_MODE || 'local',  // ✅ Pass server mode to child process
      ANT_WORKSPACE_BASE_PATH: process.env.ANT_WORKSPACE_BASE_PATH || '',  // ✅ Pass workspace base path
      ANT_PROJECT_ID: params.project || '',
      ANT_FEATURE_NAME: params.feature || '',
      ANT_PROJECT_PATH: projectPath,
      ANT_FEATURE_PATH: featurePath,
      // ✅ CRITICAL: Pass Redis URL for LLMResponseService (direct Redis streaming)
      ...(process.env.REDIS_URL && { ANT_REDIS_URL: process.env.REDIS_URL }),
      // ✅ Pass user context for Redis session key
      ...(params.userContext?.userId && { ANT_USER_ID: params.userContext.userId }),
      ...(params.userContext?.organizationId && { ANT_ORG_ID: params.userContext.organizationId }),
      ...(userEmail && { ANT_USER_EMAIL: userEmail }),
      ...(params.overrideDirective && { ANT_OVERRIDE_DIRECTIVE: params.overrideDirective }),
      ...(params.chatSource && { ANT_CHAT_SOURCE: 'true' }),
      // chat SSOT §6 — pre-allocated turnId from /chat/user-message
      ...(params.seedTurnId && { ANT_SEED_TURN_ID: params.seedTurnId }),
    };
    
    return spawn('npx', ['tsx', ...args], {
      cwd: packageRoot,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false
    });
  }

  /**
   * Setup log streaming for child process
   */
  private setupLogStreaming(jobId: string, childProcess: ChildProcess): void {
    const state = this.stateTracker.getState();
    let stdoutBuffer = '';
    let stderrBuffer = '';
    
    const flushBuffer = (buffer: string, type: 'stdout' | 'stderr') => {
      if (!buffer) return;
      
      const logEntry: LogEntry = {
        type,
        message: buffer,
        timestamp: new Date().toISOString()
      };
      
      this.stateTracker.addLog(jobId, logEntry);
      
      if (type === 'stdout') {
        process.stdout.write(buffer);
      } else {
        process.stderr.write(buffer);
      }
    };
    
    childProcess.stdout?.on('data', (data: Buffer) => {
      stdoutBuffer += data.toString();
      let newlineIndex;
      while ((newlineIndex = stdoutBuffer.indexOf('\n')) !== -1) {
        const line = stdoutBuffer.substring(0, newlineIndex + 1);
        stdoutBuffer = stdoutBuffer.substring(newlineIndex + 1);
        flushBuffer(line, 'stdout');
      }
    });
    
    childProcess.stderr?.on('data', (data: Buffer) => {
      stderrBuffer += data.toString();
      let newlineIndex;
      while ((newlineIndex = stderrBuffer.indexOf('\n')) !== -1) {
        const line = stderrBuffer.substring(0, newlineIndex + 1);
        stderrBuffer = stderrBuffer.substring(newlineIndex + 1);
        flushBuffer(line, 'stderr');
      }
    });
    
    // Store buffer references for final flush
    (childProcess as any)._stdoutBuffer = () => stdoutBuffer;
    (childProcess as any)._stderrBuffer = () => stderrBuffer;
  }

  /**
   * Wait for child process to complete
   */
  private async waitForProcess(
    jobId: string, 
    childProcess: ChildProcess, 
    params: ExecuteJobParams
  ): Promise<void> {
    const state = this.stateTracker.getState();
    
    return new Promise<void>((resolve, reject) => {
      childProcess.on('exit', async (code, signal) => {
        state.childProcesses.delete(jobId);
        
        // Flush remaining buffers
        const stdoutBuffer = (childProcess as any)._stdoutBuffer?.() || '';
        const stderrBuffer = (childProcess as any)._stderrBuffer?.() || '';
        
        if (stdoutBuffer) this.flushFinalBuffer(jobId, stdoutBuffer, 'stdout');
        if (stderrBuffer) this.flushFinalBuffer(jobId, stderrBuffer, 'stderr');
        
        if (code === 0) {
          await this.handleSuccessfulExit(jobId, params);
          resolve();
        } else {
          await this.handleFailedExit(jobId, params, code, signal);
          
          // Check if user stopped (don't reject in that case)
          if (this.stateTracker.isUserStopped(jobId)) {
            this.stateTracker.clearUserStopped(jobId);
            resolve();
          } else {
            const status = state.jobs.get(jobId);
            reject(new Error(status?.error || 'Unknown error'));
          }
        }
      });
      
      childProcess.on('error', async (error) => {
        state.childProcesses.delete(jobId);
        await this.handleProcessError(jobId, params, error);
        reject(error);
      });
    });
  }

  /**
   * Flush final buffer content
   */
  private flushFinalBuffer(jobId: string, buffer: string, type: 'stdout' | 'stderr'): void {
    const logEntry: LogEntry = {
      type,
      message: buffer,
      timestamp: new Date().toISOString()
    };
    this.stateTracker.addLog(jobId, logEntry);
  }

  /**
   * Handle successful process exit
   */
  private async handleSuccessfulExit(jobId: string, params: ExecuteJobParams): Promise<void> {
    const mapping = this.stateTracker.getJobMapping(jobId);
    let interruption: InterruptionDetails | undefined;
    
    // Check session for interruption details (even with exit code 0)
    if (mapping) {
      try {
        const sessionData = await this.deps.sessionService.readSessionData(
          mapping.projectId, 
          mapping.featureName || 'skeleton',
          mapping.jobType || 'code',
          mapping.userContext
        );
        
        if (sessionData?.state?.interruption) {
          interruption = sessionData.state.interruption;
          this.stateTracker.updateJobStatus(jobId, {
            status: 'paused',
            completedAt: new Date().toISOString()
          });
          
          this.stateTracker.addLog(jobId, {
            type: 'stdout',
            message: `\n⏸️  Job paused: ${interruption?.message || 'Unknown reason'}`,
            timestamp: new Date().toISOString()
          });
        } else {
          this.stateTracker.updateJobStatus(jobId, {
            status: 'completed',
            completedAt: new Date().toISOString()
          });
          
          this.stateTracker.addLog(jobId, {
            type: 'stdout',
            message: '\n✅ Job completed successfully!',
            timestamp: new Date().toISOString()
          });
        }
      } catch (error) {
        logger.warn(`Failed to read session for interruption check`, { 
          component: 'JobExecutionManager', 
          jobId 
        }, error);
        
        this.stateTracker.updateJobStatus(jobId, {
          status: 'completed',
          completedAt: new Date().toISOString()
        });
      }
    }
    
    await this.onJobComplete(jobId, params.project, params.feature, interruption);
  }

  /**
   * Handle failed process exit
   */
  private async handleFailedExit(
    jobId: string, 
    params: ExecuteJobParams, 
    code: number | null, 
    signal: NodeJS.Signals | null
  ): Promise<void> {
    const isUserStop = code === 143 || signal === 'SIGTERM';
    
    this.stateTracker.updateJobStatus(jobId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      error: signal ? `Killed by ${signal}` : `Exit code: ${code}`
    });
    
    // Only add error message if NOT a user stop
    if (!isUserStop) {
      this.stateTracker.addLog(jobId, {
        type: 'stderr',
        message: signal 
          ? `\n🛑 Job stopped by user (${signal})`
          : `\n❌ Job failed with exit code ${code}`,
        timestamp: new Date().toISOString()
      });
    }
    
    // Analyze logs to determine interruption reason
    const interruption = this.analyzeFailureReason(jobId, code, signal, isUserStop);
    
    // Don't cleanup if user explicitly stopped (already handled in Stop API)
    if (this.stateTracker.isUserStopped(jobId)) {
      logger.debug(`Job was user-stopped; skipping exit handler cleanup`, { 
        component: 'JobExecutionManager', 
        jobId 
      });
      return;
    }
    
    await this.onJobComplete(jobId, params.project, params.feature, interruption);
  }

  /**
   * Analyze failure reason from logs
   */
  private analyzeFailureReason(
    jobId: string, 
    code: number | null, 
    signal: NodeJS.Signals | null,
    isUserStop: boolean
  ): InterruptionDetails | undefined {
    if (isUserStop) {
      return {
        reason: 'user_stopped',
        message: 'Task stopped by user',
        timestamp: new Date().toISOString(),
        canResume: true,
        metadata: {
          exitCode: code,
          signal: signal || 'SIGTERM',
          stoppedBy: 'user_action'
        }
      };
    }
    
    if (signal) {
      return undefined;
    }
    
    // Analyze stderr logs
    const allLogs = this.stateTracker.getLogs(jobId);
    const stderrLogs = allLogs
      .filter(log => log.type === 'stderr')
      .map(log => log.message)
      .join('\n');
    
    // Check for API error patterns
    if (stderrLogs.match(/overloaded_error|overloaded/i)) {
      return {
        reason: 'api_error',
        message: 'LLM API is currently overloaded. Please try again in a few moments.',
        timestamp: new Date().toISOString(),
        canResume: true,
        metadata: { errorType: 'api_overloaded', exitCode: code }
      };
    }
    
    if (stderrLogs.match(/rate_limit_error|rate.*limit/i)) {
      return {
        reason: 'api_error',
        message: 'LLM API rate limit exceeded. Please wait before resuming.',
        timestamp: new Date().toISOString(),
        canResume: true,
        metadata: { errorType: 'rate_limit', exitCode: code }
      };
    }
    
    if (stderrLogs.match(/invalid_api_key|authentication_error|unauthorized/i)) {
      return {
        reason: 'api_error',
        message: 'LLM API authentication failed. Please check your API key.',
        timestamp: new Date().toISOString(),
        canResume: false,
        metadata: { errorType: 'authentication', exitCode: code }
      };
    }
    
    if (stderrLogs.match(/404.*?model.*?not.*?found/i)) {
      const modelNameMatch = stderrLogs.match(/model:\s*([^\s"]+)/i);
      const modelName = modelNameMatch ? modelNameMatch[1] : 'unknown';
      return {
        reason: 'api_error',
        message: `LLM model not found or unavailable: ${modelName}`,
        timestamp: new Date().toISOString(),
        canResume: false,
        metadata: { errorType: 'model_not_found', modelName, exitCode: code }
      };
    }
    
    if (stderrLogs.match(/Error:.*?"type":\s*"error"|api.*error|llm.*error|llm.*api.*failed|critical.*error.*llm/i)) {
      return {
        reason: 'api_error',
        message: 'LLM API error occurred. Check logs for details.',
        timestamp: new Date().toISOString(),
        canResume: true,
        metadata: { errorType: 'unknown_api_error', exitCode: code }
      };
    }
    
    // Process crash
    return {
      reason: 'process_crash',
      message: `Process crashed with exit code ${code}`,
      timestamp: new Date().toISOString(),
      canResume: true,
      metadata: { exitCode: code, signal }
    };
  }

  /**
   * Handle process error
   */
  private async handleProcessError(
    jobId: string, 
    params: ExecuteJobParams, 
    error: Error
  ): Promise<void> {
    this.stateTracker.updateJobStatus(jobId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      error: error.message
    });
    
    this.stateTracker.addLog(jobId, {
      type: 'stderr',
      message: `\n❌ Process error: ${error.message}`,
      timestamp: new Date().toISOString()
    });
    
    const interruption: InterruptionDetails = {
      reason: 'process_crash',
      message: `Process error: ${error.message}`,
      timestamp: new Date().toISOString(),
      canResume: true,
      metadata: {
        errorType: 'process_error',
        errorMessage: error.message
      }
    };
    
    await this.onJobComplete(jobId, params.project, params.feature, interruption);
  }

  /**
   * Handle job execution error
   */
  private async handleJobError(
    jobId: string, 
    params: ExecuteJobParams, 
    error: Error
  ): Promise<void> {
    this.stateTracker.updateJobStatus(jobId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      error: error.message
    });
    
    this.stateTracker.addLog(jobId, {
      type: 'stderr',
      message: `\n❌ Job failed: ${error.message}`,
      timestamp: new Date().toISOString()
    });
    
    // Only cleanup if not already cleaned up
    const state = this.stateTracker.getState();
    if (state.jobs.has(jobId) || state.jobToProject.has(jobId)) {
      const interruption: InterruptionDetails = {
        reason: 'unknown',
        message: `Job execution failed: ${error.message}`,
        timestamp: new Date().toISOString(),
        canResume: true,
        metadata: {
          errorType: 'execution_failure',
          errorMessage: error.message,
          stack: (error as any).stack
        }
      };
      
      await this.onJobComplete(jobId, params.project, params.feature, interruption);
    }
  }

  /**
   * Get job status
   */
  getJobStatus(jobId: string): JobStatus | undefined {
    return this.stateTracker.getJobStatus(jobId);
  }

  /**
   * Get logs for a job
   */
  getLogs(jobId: string): LogEntry[] {
    return this.stateTracker.getLogs(jobId);
  }

  /**
   * Stream logs (async generator)
   */
  async *streamLogs(jobId: string): AsyncIterableIterator<LogEntry> {
    const logs = this.getLogs(jobId);
    for (const log of logs) {
      yield log;
    }
  }
}
