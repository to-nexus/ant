/**
 * Job & Timing Types
 * 
 * Defines job types and job-level timing shared across BE and FE.
 */

/** All job types in the system */
export type JobType = 'code' | 'design' | 'learn' | 'ask' | 'plan' | 'inline-ask' | 'visual';

/** Job types that use task decomposition and Kanban tracking */
export type DecomposableJobType = Exclude<JobType, 'ask' | 'plan' | 'inline-ask' | 'visual'>;

/** Job types that maintain session files (decomposable + planning + visual) */
export type SessionableJobType = DecomposableJobType | 'plan' | 'visual';

/**
 * Non-task jobs — long-running sessionable jobs that DO NOT use task
 * decomposition. These pause via clarify cards (LLM conversation channel)
 * rather than the task-resume / interruption flow used by decomposable jobs.
 *
 * Universal invariants gated on this set live in
 * `useChatSubmit` / `useJobExecution` / `ClarifyingVariant` (FE),
 * `JobExecutionManager` / `JobCleanupManager` / `chatService` (BE).
 */
export const NON_TASK_JOB_TYPES = ['plan', 'visual'] as const;
export type NonTaskJobType = typeof NON_TASK_JOB_TYPES[number];

export function isNonTaskJob(jobType: string | undefined | null): jobType is NonTaskJobType {
  return jobType === 'plan' || jobType === 'visual';
}

/** Sessionable + non-task — the union actually persisted to disk under `sessions/{agent}/`. */
export const SESSIONABLE_JOB_TYPES = ['code', 'design', 'learn', 'plan', 'visual'] as const satisfies readonly SessionableJobType[];

export function isSessionableJobType(jobType: string | undefined | null): jobType is SessionableJobType {
  return jobType === 'code' || jobType === 'design' || jobType === 'learn' || jobType === 'plan' || jobType === 'visual';
}

/**
 * Job types that the BE entry layer (`executeJob` / `JobExecutionManager`)
 * is allowed to dispatch — superset of `SessionableJobType` plus the
 * non-sessionable lightweight runner (`inline-ask`).
 *
 * `SessionableJobType` is the SSOT for "does this job persist a session
 * file under `sessions/{agent}/`?" — that answer is `false` for inline-ask
 * (it's a stateless probe of the interrupted session that runs LLM-based
 * intent classification and either responds in chat, redirects, or
 * triggers a continue/dismiss). Keeping inline-ask out of the sessionable
 * union preserves the I1 invariant against silent jobType downcast.
 *
 * However the spawn / enqueue path still has to accept it, otherwise the
 * `/projects/:id/features/:feature/inline-ask` HTTP route hits the
 * sessionable-only guard and 500s — `vast-curling-perch` resume blocker.
 *
 * Downstream invariants:
 *   - `BullMQJobQueue.enqueue` — accepts any executable type, routes by `jobType`.
 *   - `JobWorker.processJob` — jobType-blind, spawns child with `params.jobType` arg.
 *   - `composition/orchestrator.ts` — has explicit `inline-ask` branch (line ~140) that
 *     dispatches to `runInlineAsk` (no session, no kanban).
 *   - `JobExecutionManager.handleSuccessfulExit` — must skip session-read when
 *     `mapping.jobType === 'inline-ask'` (no session file to read).
 */
export type ExecutableJobType = SessionableJobType | 'inline-ask';

export function isExecutableJobType(jobType: string | undefined | null): jobType is ExecutableJobType {
  return isSessionableJobType(jobType) || jobType === 'inline-ask';
}

/** Job-level timing (entire code/design/learn job lifecycle) */
export interface JobTiming {
  startedAt: string;
  lastResumedAt?: string;
  pausedAt?: string;
  completedAt?: string;
  totalPausedDuration: number;
  estimatingDuration?: number;
  /** Individual pre-task node durations in ms (e.g., { resolve: 1200, detect: 4100 }) */
  phaseBreakdown?: Record<string, number>;
}
