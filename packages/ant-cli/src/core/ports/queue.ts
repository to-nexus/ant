/**
 * Job Queue Port
 * 
 * Interface for job queue management in ant-cli.
 * Abstracts job execution from the API layer.
 * 
 * Implementations:
 * - LocalJobQueue: Direct process spawn (local mode)
 * - BullMQJobQueue: Redis-based queue (cloud mode)
 * 
 * @see 10-cloud-scalability-design.md Section 3.2.2
 */

import { ExecuteJobParams } from './http';
import { UserContext } from '../types/user';

// ============================================
// Job Payload Types (for cloud-ready interface)
// ============================================

export interface JobPayload {
  jobId: string;
  type: 'code' | 'design' | 'learn';
  agent: 'architect' | 'reviewer' | 'planner' | 'doc';
  projectId: string;
  feature: string;
  featureName: string;  // Alias for feature (used in status tracking)
  userContext: UserContext;
  workspacePath?: string;  // For distributed workers
  
  // Job configuration
  mode?: 'generate' | 'refactor' | 'explain';
  overrideDirective?: string;
  chatSource?: boolean;
  enableEvaluation?: boolean;
  inputFile?: string;
  
  // Queue management
  priority?: number;
  
  // Resume support
  isResume?: boolean;
  originalJobId?: string;
}

// ============================================
// Job Progress Types
// ============================================

export interface JobProgress {
  jobId: string;
  phase: 'pending' | 'starting' | 'running' | 'completing' | 'completed' | 'failed' | 'paused';
  step?: string;         // Current step name
  progress?: number;     // Progress percentage (0-100)
  message?: string;
  
  // Task progress
  currentTask?: string;
  completedTaskCount?: number;
  totalTaskCount?: number;
  
  // Recursion tracking
  recursionCount?: number;
  recursionLimit?: number;
  
  // Timestamps
  timestamp?: string;
}

// ============================================
// Job Execution Result Types
// ============================================

export interface JobExecutionResult {
  jobId: string;
  success: boolean;
  message?: string;
  error?: string;
  output?: any;  // Job output data
  
  // Failure details
  missingMaterials?: string[];
  
  // Interruption info (for resumable jobs)
  interruption?: {
    reason: string;
    message: string;
    canResume: boolean;
    metadata?: Record<string, any>;
  };
  
  // Timing
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
}

// ============================================
// JobQueuePort Interface (Cloud-ready)
// ============================================

export type JobQueueStatusValue = 
  | 'pending' 
  | 'queued'      // Waiting in queue
  | 'running' 
  | 'completed' 
  | 'failed' 
  | 'paused' 
  | 'cancelled'
  | 'unknown'     // Status cannot be determined
  | null;

/**
 * Queue position information for a job
 */
export interface QueuePositionInfo {
  status: JobQueueStatusValue;
  position: number | null;   // 1-based index, null if not queued
  totalWaiting: number;      // Total jobs waiting in queue
  estimatedWaitMs?: number;  // Estimated wait time in milliseconds (optional)
}

export interface JobQueuePort {
  /**
   * Enqueue a job for execution
   * @returns jobId
   */
  enqueue(payload: JobPayload): Promise<string>;
  
  /**
   * Get job queue status
   */
  getStatus(jobId: string): Promise<JobQueueStatusValue>;
  
  /**
   * Get job's position in queue
   */
  getQueuePosition(jobId: string): Promise<QueuePositionInfo>;
  
  /**
   * Cancel a running or pending job
   */
  cancel(jobId: string): Promise<void>;
  
  /**
   * Register progress callback
   * @returns Unsubscribe function
   */
  onProgress(jobId: string, callback: (progress: JobProgress) => void): () => void;
  
  /**
   * Register completion callback
   * @returns Unsubscribe function
   */
  onComplete(jobId: string, callback: (result: JobExecutionResult) => void): () => void;
  
  /**
   * Get queue statistics
   */
  getQueueStats(): Promise<{
    pending: number;
    running: number;
    completed: number;
    failed: number;
  }>;
  
  /**
   * Cleanup and close connections
   */
  close(): Promise<void>;
}

// ============================================
// Legacy Types (for backward compatibility)
// ============================================

export interface JobRequest {
  id: string;
  userId: string;
  organizationId: string;
  params: ExecuteJobParams;
  priority: number;
  createdAt: Date;
}

/**
 * Job Queue Status (legacy - for existing code compatibility)
 */
export interface JobQueueStatus {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress?: number;
  result?: any;
  error?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

/**
 * Legacy JobQueuePort interface (for backward compatibility with MemoryJobQueue)
 * @deprecated Use JobQueuePort instead
 */
export interface LegacyJobQueuePort {
  enqueue(job: JobRequest): Promise<string>;
  dequeue(): Promise<JobRequest | null>;
  getJobStatus(jobId: string): Promise<JobQueueStatus>;
  getUserJobs(userId: string): Promise<JobQueueStatus[]>;
  cancelJob(jobId: string): Promise<void>;
}
