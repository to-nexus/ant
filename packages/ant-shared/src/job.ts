/**
 * Job & Timing Types
 * 
 * Defines job types and job-level timing shared across BE and FE.
 */

/** All job types in the system */
export type JobType = 'code' | 'design' | 'learn' | 'ask' | 'plan' | 'inline-ask';

/** Job types that use task decomposition and Kanban tracking */
export type DecomposableJobType = Exclude<JobType, 'ask' | 'plan' | 'inline-ask'>;

/** Job types that maintain session files (decomposable + planning) */
export type SessionableJobType = DecomposableJobType | 'plan';

/** Job-level timing (entire code/design/learn job lifecycle) */
export interface JobTiming {
  startedAt: string;
  lastResumedAt?: string;
  pausedAt?: string;
  completedAt?: string;
  totalPausedDuration: number;
  estimatingDuration?: number;
  totalElapsedTime?: number;
  /** Individual pre-task node durations in ms (e.g., { resolve: 1200, detect: 4100 }) */
  phaseBreakdown?: Record<string, number>;
}
