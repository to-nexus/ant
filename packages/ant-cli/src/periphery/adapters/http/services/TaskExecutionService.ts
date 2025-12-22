import { spawn, ChildProcess } from 'child_process';
import { 
  ExecuteJobParams, 
  JobResult, 
  JobStatus, 
  LogEntry 
} from '../../../../core/ports/http';
import * as path from 'path';
import { WorkspaceResolver } from '../../../../infrastructure/workspace/WorkspaceResolver';

/**
 * TaskExecutionService
 * 
 * Manages agent job execution via child processes.
 * Handles process spawning, log streaming, and lifecycle management.
 * 
 * Note: "Job" refers to an agent execution instance, not Task Board tasks.
 */
export class TaskExecutionService {
  // Job tracking (agent execution instances)
  private jobs: Map<string, JobStatus> = new Map();
  private logs: Map<string, LogEntry[]> = new Map();
  private logStreams: Map<string, Set<(log: LogEntry) => void>> = new Map();
  private childProcesses: Map<string, ChildProcess> = new Map();
  
  // Current jobId being executed (for CLI subprocess to access)
  private currentJobId: string | null = null;
  
  // ✅ WorkspaceResolver for path resolution
  private workspaceResolver: WorkspaceResolver;
  
  // Callbacks
  private onJobStatusChange?: (jobId: string, status: JobStatus) => void;
  private onLogEntry?: (jobId: string, log: LogEntry) => void;
  private onJobCompleted?: (jobId: string) => Promise<void>;
  
  constructor(
    workspaceResolver: WorkspaceResolver,
    callbacks?: {
      onJobStatusChange?: (jobId: string, status: JobStatus) => void;
      onLogEntry?: (jobId: string, log: LogEntry) => void;
      onJobCompleted?: (jobId: string) => Promise<void>;
  }) {
    this.workspaceResolver = workspaceResolver;
    this.onJobStatusChange = callbacks?.onJobStatusChange;
    this.onLogEntry = callbacks?.onLogEntry;
    this.onJobCompleted = callbacks?.onJobCompleted;
  }
  
  /**
   * Get current job ID (for CLI subprocess)
   */
  getCurrentJobId(): string | null {
    return this.currentJobId;
  }
  
  /**
   * Execute an agent job asynchronously
   */
  async executeJob(params: ExecuteJobParams): Promise<JobResult> {
    const jobId = `${Date.now().toString(36)}${Math.random().toString(36).substr(2, 6)}`;
    
    // Initialize job tracking
    const jobStatus: JobStatus = {
      jobId,
      status: 'pending',
      task: params.jobType,  // ✅ Track the job type
      startedAt: new Date().toISOString()
    };
    
    this.jobs.set(jobId, jobStatus);
    this.logs.set(jobId, []);
    
    // Notify status change
    this.onJobStatusChange?.(jobId, jobStatus);
    
    // Start job execution in child process (non-blocking)
    this.runJob(jobId, params).catch(error => {
      console.error(`Job ${jobId} failed:`, error);
    });

    return {
      jobId,
      success: true,
      message: 'Job started'
    };
  }
  
  /**
   * Run task in child process
   */
  private async runJob(jobId: string, params: ExecuteJobParams): Promise<void> {
    const status = this.jobs.get(jobId)!;
    status.status = 'running';
    this.onJobStatusChange?.(jobId, status);
    
    // Set current jobId for CLI subprocess to access
    this.currentJobId = jobId;
    
    try {
      // Build ant CLI command - use commander structure: aidev <agent> <task> <input>
      const antCliSrc = path.join(process.cwd(), 'src/index.ts');
      const args = [
        antCliSrc,
        params.agent,      // e.g., 'architect'
        params.jobType     // e.g., 'code'
      ];
      
      // Add input file or feature path as positional argument
      // ✅ If no inputFile (chat-initiated), use feature path instead
      if (params.inputFile) {
        args.push(params.inputFile);
      } else if (params.feature && params.userContext) {
        const featurePath = this.workspaceResolver.getFeaturePath(
          params.userContext,
          params.project,
          params.feature
        );
        args.push(featurePath);
      }
      
      // Add options (only for tasks that support them)
      if (params.mode && params.jobType === 'code') {
        args.push('--mode', params.mode);
      }
      
      if (params.project) {
        args.push('--project', params.project);
      }
      
      if (params.enableEvaluation && params.jobType === 'code') {
        args.push('--eval');
      }
      
      console.log(`[TaskExecutionService] 🚀 Spawning CLI with args:`, args);
      
      
      // ✅ Ensure PATH includes common locations for git and other tools
      const ensuredPath = process.env.PATH 
        ? `${process.env.PATH}:/usr/local/bin:/usr/bin:/bin`
        : '/usr/local/bin:/usr/bin:/bin';
      
      // Spawn child process using tsx
      const childProcess = spawn('npx', ['tsx', ...args], {
        cwd: process.cwd(),
        env: { 
          ...process.env,
          PATH: ensuredPath,  // ✅ Explicitly ensure PATH includes standard locations
          ANT_JOB_ID: jobId,  // For tracking
          ANT_CLI_PORT: process.env.ANT_CLI_PORT || '4100',  // ✅ Ant CLI server port (NOT PORT!)
          ANT_OVERRIDE_DIRECTIVE: params.overrideDirective || '',  // ✅ Chat input as directive
          ANT_CHAT_SOURCE: params.chatSource ? 'true' : 'false'    // ✅ Chat SSE flag
        },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      
      this.childProcesses.set(jobId, childProcess);
      
      // Line buffering for stdout/stderr
      let stdoutBuffer = '';
      let stderrBuffer = '';
      
      const flushBuffer = (buffer: string, type: 'stdout' | 'stderr') => {
        if (!buffer) return;
        
        const logEntry: LogEntry = {
          type,
          message: buffer,
          timestamp: new Date().toISOString()
        };
        
        // Store log
        this.logs.get(jobId)!.push(logEntry);
        
        // Notify listeners
        this.logStreams.get(jobId)?.forEach(listener => listener(logEntry));
        this.onLogEntry?.(jobId, logEntry);
        
        // Also output to server console
        if (type === 'stdout') {
          process.stdout.write(buffer);
        } else {
          process.stderr.write(buffer);
        }
      };
      
      // Capture stdout with line buffering
      childProcess.stdout?.on('data', (data: Buffer) => {
        stdoutBuffer += data.toString();
        
        // Send complete lines
        let newlineIndex;
        while ((newlineIndex = stdoutBuffer.indexOf('\n')) !== -1) {
          const line = stdoutBuffer.substring(0, newlineIndex + 1);
          stdoutBuffer = stdoutBuffer.substring(newlineIndex + 1);
          flushBuffer(line, 'stdout');
        }
      });
      
      // Capture stderr with line buffering
      childProcess.stderr?.on('data', (data: Buffer) => {
        stderrBuffer += data.toString();
        
        // Send complete lines
        let newlineIndex;
        while ((newlineIndex = stderrBuffer.indexOf('\n')) !== -1) {
          const line = stderrBuffer.substring(0, newlineIndex + 1);
          stderrBuffer = stderrBuffer.substring(newlineIndex + 1);
          flushBuffer(line, 'stderr');
        }
      });
      
      // Wait for process to complete
      await new Promise<void>((resolve, reject) => {
        childProcess.on('exit', async (code, signal) => {
          this.childProcesses.delete(jobId);
          
          // Flush any remaining buffered output
          if (stdoutBuffer) {
            flushBuffer(stdoutBuffer, 'stdout');
            stdoutBuffer = '';
          }
          if (stderrBuffer) {
            flushBuffer(stderrBuffer, 'stderr');
            stderrBuffer = '';
          }
          
          if (code === 0) {
            // Mark as completed
            status.status = 'completed';
            status.completedAt = new Date().toISOString();
            this.onJobStatusChange?.(jobId, status);
            
            const logEntry: LogEntry = {
              type: 'stdout',
              message: '\n✅ Job completed successfully!',
              timestamp: new Date().toISOString()
            };
            this.logs.get(jobId)!.push(logEntry);
            this.logStreams.get(jobId)?.forEach(listener => listener(logEntry));
            this.onLogEntry?.(jobId, logEntry);
            
            // Send completion marker
            const completionMarker: LogEntry = {
              type: 'stdout',
              message: '__JOB_COMPLETED__',
              timestamp: new Date().toISOString()
            };
            this.logStreams.get(jobId)?.forEach(listener => listener(completionMarker));
            
            // ✅ CRITICAL: Clean up job state to remove from active jobs
            // This ensures UI switches from "estimating" to "session" data source
            if (this.onJobCompleted) {
              await this.onJobCompleted(jobId).catch(err => {
                console.error(`[TaskExecutionService] Failed to cleanup job state:`, err);
              });
            }
            
            resolve();
          } else {
            // Mark as failed
            status.status = 'failed';
            status.completedAt = new Date().toISOString();
            status.error = signal ? `Killed by ${signal}` : `Exit code: ${code}`;
            this.onJobStatusChange?.(jobId, status);
            
            const logEntry: LogEntry = {
              type: 'stderr',
              message: signal 
                ? `\n🛑 Job stopped by user (${signal})`
                : `\n❌ Job failed with exit code ${code}`,
              timestamp: new Date().toISOString()
            };
            this.logs.get(jobId)!.push(logEntry);
            this.logStreams.get(jobId)?.forEach(listener => listener(logEntry));
            this.onLogEntry?.(jobId, logEntry);
            
            // Send failure marker
            const failureMarker: LogEntry = {
              type: 'stderr',
              message: '__JOB_FAILED__',
              timestamp: new Date().toISOString()
            };
            this.logStreams.get(jobId)?.forEach(listener => listener(failureMarker));
            
            reject(new Error(status.error));
          }
        });
        
        childProcess.on('error', (error) => {
          this.childProcesses.delete(jobId);
          reject(error);
        });
      });
    } catch (error: any) {
      // Mark as failed
      status.status = 'failed';
      status.completedAt = new Date().toISOString();
      status.error = error.message;
      this.onJobStatusChange?.(jobId, status);
      
      const logEntry: LogEntry = {
        type: 'stderr',
        message: `\n❌ Task failed: ${error.message}`,
        timestamp: new Date().toISOString()
      };
      this.logs.get(jobId)!.push(logEntry);
      this.logStreams.get(jobId)?.forEach(listener => listener(logEntry));
      this.onLogEntry?.(jobId, logEntry);
    } finally {
      // Clear current jobId
      if (this.currentJobId === jobId) {
        this.currentJobId = null;
      }
    }
  }
  
  /**
   * Get job status
   */
  getJobStatus(jobId: string): JobStatus | undefined {
    return this.jobs.get(jobId);
  }
  
  /**
   * Get all logs for a job
   */
  getLogs(jobId: string): LogEntry[] {
    return this.logs.get(jobId) || [];
  }
  
  /**
   * Stream logs for a specific job
   */
  async *streamLogs(jobId: string): AsyncIterableIterator<LogEntry> {
    const logs = this.logs.get(jobId) || [];
    
    // Yield existing logs
    for (const log of logs) {
      yield log;
    }
  }
  
  /**
   * Add log stream listener
   */
  addLogListener(jobId: string, listener: (log: LogEntry) => void): void {
    if (!this.logStreams.has(jobId)) {
      this.logStreams.set(jobId, new Set());
    }
    this.logStreams.get(jobId)!.add(listener);
  }
  
  /**
   * Remove log stream listener
   */
  removeLogListener(jobId: string, listener: (log: LogEntry) => void): void {
    this.logStreams.get(jobId)?.delete(listener);
  }
  
  /**
   * Stop a running job
   */
  stopJob(jobId: string): boolean {
    const childProcess = this.childProcesses.get(jobId);
    if (childProcess) {
      childProcess.kill('SIGTERM');
      return true;
    }
    return false;
  }
  
  /**
   * Cleanup job resources
   */
  cleanupJob(jobId: string): void {
    this.logStreams.delete(jobId);
    // Keep logs and status for history
  }
}
