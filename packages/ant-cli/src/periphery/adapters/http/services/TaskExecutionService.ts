import { spawn, ChildProcess } from 'child_process';
import { 
  ExecuteTaskParams, 
  TaskResult, 
  TaskStatus, 
  LogEntry 
} from '../../../../core/ports/http';
import * as path from 'path';

/**
 * TaskExecutionService
 * 
 * Manages task execution via child processes.
 * Handles process spawning, log streaming, and lifecycle management.
 */
export class TaskExecutionService {
  // Task tracking
  private tasks: Map<string, TaskStatus> = new Map();
  private logs: Map<string, LogEntry[]> = new Map();
  private logStreams: Map<string, Set<(log: LogEntry) => void>> = new Map();
  private childProcesses: Map<string, ChildProcess> = new Map();
  
  // Current taskId being executed (for CLI subprocess to access)
  private currentTaskId: string | null = null;
  
  // Callbacks
  private onTaskStatusChange?: (taskId: string, status: TaskStatus) => void;
  private onLogEntry?: (taskId: string, log: LogEntry) => void;
  
  constructor(callbacks?: {
    onTaskStatusChange?: (taskId: string, status: TaskStatus) => void;
    onLogEntry?: (taskId: string, log: LogEntry) => void;
  }) {
    this.onTaskStatusChange = callbacks?.onTaskStatusChange;
    this.onLogEntry = callbacks?.onLogEntry;
  }
  
  /**
   * Get current task ID (for CLI subprocess)
   */
  getCurrentTaskId(): string | null {
    return this.currentTaskId;
  }
  
  /**
   * Execute a task asynchronously
   */
  async executeTask(params: ExecuteTaskParams): Promise<TaskResult> {
    const taskId = `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Initialize task tracking
    const taskStatus: TaskStatus = {
      taskId,
      status: 'pending',
      startedAt: new Date().toISOString()
    };
    
    this.tasks.set(taskId, taskStatus);
    this.logs.set(taskId, []);
    
    // Notify status change
    this.onTaskStatusChange?.(taskId, taskStatus);
    
    // Start task execution in child process (non-blocking)
    this.runTask(taskId, params).catch(error => {
      console.error(`Task ${taskId} failed:`, error);
    });

    return {
      taskId,
      success: true,
      message: 'Task started'
    };
  }
  
  /**
   * Run task in child process
   */
  private async runTask(taskId: string, params: ExecuteTaskParams): Promise<void> {
    const status = this.tasks.get(taskId)!;
    status.status = 'running';
    this.onTaskStatusChange?.(taskId, status);
    
    // Set current taskId for CLI subprocess to access
    this.currentTaskId = taskId;
    
    try {
      // Build ant CLI command - use commander structure: aidev <agent> <task> <input>
      const antCliSrc = path.join(process.cwd(), 'src/index.ts');
      const args = [
        antCliSrc,
        params.agent,      // e.g., 'architect'
        params.task        // e.g., 'code'
      ];
      
      // Add input file as positional argument
      if (params.inputFile) {
        args.push(params.inputFile);
      }
      
      // Add options (only for tasks that support them)
      if (params.mode && params.task === 'code') {
        args.push('--mode', params.mode);
      }
      
      if (params.project) {
        args.push('--project', params.project);
      }
      
      if (params.enableEvaluation && params.task === 'code') {
        args.push('--eval');
      }
      
      console.log(`[Task Execution] Starting task ${taskId}: tsx ${args.join(' ')}`);
      
      // Spawn child process using tsx
      const childProcess = spawn('npx', ['tsx', ...args], {
        cwd: process.cwd(),
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      
      this.childProcesses.set(taskId, childProcess);
      
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
        this.logs.get(taskId)!.push(logEntry);
        
        // Notify listeners
        this.logStreams.get(taskId)?.forEach(listener => listener(logEntry));
        this.onLogEntry?.(taskId, logEntry);
        
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
        childProcess.on('exit', (code, signal) => {
          this.childProcesses.delete(taskId);
          
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
            this.onTaskStatusChange?.(taskId, status);
            
            const logEntry: LogEntry = {
              type: 'stdout',
              message: '\n✅ Task completed successfully!',
              timestamp: new Date().toISOString()
            };
            this.logs.get(taskId)!.push(logEntry);
            this.logStreams.get(taskId)?.forEach(listener => listener(logEntry));
            this.onLogEntry?.(taskId, logEntry);
            
            // Send completion marker
            const completionMarker: LogEntry = {
              type: 'stdout',
              message: '__TASK_COMPLETED__',
              timestamp: new Date().toISOString()
            };
            this.logStreams.get(taskId)?.forEach(listener => listener(completionMarker));
            
            resolve();
          } else {
            // Mark as failed
            status.status = 'failed';
            status.completedAt = new Date().toISOString();
            status.error = signal ? `Killed by ${signal}` : `Exit code: ${code}`;
            this.onTaskStatusChange?.(taskId, status);
            
            const logEntry: LogEntry = {
              type: 'stderr',
              message: signal 
                ? `\n🛑 Task stopped by user (${signal})`
                : `\n❌ Task failed with exit code ${code}`,
              timestamp: new Date().toISOString()
            };
            this.logs.get(taskId)!.push(logEntry);
            this.logStreams.get(taskId)?.forEach(listener => listener(logEntry));
            this.onLogEntry?.(taskId, logEntry);
            
            // Send failure marker
            const failureMarker: LogEntry = {
              type: 'stderr',
              message: '__TASK_FAILED__',
              timestamp: new Date().toISOString()
            };
            this.logStreams.get(taskId)?.forEach(listener => listener(failureMarker));
            
            reject(new Error(status.error));
          }
        });
        
        childProcess.on('error', (error) => {
          this.childProcesses.delete(taskId);
          reject(error);
        });
      });
    } catch (error: any) {
      // Mark as failed
      status.status = 'failed';
      status.completedAt = new Date().toISOString();
      status.error = error.message;
      this.onTaskStatusChange?.(taskId, status);
      
      const logEntry: LogEntry = {
        type: 'stderr',
        message: `\n❌ Task failed: ${error.message}`,
        timestamp: new Date().toISOString()
      };
      this.logs.get(taskId)!.push(logEntry);
      this.logStreams.get(taskId)?.forEach(listener => listener(logEntry));
      this.onLogEntry?.(taskId, logEntry);
    } finally {
      // Clear current taskId
      if (this.currentTaskId === taskId) {
        this.currentTaskId = null;
      }
    }
  }
  
  /**
   * Get task status
   */
  getTaskStatus(taskId: string): TaskStatus | undefined {
    return this.tasks.get(taskId);
  }
  
  /**
   * Get all logs for a task
   */
  getLogs(taskId: string): LogEntry[] {
    return this.logs.get(taskId) || [];
  }
  
  /**
   * Stream logs for a specific task
   */
  async *streamLogs(taskId: string): AsyncIterableIterator<LogEntry> {
    const logs = this.logs.get(taskId) || [];
    
    // Yield existing logs
    for (const log of logs) {
      yield log;
    }
  }
  
  /**
   * Add log stream listener
   */
  addLogListener(taskId: string, listener: (log: LogEntry) => void): void {
    if (!this.logStreams.has(taskId)) {
      this.logStreams.set(taskId, new Set());
    }
    this.logStreams.get(taskId)!.add(listener);
  }
  
  /**
   * Remove log stream listener
   */
  removeLogListener(taskId: string, listener: (log: LogEntry) => void): void {
    this.logStreams.get(taskId)?.delete(listener);
  }
  
  /**
   * Stop a running task
   */
  stopTask(taskId: string): boolean {
    const childProcess = this.childProcesses.get(taskId);
    if (childProcess) {
      childProcess.kill('SIGTERM');
      return true;
    }
    return false;
  }
  
  /**
   * Cleanup task resources
   */
  cleanupTask(taskId: string): void {
    this.logStreams.delete(taskId);
    // Keep logs and status for history
  }
}
