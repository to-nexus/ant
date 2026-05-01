/**
 * HTTP Server Port
 * 
 * Defines the contract for HTTP server implementations.
 * This allows the core domain to be independent of specific HTTP frameworks.
 */

import { UserContext } from '../types/user';
import type { FileNode, FileResource } from '@ant/shared';

export type { FileNode, FileResource };

export interface LogEntry {
  type: 'info' | 'stdout' | 'stderr' | 'error';
  message: string;
  timestamp: string;
}

export interface JobStatus {
  jobId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'paused';  // ✅ Added 'paused' for recursion limit / interruptions
  task?: 'design' | 'code' | 'learn' | 'review' | 'plan' | 'doc' | 'visual' | 'inline-ask';  // ✅ Track the job type
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface ExecuteJobParams {
  agent: 'architect' | 'reviewer' | 'planner' | 'doc' | 'creator';
  jobType: 'design' | 'code' | 'learn' | 'review' | 'plan' | 'doc' | 'inline-ask' | 'visual';  // ✅ Type of job to execute
  project: string;
  feature?: string;  // ✅ Feature name for Kanban tracking
  inputFile?: string;  // ✅ Optional: undefined for chat-initiated jobs with overrideDirective
  mode?: 'generate' | 'refactor' | 'explain';
  enableEvaluation?: boolean;
  overrideDirective?: string;  // ✅ Chat input as directive (highest priority)
  chatSource?: boolean;        // ✅ True if job started from chat (enables Chat SSE)
  skipTriage?: boolean;        // ✅ Skip triage node (e.g., after user selects "proceed" on redirect)
  actionMetadata?: import('@ant/shared').ActionMetadata;  // ✅ Structured context from Actions panel
  userContext?: UserContext;   // ✅ User context for Cloud mode
  jobId?: string;              // ✅ Existing jobId for resume (don't generate new one)
  isResume?: boolean;          // ✅ True if this is a resume/continue of a previous job
  /**
   * Pre-allocated turn id from `/chat/user-message`. When present, the
   * worker MUST reuse this id and skip writing a second user_turn line
   * (the API already wrote it). Forwarded to BullMQ payload.seedTurnId
   * so cloud workers receive the same hint.
   */
  seedTurnId?: string;
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
