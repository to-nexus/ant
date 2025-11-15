/**
 * HTTP Server Port
 * 
 * Defines the contract for HTTP server implementations.
 * This allows the core domain to be independent of specific HTTP frameworks.
 */

import { UserContext } from '../types/user';

export interface LogEntry {
  type: 'info' | 'stdout' | 'stderr' | 'error';
  message: string;
  timestamp: string;
}

export interface JobStatus {
  jobId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'paused';  // ✅ Added 'paused' for recursion limit / interruptions
  task?: 'design' | 'code' | 'learn' | 'review' | 'plan' | 'doc';  // ✅ Track the job type
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface ExecuteJobParams {
  agent: 'architect' | 'reviewer' | 'planner' | 'doc';
  task: 'design' | 'code' | 'learn' | 'review' | 'plan' | 'doc';  // Note: 'task' here means agent's work type, not Task Board task
  project: string;
  feature?: string;  // ✅ Feature name for Kanban tracking
  inputFile?: string;  // ✅ Optional: undefined for chat-initiated jobs with overrideDirective
  mode?: 'generate' | 'refactor' | 'explain';
  enableEvaluation?: boolean;
  overrideDirective?: string;  // ✅ Chat input as directive (highest priority)
  chatSource?: boolean;        // ✅ True if job started from chat (enables Chat SSE)
  userContext?: UserContext;   // ✅ User context for Cloud mode (includes workspacePath)
}

export interface JobResult {
  jobId: string;
  success: boolean;
  message?: string;
  data?: any;
  error?: string;  // ✅ Error message (e.g., prerequisites validation failure)
  missingMaterials?: Array<{  // ✅ Details about missing prerequisites
    name: string;
    path: string;
    description: string;
    mustHaveContent: boolean;
  }>;
}

export interface Feature {
  name: string;
  path: string;
  createdAt?: string;
}

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

export interface FileContent {
  path: string;
  content: string;
  mimeType?: string;
}

/**
 * Job Execution Port
 * 
 * Abstraction for executing agent jobs and streaming logs.
 * Implementations can use different execution strategies (sync, async, queued).
 * 
 * Note: "Job" refers to an agent execution instance, not Task Board tasks.
 */
export interface JobExecutionPort {
  /**
   * Execute an agent job asynchronously
   * Returns immediately with a jobId for tracking
   */
  executeJob(params: ExecuteJobParams): Promise<JobResult>;
  
  /**
   * Get current status of a job
   */
  getJobStatus(jobId: string): JobStatus | undefined;
  
  /**
   * Stream logs for a specific job
   * Returns an async iterator for real-time log streaming
   */
  streamLogs(jobId: string): AsyncIterableIterator<LogEntry>;
  
  /**
   * Get all logs for a completed job
   */
  getLogs(jobId: string): LogEntry[];
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
