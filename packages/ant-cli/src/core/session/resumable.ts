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

/**
 * How a new graph invocation relates to the session's leftover work.
 *
 * - `resume`         — plain continue of the interrupted queue (API-owned:
 *                      only `/resume` / `/continue` pass `isResume`/env).
 * - `revise-context` — a NEW turn on a not-dismissed, still-resumable session
 *                      with a non-diverging intent: restore the queue as
 *                      revision context; the new turn's directive/metadata
 *                      keep authority.
 * - `fresh`          — no restore at all (dismissed, divergent explicit
 *                      intent, non-resumable, or nothing left).
 */
export type RestoreMode = 'resume' | 'revise-context' | 'fresh';

/**
 * Single owner of the runner restore decision (sharp-choking-glove RCA).
 *
 * Previously each runner hand-rolled `hasResumableWork && (hasInterruption ||
 * orphaned || explicitResume)`, which silently converted a brand-new job —
 * carrying a new directive and a divergent EXPLICIT intent — into a plain
 * resume of the old queue. Two orthogonal axes feed this decision:
 * `verdict.canResume` (work integrity/kind) and `interruption.dismissed`
 * (implicit-continuation consent, withdrawn by dismissing the cancelled card).
 */
export function deriveRestoreMode(params: {
  verdict: ResumableVerdict;
  /** `initial.isResume === true || isEnvResume()` — the API-owned signal. */
  explicitResume: boolean;
  /** `initial.actionMetadata?.intent` — this turn's (explicit) intent, if any. */
  newIntent?: string;
  /** `session.state.resolvedAction?.intent` — the interrupted job's intent. */
  restoredIntent?: string;
  /** `!!initial.overrideDirective` — evaluated BEFORE any session restore. */
  hasNewDirective: boolean;
  /** `session.state.interruption?.dismissed === true` */
  dismissed: boolean;
}): RestoreMode {
  const { verdict, explicitResume, newIntent, restoredIntent, hasNewDirective, dismissed } = params;
  if (!verdict.hasResumableWork) return 'fresh';
  // Explicit resume is user consent by definition — it also re-opens dismissed
  // work (the /resume route clears the marker).
  if (explicitResume) return 'resume';
  if (dismissed) return 'fresh';
  const intentDiverged = !!newIntent && !!restoredIntent && newIntent !== restoredIntent;
  if (intentDiverged) return 'fresh';
  if (!verdict.canResume) return 'fresh';
  if (hasNewDirective) return 'revise-context';
  // A new /execute with no directive is a new job — the API said so.
  return 'fresh';
}
