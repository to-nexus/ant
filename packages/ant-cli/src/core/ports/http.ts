/**
 * HTTP Server Port
 * 
 * Defines the contract for HTTP server implementations.
 * This allows the core domain to be independent of specific HTTP frameworks.
 */

export interface LogEntry {
  type: 'info' | 'stdout' | 'stderr' | 'error';
  message: string;
  timestamp: string;
}

export interface TaskStatus {
  taskId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface ExecuteTaskParams {
  agent: 'architect' | 'reviewer' | 'planner' | 'doc';
  task: 'design' | 'code' | 'learn' | 'review' | 'plan' | 'doc';
  project: string;
  inputFile: string;
  mode?: 'generate' | 'refactor' | 'explain';
  enableEvaluation?: boolean;
}

export interface TaskResult {
  taskId: string;
  success: boolean;
  message?: string;
  data?: any;
}

/**
 * Task Execution Port
 * 
 * Abstraction for executing tasks and streaming logs.
 * Implementations can use different execution strategies (sync, async, queued).
 */
export interface TaskExecutionPort {
  /**
   * Execute a task asynchronously
   * Returns immediately with a taskId for tracking
   */
  executeTask(params: ExecuteTaskParams): Promise<TaskResult>;
  
  /**
   * Get current status of a task
   */
  getTaskStatus(taskId: string): TaskStatus | undefined;
  
  /**
   * Stream logs for a specific task
   * Returns an async iterator for real-time log streaming
   */
  streamLogs(taskId: string): AsyncIterableIterator<LogEntry>;
  
  /**
   * Get all logs for a completed task
   */
  getLogs(taskId: string): LogEntry[];
}

/**
 * HTTP Server Port
 * 
 * Abstraction for HTTP server lifecycle management.
 * Allows the application to start/stop HTTP servers without
 * coupling to specific frameworks (Express, Fastify, etc.)
 */
export interface HttpServerPort {
  /**
   * Start the HTTP server on specified port
   */
  start(port: number): Promise<void>;
  
  /**
   * Stop the HTTP server gracefully
   */
  stop(): Promise<void>;
  
  /**
   * Get the current server status
   */
  isRunning(): boolean;
}
