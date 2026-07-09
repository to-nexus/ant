/**
 * Resumable-state verdict — the single owner of "is this session resumable".
 *
 * Historically three readers each hand-wrote this predicate and drifted apart,
 * so a crashed job could show a `canResume=true` Kanban card while the HTTP
 * `/resume` route 404'd and the graph runner fell through to a fresh decompose
 * (code-job-flickering-sparkle RCA). They now all call `deriveResumableState`:
 *
 *   - HTTP resume gate           (job.routes.ts `POST /jobs/:id/resume`)
 *   - Kanban read-side self-heal (KanbanService.getKanbanData Priority-3)
 *   - Graph runner restore gate  (code/runner.ts + design/runner.ts)
 *
 * It operates purely on the persisted `SessionState` shape (the SSOT for "what
 * work is left") and delegates the jobType→`canResume` rule to the existing
 * `@ant/shared` owner `buildInfrastructureInterruption` / `isMidGraphResumable`,
 * so the flag cannot drift from the reasons matrix either.
 */

import type { InterruptionDetails } from '@ant/shared';
import { buildInfrastructureInterruption } from '@ant/shared';
import type { SessionState } from '../types/session';

export interface ResumableVerdict {
  /**
   * Unified "leftover work" definition — the SSOT every reader shares:
   * a persisted queue, an in-flight `currentTask`, or orchestrator
   * `runningTasks` captured by the periodic checkpoint.
   */
  hasResumableWork: boolean;
  /** Genuinely finished: has a completion stamp, no interruption, no leftover work. */
  isJobCompleted: boolean;
  /**
   * The interruption to surface: the explicitly-persisted one if present,
   * else a synthesized `server_crash` (the compensation for a poison-skipped
   * final checkpoint) when leftover work exists, else null.
   */
  interruption: InterruptionDetails | null;
  /** True when `interruption` was synthesized here rather than read from disk. */
  synthesized: boolean;
  /** The single resume verdict all readers consume. */
  canResume: boolean;
}

export function deriveResumableState(
  state: SessionState | undefined,
  jobType: string | null | undefined,
  opts: { isActuallyRunning?: boolean } = {},
): ResumableVerdict {
  const s = state ?? {};
  const isActuallyRunning = opts.isActuallyRunning ?? false;

  const hasResumableWork =
    ((s.taskQueue?.length ?? 0) > 0) ||
    !!s.currentTask ||
    ((s.runningTasks?.length ?? 0) > 0);

  const hasExplicit = !!s.interruption;

  // Genuinely-finished jobs (completed stamp, no interruption, nothing left)
  // must stay non-resumable — this is what keeps a completed session out of
  // the runner's restore path and the resume route's 404.
  const isJobCompleted = !!s.jobTiming?.completedAt && !hasExplicit && !hasResumableWork;

  const interruption: InterruptionDetails | null = hasExplicit
    ? s.interruption!
    : hasResumableWork
      ? buildInfrastructureInterruption('server_crash', jobType)
      : null;

  const canResume =
    hasResumableWork &&
    !isActuallyRunning &&
    !isJobCompleted &&
    interruption?.canResume === true;

  return {
    hasResumableWork,
    isJobCompleted,
    interruption,
    synthesized: !hasExplicit && interruption !== null,
    canResume,
  };
}
