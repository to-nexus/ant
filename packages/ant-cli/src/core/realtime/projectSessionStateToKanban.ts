import type { SessionState } from '../types/session';
import { getAgentForJobSafe } from '../utils/sessionPaths';

/**
 * Pure projector: shared session-state shape → KanbanData columns.
 *
 * Single SSOT for the session→kanban column grouping, consumed by:
 *  - `KanbanService.buildSessionKanbanData` (GET kanban / final-snapshot)
 *  - the architect code `learn` node, which stamps the authoritative
 *    per-jobId terminal snapshot into `session.runs[]` from the job's OWN
 *    in-process state (so a completed run is jobId-discoverable and matches
 *    what the GET path would return).
 *
 * `sessionState` carries the same fields the persisted `session.state` slot
 * holds (`taskQueue` as a plain array, `completedTasksDetails`, `currentTask`,
 * optional `runningTasks`, `interruption`, recursion counts, jobTiming,
 * tokenUsage, tokenUsageByModel). The learn node feeds an equivalent object built from its graph
 * state (`state.taskQueue.getAll()`, `state.completedTasksDetails`, …).
 */
export function projectSessionStateToKanban(
  sessionState: Partial<SessionState>,
  sessionJobId: string | undefined,
  jobType: string,
  isActuallyRunning: boolean,
): any {
  const sessionTaskQueue = sessionState.taskQueue || [];
  const completedTaskIds = sessionState.completedTasks || [];
  const completedTasksDetails = sessionState.completedTasksDetails || [];
  const currentTask = sessionState.currentTask || null;
  // Parallel mode: in-flight workers persist tasks under `runningTasks`
  // (separate from `taskQueue`) without defensive marking. Tasks here
  // carry `interrupted:true` only when a real interrupt event stamped them
  // (handleInterruption → captureWorkerSnapshots). Split per-task by that
  // flag so:
  //   - Marked running tasks (graceful stop in progress) render in `todo`
  //     and TaskCard surfaces the Paused badge — matches the UX of tasks
  //     that already moved to `taskQueue` via reportStopped.
  //   - Unmarked running tasks (job actively running, periodic checkpoint)
  //     render in `inProgress` so a page refresh during normal run does
  //     not show "Paused".
  // Hard-kill orphans normally never reach this branch unmarked — JobCleanupManager
  // projects them into `taskQueue` with marks at cleanup time.
  //
  // Safety net (grim-padding-grove RCA): the above invariant can be violated by a
  // cross-pod race — StaleJobRecovery's `pauseJob` never acquires the poison lock, so
  // a worker child still alive on a not-yet-drained pod re-writes `runningTasks`
  // UNMARKED via its un-gated `onCheckpoint`, after cleanup already projected. When the
  // job is paused/interrupted and NOT running, the per-task `interrupted` flag is
  // therefore unreliable: treat ALL running tasks (and `currentTask`) as paused so they
  // land in `todo`, never frozen in `inProgress`. No-op in the normal flow where
  // `runningTasks` is already `[]` (ultra-fusing-scone write-side invariant).
  const sessionRunningTasks: any[] = (sessionState as any).runningTasks || [];
  const isPausedSession = !isActuallyRunning && !!sessionState.interruption;
  const pausedAtIso = sessionState.interruption?.timestamp;
  const markPaused = (t: any) => ({
    ...t,
    interrupted: true,
    // Stamp pausedAt so TaskTimer shows frozen elapsed instead of "0s" (only when the
    // task actually started and isn't already stamped).
    timing: t?.timing?.startedAt && !t?.timing?.pausedAt && pausedAtIso
      ? { ...t.timing, pausedAt: pausedAtIso }
      : t?.timing,
  });
  const runningPaused = isPausedSession
    ? sessionRunningTasks.map(markPaused)
    : sessionRunningTasks.filter((t: any) => t?.interrupted === true);
  const runningLive = isPausedSession
    ? []
    : sessionRunningTasks.filter((t: any) => t?.interrupted !== true);
  const pausedCurrent = isPausedSession && currentTask ? markPaused(currentTask) : null;
  const runningIds = new Set<string>([
    ...(currentTask ? [currentTask.id] : []),
    ...sessionRunningTasks.map((t: any) => t.id),
  ]);

  const MIN_RECURSION_LIMIT = 5;
  const recursionLimit = parseInt(process.env.RECURSION_LIMIT || '', 10);
  const finalLimit = (isNaN(recursionLimit) || recursionLimit < MIN_RECURSION_LIMIT)
    ? 200
    : recursionLimit;

  const inProgress = (!isPausedSession && currentTask)
    ? [currentTask, ...runningLive]
    : runningLive;

  const todo = [
    ...(pausedCurrent ? [pausedCurrent] : []),
    ...runningPaused,
    ...sessionTaskQueue.filter((task: any) =>
      !completedTaskIds.includes(task.id) &&
      !runningIds.has(task.id)
    ),
  ];

  console.log(`[KanbanService] RETURN path=SESSION jobId=${sessionJobId ?? 'none'} todo=${todo.length} ip=${inProgress.length} done=${completedTasksDetails.length} ds=session isRunning=${isActuallyRunning} paused=${isPausedSession}`);

  return {
    jobId: sessionJobId,
    todo,
    inProgress,
    completed: completedTasksDetails.map((detail: any) => ({
      ...detail,
      status: 'completed',
      completed: true
    })),
    isEstimating: false,
    dataSource: 'session',
    interruption: sessionState.interruption,
    recursionCount: sessionState.recursionCount,
    recursionLimit: sessionState.recursionLimit || finalLimit,
    jobTiming: sessionState.jobTiming,
    tokenUsage: sessionState.tokenUsage,
    tokenUsageByModel: sessionState.tokenUsageByModel,
    estimatingTokenUsage: sessionState.estimatingTokenUsage,
    jobType,
    agent: getAgentForJobSafe(jobType),
  };
}
