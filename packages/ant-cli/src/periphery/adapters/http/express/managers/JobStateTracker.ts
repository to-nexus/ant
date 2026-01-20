import { JobStatus, LogEntry } from '../../../../../core/ports';
import { UserContext } from '../../../../../core/types/user';
import { logger } from '../../../../../utils/logger';
import { JobExecutionState, TaskQueueSnapshot, JobProjectMapping } from '../types';

/**
 * JobStateTracker
 * 
 * Manages in-memory state for job execution tracking.
 * Handles task queue snapshots, job-to-project mappings, and live data.
 */
export class JobStateTracker {
  private state: JobExecutionState;

  constructor() {
    this.state = {
      jobs: new Map(),
      logs: new Map(),
      logStreams: new Map(),
      sseResponses: new Map(),
      childProcesses: new Map(),
      currentJobId: null,
      taskQueueSnapshots: new Map(),
      jobToProject: new Map(),
      userStoppedJobs: new Set()
    };
  }

  /**
   * Get the complete state object (for external access)
   */
  getState(): JobExecutionState {
    return this.state;
  }

  /**
   * Get current job ID (singleton pattern)
   */
  getCurrentJobId(): string | null {
    // Priority 1: Environment variable (for child processes)
    if (process.env.ANT_JOB_ID) {
      return process.env.ANT_JOB_ID;
    }
    // Priority 2: Instance (for parent process)
    return this.state.currentJobId;
  }

  /**
   * Set current job ID
   */
  setCurrentJobId(jobId: string | null): void {
    this.state.currentJobId = jobId;
  }

  /**
   * Initialize job tracking
   */
  initializeJob(
    jobId: string, 
    projectId: string, 
    featureName: string, 
    jobType: 'design' | 'code' | 'learn',
    userContext?: UserContext
  ): void {
    // Initialize job status
    this.state.jobs.set(jobId, {
      jobId,
      status: 'pending',
      task: jobType,
      startedAt: new Date().toISOString()
    });

    // Initialize logs
    this.state.logs.set(jobId, []);

    // Map job to project/feature
    this.state.jobToProject.set(jobId, { 
      projectId, 
      featureName, 
      jobType, 
      userContext 
    });

    logger.debug(`Job initialized`, { 
      component: 'JobStateTracker', 
      jobId, 
      projectId, 
      featureName 
    });
  }

  /**
   * Update task queue snapshot (called by orchestrator during execution)
   */
  updateTaskQueue(
    jobId: string, 
    currentTask: any, 
    queue: any[], 
    completedTasks?: any[],
    recursionCount?: number,
    recursionLimit?: number
  ): void {
    logger.debug(`updateTaskQueue`, {
      component: 'JobStateTracker',
      jobId
    }, {
      currentTask: currentTask?.name || null,
      queueLength: queue.length,
      completedTasks: completedTasks !== undefined ? completedTasks.length : undefined,
      recursionCount,
      recursionLimit
    });
    
    // Preserve existing completed tasks if not provided
    const existingSnapshot = this.state.taskQueueSnapshots.get(jobId);
    const finalCompletedTasks = completedTasks !== undefined 
      ? completedTasks 
      : (existingSnapshot?.completedTasks || []);
    
    // Read recursion limit from environment variable
    const MIN_RECURSION_LIMIT = 5;
    const envRecursionLimit = parseInt(process.env.RECURSION_LIMIT || '', 10);
    const defaultRecursionLimit = (isNaN(envRecursionLimit) || envRecursionLimit < MIN_RECURSION_LIMIT) 
      ? 50
      : envRecursionLimit;
    
    // Update snapshot
    this.state.taskQueueSnapshots.set(jobId, { 
      currentTask,
      queue,
      completedTasks: finalCompletedTasks,
      recursionCount: recursionCount || existingSnapshot?.recursionCount || 0,
      recursionLimit: recursionLimit || existingSnapshot?.recursionLimit || defaultRecursionLimit
    });
  }

  /**
   * Get task queue snapshot
   */
  getTaskQueueSnapshot(jobId: string): TaskQueueSnapshot | undefined {
    return this.state.taskQueueSnapshots.get(jobId);
  }

  /**
   * Get job-to-project mapping
   */
  getJobMapping(jobId: string): JobProjectMapping | undefined {
    return this.state.jobToProject.get(jobId);
  }

  /**
   * Get job status
   */
  getJobStatus(jobId: string): JobStatus | undefined {
    return this.state.jobs.get(jobId);
  }

  /**
   * Update job status
   */
  updateJobStatus(jobId: string, updates: Partial<JobStatus>): void {
    const current = this.state.jobs.get(jobId);
    if (current) {
      this.state.jobs.set(jobId, { ...current, ...updates });
    }
  }

  /**
   * Get logs for a job
   */
  getLogs(jobId: string): LogEntry[] {
    return this.state.logs.get(jobId) || [];
  }

  /**
   * Add log entry
   */
  addLog(jobId: string, log: LogEntry): void {
    const logs = this.state.logs.get(jobId);
    if (logs) {
      logs.push(log);
      // Notify log stream listeners
      this.state.logStreams.get(jobId)?.forEach(listener => listener(log));
    }
  }

  /**
   * Mark job as user-stopped (to prevent duplicate cleanup)
   */
  markUserStopped(jobId: string): void {
    this.state.userStoppedJobs.add(jobId);
  }

  /**
   * Check if job was user-stopped
   */
  isUserStopped(jobId: string): boolean {
    return this.state.userStoppedJobs.has(jobId);
  }

  /**
   * Clear user-stopped flag
   */
  clearUserStopped(jobId: string): void {
    this.state.userStoppedJobs.delete(jobId);
  }

  /**
   * Clean up job state (called when job is terminated)
   */
  cleanup(jobId: string): void {
    logger.debug(`Cleaning up job state`, { component: 'JobStateTracker', jobId });
    
    this.state.taskQueueSnapshots.delete(jobId);
    this.state.jobToProject.delete(jobId);
    this.state.jobs.delete(jobId);
    
    if (this.state.currentJobId === jobId) {
      this.state.currentJobId = null;
    }
  }

  /**
   * Check if job is completed (all tasks done)
   */
  isJobCompleted(sessionState: any): boolean {
    const hasNoRemainingWork = 
      (!sessionState.taskQueue || sessionState.taskQueue.length === 0) &&
      !sessionState.currentTask;
    
    const hasCompletionMarker = 
      (sessionState.completedTasks && sessionState.completedTasks.length > 0) ||
      sessionState.jobTiming?.completedAt;
    
    return hasNoRemainingWork && hasCompletionMarker;
  }

  /**
   * Clear all state (for shutdown)
   */
  clearAll(): void {
    this.state.taskQueueSnapshots.clear();
    this.state.jobToProject.clear();
    this.state.jobs.clear();
    this.state.logs.clear();
    this.state.logStreams.clear();
    this.state.sseResponses.clear();
    this.state.currentJobId = null;
  }
}
