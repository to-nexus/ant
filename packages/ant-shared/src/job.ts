/**
 * Job & Timing Types
 * 
 * Defines job types and job-level timing shared across BE and FE.
 */

/** All job types in the system */
export type JobType = 'code' | 'design' | 'learn' | 'ask' | 'plan' | 'inline-ask' | 'visual' | 'universal';

/**
 * Runtime mirror of the `JobType` union. FE turn projectors parse persisted
 * `jobType` strings against THIS list — a hand-copied subset is exactly how
 * universal turns silently downcast to `'code'`.
 */
export const JOB_TYPES = ['code', 'design', 'learn', 'ask', 'plan', 'inline-ask', 'visual', 'universal'] as const satisfies readonly JobType[];

export function isJobType(value: unknown): value is JobType {
  return typeof value === 'string' && (JOB_TYPES as readonly string[]).includes(value);
}

/** Job types that use task decomposition and Kanban tracking */
export type DecomposableJobType = Exclude<JobType, 'ask' | 'plan' | 'inline-ask' | 'visual' | 'universal'>;

/** Job types that maintain session files (decomposable + planning + visual + universal) */
export type SessionableJobType = DecomposableJobType | 'plan' | 'visual' | 'universal';

/**
 * Non-task jobs — long-running sessionable jobs that DO NOT use task
 * decomposition. These pause via clarify cards (LLM conversation channel)
 * rather than the task-resume / interruption flow used by decomposable jobs.
 *
 * Universal invariants gated on this set live in
 * `useChatSubmit` / `useJobExecution` / `ClarifyingVariant` (FE),
 * `JobExecutionManager` / `JobCleanupManager` / `chatService` (BE).
 */
export const NON_TASK_JOB_TYPES = ['plan', 'visual', 'universal'] as const;
export type NonTaskJobType = typeof NON_TASK_JOB_TYPES[number];

export function isNonTaskJob(jobType: string | undefined | null): jobType is NonTaskJobType {
  return jobType === 'plan' || jobType === 'visual' || jobType === 'universal';
}

/**
 * Whether a job type supports *mid-graph* resume — i.e. resuming continues
 * from where it stopped (a task-queue checkpoint) instead of restarting the
 * whole graph. Only task-decomposable jobs (code/design/learn) checkpoint
 * mid-execution.
 *
 * This answers ONE question ("does a checkpoint exist to resume into?"), not
 * "is this job resumable at all" — see {@link resumeGranularityOf}. Widening
 * it to a type with no task queue would make every checkpoint reader believe
 * in a checkpoint that is not there.
 */
export function isMidGraphResumable(jobType: string | undefined | null): boolean {
  return jobType === 'code' || jobType === 'design' || jobType === 'learn';
}

/**
 * Whether a job type supports *turn-level* resume — resuming re-runs the
 * interrupted instruction on the saved conversation rather than continuing
 * from a checkpoint.
 *
 * The discriminator is what the persisted session IS. For `universal` the
 * session holds the provider transcript itself, so a resumed turn appends to
 * the very history the model saw; the interrupted directive is recoverable
 * from the durable chat log (`recordUserTurn` writes it BEFORE the graph runs).
 * plan/visual persist a session as *context*, not as a transcript, and their
 * runners admit no resumed turn — widening this to them is a separate decision
 * that needs runner work, not a one-line predicate change.
 */
export function isTurnResumable(jobType: string | undefined | null): boolean {
  return jobType === 'universal';
}

/** How a resumed job continues. `null` = this job type cannot be resumed. */
export type ResumeGranularity = 'mid-graph' | 'turn';

/**
 * THE resume-capability owner. `interruption.canResume` and every user-facing
 * wording derive from this one function, so "can it resume" and "how does it
 * resume" can never disagree — the two used to be the same boolean, which is
 * how a universal job ended up with a Resume button the route refused.
 */
export function resumeGranularityOf(jobType: string | undefined | null): ResumeGranularity | null {
  if (isMidGraphResumable(jobType)) return 'mid-graph';
  if (isTurnResumable(jobType)) return 'turn';
  return null;
}

/** Sessionable + non-task — the union actually persisted to disk under `sessions/{agent}/`. */
export const SESSIONABLE_JOB_TYPES = ['code', 'design', 'learn', 'plan', 'visual', 'universal'] as const satisfies readonly SessionableJobType[];

export function isSessionableJobType(jobType: string | undefined | null): jobType is SessionableJobType {
  return jobType === 'code' || jobType === 'design' || jobType === 'learn' || jobType === 'plan' || jobType === 'visual' || jobType === 'universal';
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
