import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import type { InterruptionDetails } from '../../../../../core/types';
import type { SessionRunStatus } from '../../../../../core/types/session';
import { UserContext } from '../../../../../core/types/user';
import { logger } from '../../../../../utils/logger';
import { JobStateTracker } from '../managers/JobStateTracker';
import { ServerDependencies } from '../types';
import { getInfrastructureFactory } from '../../../../../infrastructure/adapters/InfrastructureFactory';
import { getRealtimeBroadcastChannel } from '../../../../../infrastructure/state';
import { getSessionFilePathByJob } from '../../../../../core/utils/sessionPaths';
import { atomicWriteFile } from '../../../../../core/utils/atomicWriteFile';
import { appendJobSnapshotToSession } from '../../routes/helpers/sessionCleanup';
import { isNonTaskJob } from '@ant/shared';

/**
 * Invariant I2 — `cancelled` choice cards (Resume / Dismiss UI) must not
 * be emitted for a clarify-paused non-task job. The clarify card itself
 * IS the paused-state UI; emitting a cancelled card alongside it produces
 * conflicting affordances. The gate is intentionally narrow (non-task
 * AND `awaitingClarify === true`) so decomposable jobs and non-task jobs
 * paused for OTHER reasons (recursion limit / user_stopped / fatal error)
 * keep the existing cancelled-card flow.
 *
 * Exported so the gate is unit-testable in isolation from the rest of
 * cleanupJobState's heavyweight dependencies.
 */
export function shouldSuppressCancelledCardForClarify(
  jobType: string,
  sessionState: { awaitingClarify?: boolean } | undefined | null,
): boolean {
  if (!isNonTaskJob(jobType)) return false;
  return sessionState?.awaitingClarify === true;
}

/**
 * JobCleanupManager
 * 
 * Handles job state cleanup when jobs are stopped or completed.
 * Manages session file updates and final Kanban broadcasts.
 */
export class JobCleanupManager {
  constructor(
    private readonly stateTracker: JobStateTracker,
    private readonly deps: ServerDependencies
  ) {}

  /**
   * Clean up job state when stopped or completed.
   *
   * `finalStatus` carries the terminal-status decision from the caller
   * (`finalizeTerminalJob` / `pauseJob`). When omitted, the legacy
   * interruption-derived mapping in `broadcastFinalUpdate` is used. The
   * parameter exists because pre-fix the chain derived SessionRun.status
   * purely from `interruptionReason` presence and fell back to
   * `'completed'` for any failed-without-interruption case (e.g.
   * orchestrator deadlock) — see the `such-pinning-milky` RCA.
   */
  async cleanupJobState(
    jobId: string,
    projectId?: string,
    featureName?: string,
    interruptionReason?: InterruptionDetails,
    explicitJobType?: 'design' | 'code' | 'learn' | 'plan' | 'visual',
    userContext?: UserContext,
    finalStatus?: SessionRunStatus,
  ): Promise<void> {
    logger.info(`cleanupJobState`, { 
      component: 'JobCleanupManager', 
      jobId 
    }, {
      projectId,
      featureName,
      interruptionReason: interruptionReason?.reason,
      explicitJobType
    });
    
    // ✅ Cloud-safe: Get mapping from Redis (single source of truth)
    const stateStore = getInfrastructureFactory().getStateStore();
    let mapping = await stateStore.getJobMapping(jobId);
    
    // If mapping not found in Redis, use provided parameters
    if (!mapping && projectId && featureName) {
      mapping = { 
        projectId, 
        featureName, 
        jobType: explicitJobType || 'code',
        userContext
      };
      logger.debug(`Using provided mapping`, { 
        component: 'JobCleanupManager', 
        jobId 
      }, mapping);
    }
    
    // Get current snapshot
    const snapshot = this.stateTracker.getTaskQueueSnapshot(jobId);

    // Determine job type. inline-ask is stateless and is short-circuited
    // by RouteConfigurator's JOB_STATUS_UPDATES handler before
    // cleanupJobState fires (it has no session file or kanban to clean
    // up). If we ever reach here with an inline-ask mapping, that's a
    // structural bug — log and skip rather than mis-routing it through
    // the sessionable cleanup path.
    if (mapping?.jobType === 'inline-ask') {
      logger.warn(`cleanupJobState reached with inline-ask jobType — skipping (should be handled by RouteConfigurator inline-ask branch)`, {
        component: 'JobCleanupManager',
        jobId,
      });
      this.stateTracker.cleanup(jobId);
      return;
    }
    const jobStatus = this.stateTracker.getJobStatus(jobId);
    const jobType = mapping?.jobType || explicitJobType || (jobStatus?.task as 'design' | 'code' | 'learn' | 'plan' | 'visual') || 'code';
    
    // End workflow tracking
    await this.deps.workflowStateService.endJob(jobId);
    
    if (!mapping) {
      logger.warn(`No mapping found, cannot broadcast Kanban update`, {
        component: 'JobCleanupManager',
        jobId
      });
      logger.debug(`cleanupJobState completed`, {
        component: 'JobCleanupManager',
        jobId
      });
      return;
    }

    // chat-SSOT §5 retired the in-memory currentMessage scratchpad,
    // so there is no longer a "finalize" step to call here. The
    // worker's `LLMResponseService.finalizeMessage` already drained
    // its TURN_BUFFER before exiting; if the worker died mid-turn,
    // the per-turn buffer expires via TTL.
    const effectiveUserContext = userContext || mapping.userContext || {
      userId: 'local',
      organizationId: 'local',
    };

    // Two phases — kept INDEPENDENT so a failure in Phase A (session
    // sync + final kanban broadcast) cannot prevent Phase B (cancelled
    // card emission). Before the split, both lived under one wide
    // try/catch that swallowed every throw between session-read and
    // cancelled-card-emit, silently dropping the Resume / Dismiss UI
    // when any intermediate step (`readSessionData`, `atomicWriteFile`,
    // `broadcastFinalUpdate`) failed (cancelled-card-missing RCA).
    //
    //   Phase A — session sync + final kanban broadcast (UI accuracy)
    //   Phase B — cancelled choice card emission (Resume / Dismiss UI)
    //
    // Phase B reads `sessionData?.state` for the clarify-suppress
    // invariant, so the variable is hoisted above the Phase A try.
    // `readSessionData` returns `Promise<any>` (`SessionService.ts`),
    // so the local mirror is intentionally untyped.
    let sessionData: any = null;

    try {
      const featurePath = this.deps.workspaceResolver.getFeaturePath(
        effectiveUserContext,
        mapping.projectId,
        mapping.featureName || 'skeleton'
      );
      const sessionPath = getSessionFilePathByJob(featurePath, jobType);

      sessionData = await this.deps.sessionService.readSessionData(
        mapping.projectId,
        mapping.featureName || 'skeleton',
        jobType,
        effectiveUserContext
      );

      let shouldBroadcast = true;
        
        if (sessionData?.state) {
          // ✅ Parallel mode: Orchestrator's checkpoint already has the complete
          // taskQueue (including running tasks marked as interrupted) and completedTasks.
          // Skip single-currentTask logic — it doesn't apply to parallel execution.
          const isParallelMode = sessionData.state.parallelMode === true;
          
          if (isParallelMode) {
            // ✅ Parallel-mode SSOT: Redis checkpoint (primary) → live snapshot
            // (fallback) → session-as-is (last resort).
            //
            // The orchestrator's `saveCheckpoint(interruption)` writes Redis
            // checkpoint synchronously and triggers the worker's onCheckpoint
            // to atomicWriteFile the session. Both writers project the *same*
            // checkpoint payload, so when Redis ≥ session in completed-task
            // count, deriving from Redis carries `interrupted: true` flags
            // forward without losing data; whichever side writes last produces
            // identical state.
            //
            // Guard: if Redis is *behind* the session (TTL expiry, partial
            // flush, or a write race where the worker's onCheckpoint reached
            // disk before saveCheckpointSnapshot reached Redis), trusting
            // Redis blindly would silently drop completed tasks. In that
            // case we keep the session's completed history and only project
            // the running tasks (with `interrupted:true`) onto the queue
            // head. This preserves the Phase-3 invariant (`interrupted`
            // flag survives) without sacrificing completed-task history.
            let source: { queue?: any[]; completedTasks?: any[]; currentTask?: any; currentTasks?: any[] } | null = null;
            let sourceLabel: 'checkpoint' | 'live' | 'none' = 'none';
            try {
              const redisCheckpoint = await stateStore.getTaskQueueCheckpoint(jobId);
              if (redisCheckpoint) {
                source = redisCheckpoint;
                sourceLabel = 'checkpoint';
              } else {
                const liveSnapshot = await stateStore.getTaskQueue(jobId);
                if (liveSnapshot) {
                  source = liveSnapshot;
                  sourceLabel = 'live';
                }
              }
            } catch (err) {
              logger.warn(`Failed to read Redis checkpoint/snapshot`, {
                component: 'JobCleanupManager',
                jobId
              }, err);
            }

            const sessionCompleted = sessionData.state.completedTasksDetails || [];
            if (source) {
              // Crash-recovery boundary owns the running→interrupted projection.
              // Worker-side saveCheckpoint NO LONGER pre-marks running tasks.
              // Both Redis live snapshot AND checkpoint snapshot now report
              // in-flight tasks via `currentTasks` (uniform `TaskQueueSnapshot`
              // shape) — fall back to `currentTask` only for the legacy
              // sequential-mode single-task shape. Apply `interrupted:true`
              // here so the Kanban shows them as paused on resume.
              const runningInterrupted = (source.currentTasks ?? (source.currentTask ? [source.currentTask] : []))
                .filter(Boolean)
                .map((t: any) => ({ ...t, interrupted: true }));
              const sourceCompleted = source.completedTasks ?? [];
              const redisHasFullHistory = sourceCompleted.length >= sessionCompleted.length;
              logger.info(
                `Using Redis ${sourceLabel} as parallel-mode SSOT (redisFull=${redisHasFullHistory})`,
                { component: 'JobCleanupManager', jobId },
                {
                  queue: (source.queue ?? []).length,
                  runningInterrupted: runningInterrupted.length,
                  redisCompleted: sourceCompleted.length,
                  sessionCompleted: sessionCompleted.length,
                },
              );
              if (redisHasFullHistory) {
                sessionData.state = {
                  ...sessionData.state,
                  taskQueue: [...runningInterrupted, ...(source.queue ?? [])],
                  completedTasks: sourceCompleted.map((t: any) => t.id || t),
                  completedTasksDetails: sourceCompleted,
                  currentTask: undefined,
                  // Terminal-state invariant — no task is "running" after
                  // finalize. Every in-flight task is now in `taskQueue` head
                  // with `interrupted:true`. Clearing this prevents
                  // KanbanService.buildSessionKanbanData from rendering a
                  // stale pre-interrupt running task in `inProgress` when the
                  // worker's handleInterruption checkpoint lost the race to
                  // this terminal write (ultra-fusing-scone RCA).
                  runningTasks: [],
                };
              } else {
                // Redis is stale wrt the session's completed history — keep
                // the session's completed list (no data loss) but still
                // project Redis's running-as-interrupted onto the queue.
                sessionData.state = {
                  ...sessionData.state,
                  taskQueue: [...runningInterrupted, ...(source.queue ?? [])],
                  currentTask: undefined,
                  runningTasks: [],
                };
              }
            } else {
              // Redis fully drained — the session file is the only source for
              // both queued and in-flight tasks. Promote the session's own
              // `runningTasks` into `taskQueue` head with `interrupted:true`
              // (the periodic checkpoint does NOT pre-mark; the crash-recovery
              // boundary — that's us here — owns the projection), then clear
              // `runningTasks` so the terminal-state invariant holds even when
              // the worker never landed its post-stop checkpoint.
              const sessionRunning: any[] = ((sessionData.state as any).runningTasks ?? [])
                .filter(Boolean)
                .map((t: any) => ({ ...t, interrupted: true }));
              const existingQueue: any[] = sessionData.state.taskQueue ?? [];
              const queueIds = new Set(existingQueue.map((t: any) => t.id));
              // Defensive de-dup — a worker post-stop write that beat us here
              // would have placed the same task in `taskQueue`; keep that copy.
              const projected = sessionRunning.filter((t: any) => !queueIds.has(t.id));
              logger.info(
                `No Redis source for parallel-mode cleanup; projecting session.runningTasks onto taskQueue head`,
                { component: 'JobCleanupManager', jobId },
                { runningCount: projected.length, queueLen: existingQueue.length },
              );
              sessionData.state = {
                ...sessionData.state,
                taskQueue: [...projected, ...existingQueue],
                currentTask: undefined,
                runningTasks: [],
              };
            }
          } else {
            // ✅ Sequential mode: original single-currentTask logic
            // Try multiple sources for current in-progress task (cloud-safe)
            // Priority: 1. local snapshot, 2. Redis StateStore, 3. session file
            let taskToReturn = snapshot?.currentTask || null;
            
            if (!taskToReturn) {
              try {
                const redisSnapshot = await stateStore.getTaskQueue(jobId);
                taskToReturn = redisSnapshot?.currentTask || null;
                if (taskToReturn) {
                  logger.info(`Found currentTask from Redis StateStore`, {
                    component: 'JobCleanupManager',
                    jobId
                  }, { taskName: taskToReturn.name });
                }
              } catch (err) {
                logger.warn(`Failed to get task from Redis StateStore`, {
                  component: 'JobCleanupManager',
                  jobId
                });
              }
            }
            
            if (!taskToReturn) {
              taskToReturn = sessionData.state.currentTask || null;
            }
            
            // ✅ FIX: Skip completed tasks — session's currentTask might be stale
            if (taskToReturn?.completed) {
              logger.debug(`Skipping completed task as taskToReturn`, {
                component: 'JobCleanupManager',
                jobId
              }, { taskName: taskToReturn.name });
              taskToReturn = null;
            }
            
            if (taskToReturn) {
              // ✅ FIX: Set timing.pausedAt to properly track pause duration
              const now = new Date().toISOString();
              const interruptedTask = {
                ...taskToReturn,
                interrupted: true,
                timing: taskToReturn.timing ? {
                  ...taskToReturn.timing,
                  pausedAt: now
                } : undefined
              };
              
              // Put currentTask back at the front of the queue
              const existingQueue = sessionData.state.taskQueue || [];
              const filteredQueue = existingQueue.filter((task: any) => task.id !== taskToReturn!.id);
              const updatedQueue = [interruptedTask, ...filteredQueue];
              
              sessionData.state = {
                ...sessionData.state,
                taskQueue: updatedQueue,
                currentTask: undefined
              };
            } else {
              sessionData.state = {
                ...sessionData.state
              };
            }
          }
          
          // Update jobTiming with pausedAt (skip if job already completed successfully)
          if (sessionData.state.jobTiming && !sessionData.state.jobTiming.completedAt) {
            sessionData.state.jobTiming = {
              ...sessionData.state.jobTiming,
              pausedAt: new Date().toISOString()
            };
          }
          
          // Save interruption details if provided
          if (interruptionReason) {
            sessionData.state.interruption = interruptionReason;
            logger.debug(`Saved interruption reason: ${interruptionReason.reason}`, { 
              component: 'JobCleanupManager', 
              jobId 
            });
          } else if (sessionData.state.interruption) {
            // ✅ Fallback: Session already has interruption (saved by saveCheckpoint in runner.ts)
            // Use it ONLY if it belongs to the current job (has matching jobId or was saved
            // very recently). Without this guard, a stale interruption from a PREVIOUS job
            // (e.g., user_stopped) gets reused when the new job completes successfully,
            // causing a spurious "cancelled" chat message.
            const sessionInterruption = sessionData.state.interruption;
            const sessionJobId = sessionData.state.jobId;
            const isCurrentJobInterruption = sessionJobId === jobId;
            
            if (isCurrentJobInterruption) {
              interruptionReason = sessionInterruption;
              logger.info(`Using existing session interruption: ${interruptionReason?.reason}`, { 
                component: 'JobCleanupManager', 
                jobId 
              });
            } else {
              // Stale interruption from a previous job — clear it
              logger.info(`Clearing stale session interruption: ${sessionInterruption?.reason} (session jobId=${sessionJobId}, current jobId=${jobId})`, { 
                component: 'JobCleanupManager', 
                jobId 
              });
              sessionData.state.interruption = undefined;
            }
          }
          
          // Write updated session (atomic: temp file + rename to prevent corruption)
          await atomicWriteFile(sessionPath, JSON.stringify(sessionData, null, 2));
        } else if (interruptionReason) {
          // ✅ Session file unreadable (corrupted mid-write, EFS stale, or not yet created).
          // CRITICAL: Do NOT blindly create a minimal session with empty taskQueue — this
          // would destroy task state and cause all tasks to disappear from the Kanban.
          //
          // Strategy:
          // 1. Try Redis task queue snapshot as fallback (always up-to-date in distributed mode)
          // 2. If Redis also has nothing, do NOT overwrite — the session file on disk may
          //    still be valid (just momentarily unreadable due to EFS propagation).
          let fallbackTaskQueue: any[] = [];
          let fallbackCompletedTasks: any[] = [];
          let hasFallback = false;
          
          try {
            // ✅ Use checkpoint snapshot (separate key from live Kanban snapshot).
            // Both checkpoint and live snapshots now report in-flight workers via
            // `currentTasks` (uniform TaskQueueSnapshot shape after the
            // running-vs-interrupted split). Project running → queue head with
            // `interrupted:true` unconditionally — no shape distinction needed.
            const redisSnapshot = await stateStore.getTaskQueueCheckpoint(jobId);
            if (redisSnapshot) {
              const runningTasks = (redisSnapshot.currentTasks || (redisSnapshot.currentTask ? [redisSnapshot.currentTask] : []))
                .filter(Boolean)
                .map((t: any) => ({ ...t, interrupted: true }));
              fallbackTaskQueue = [...runningTasks, ...(redisSnapshot.queue || [])];
              fallbackCompletedTasks = redisSnapshot.completedTasks || [];
              hasFallback = true;
              logger.info(`Recovered task state from Redis checkpoint snapshot`, {
                component: 'JobCleanupManager',
                jobId
              }, {
                queueSize: fallbackTaskQueue.length,
                runningCount: runningTasks.length,
                completedCount: fallbackCompletedTasks.length,
              });
            }
          } catch (redisErr) {
            logger.warn(`Failed to get fallback from Redis`, {
              component: 'JobCleanupManager',
              jobId
            }, redisErr);
          }
          
          if (hasFallback) {
            const minimalSession = {
              sessionId: crypto.randomUUID(),
              projectId: mapping.projectId,
              featureName: mapping.featureName,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              turns: [],
              state: {
                taskQueue: fallbackTaskQueue,
                completedTasks: fallbackCompletedTasks.map((t: any) => t.id || t),
                completedTasksDetails: fallbackCompletedTasks,
                interruption: interruptionReason,
                parallelMode: true,
              }
            };
            
            await fs.promises.mkdir(path.dirname(sessionPath), { recursive: true });
            await atomicWriteFile(sessionPath, JSON.stringify(minimalSession, null, 2));
          } else {
            // No Redis fallback available — do NOT overwrite potentially valid session file.
            // Log a warning so we can diagnose if this path is ever hit.
            logger.warn(`No session data and no Redis fallback — skipping session write to preserve existing file`, {
              component: 'JobCleanupManager',
              jobId
            }, {
              sessionPath,
              interruptionReason: interruptionReason.reason,
            });
          }
        }
        
      // Broadcast final update for every jobType. plan/visual jobs may
      // not have a populated taskQueue, in which case the SESSION-only
      // payload publishes empty todo/inProgress/completed and overwrites
      // any leftover LIVE snapshot from the worker's KanbanBroadcaster.
      // Frontend filters by `selectedJobType` so unrelated jobTypes are
      // ignored without UI churn.
      if (shouldBroadcast) {
        await this.broadcastFinalUpdate(
          mapping,
          jobType,
          effectiveUserContext,
          jobId,
          interruptionReason,
          finalStatus,
        );
      } else {
        this.stateTracker.cleanup(jobId);
      }
    } catch (error) {
      // Phase A failure must NOT block Phase B — log and fall through
      // to the cancelled card emission below so the UI still renders
      // Resume / Dismiss even when session sync / kanban broadcast
      // failed (cancelled-card-missing RCA: the prior single outer
      // try/catch swallowed every throw between session-read and
      // cancelled-card-emit, silently dropping the choice card).
      logger.error(`Error in cleanupJobState session/broadcast phase`, {
        component: 'JobCleanupManager',
        jobId
      }, error);
    }

    // Phase B — cancelled choice card emission (independent of Phase A).
    // The card offers Resume / Dismiss affordances; if it goes missing
    // the user has no UI handle on the paused job. NX-guarded inside
    // ChatService so duplicate pause sources (StaleJobRecovery, BullMQ
    // stalled handler, etc.) cannot double-emit.
    //
    // Synthesise a generic interruption when the caller signalled a hard
    // failure (`finalStatus === 'failed'`) without an explicit reason —
    // this covers the orchestrator deadlock path and any other "child
    // returned outputStatus=failed with hasInterruption=false" exit. Pre-fix
    // those jobs silently dropped past the Phase B gate, the chat panel
    // received no visual signal, and the user perceived the job as
    // completed despite remaining queued tasks (such-pinning-milky RCA).
    // SessionRun.status is governed separately by the `finalStatus`-driven
    // `derivedStatus` in `broadcastFinalUpdate` so the synthesis here does
    // NOT collapse a failed run to 'paused' on disk.
    const cardInterruption: InterruptionDetails | undefined = interruptionReason
      ?? (finalStatus === 'failed'
        ? {
            reason: 'unknown',
            message: 'Job ended in failed state without explicit interruption details',
            timestamp: new Date().toISOString(),
            canResume: false,
          }
        : undefined);

    if (cardInterruption && mapping.projectId && mapping.featureName) {
      // Invariant I2 — see `shouldSuppressCancelledCardForClarify`.
      // `sessionData` may be null if Phase A's `readSessionData` threw —
      // `awaitingClarify` then defaults to falsy, so the card emits
      // (correct behaviour for a crashed-mid-clarify session: there's
      // no stable clarify card to collide with anymore).
      const suppressedByClarify = shouldSuppressCancelledCardForClarify(
        jobType,
        sessionData?.state,
      );

      if (suppressedByClarify) {
        logger.info(
          `Suppressing cancelled card for clarify-paused non-task job (Invariant I2)`,
          { component: 'JobCleanupManager', jobId },
          { jobType, reason: cardInterruption.reason },
        );
      } else {
        // Backstop for the cancelled-turn streaming overlay: sweep
        // every active TURN_BUFFER for this feature and broadcast
        // empty snapshots so the FE projector clears its
        // `streamingBuffers` mirror. Best-effort — never throws or
        // blocks the cancelled card emission below. Covers the
        // SIGTERM 1.8s race where a parallel worker exits before
        // `LLMResponseService.finalizeMessage(true)` can run.
        try {
          await this.deps.chatService.clearAllTurnBuffers(
            mapping.projectId,
            mapping.featureName,
            effectiveUserContext,
          );
        } catch (err) {
          logger.warn(
            `clearAllTurnBuffers backstop failed`,
            { component: 'JobCleanupManager', jobId },
            err,
          );
        }

        // Wrap so a Redis blip / chat.jsonl write race surfaces with
        // a clear log instead of silently disappearing
        // (cancelled-card-missing RCA — the prior outer try/catch
        // swallowed every throw between Phase A and the emit).
        try {
          const result = await this.deps.chatService.appendChoicePresentedCancelled(
            mapping.projectId,
            mapping.featureName,
            jobId,
            {
              reason: cardInterruption.reason,
              message: cardInterruption.message,
              jobType: jobType as any,
              designErrorType: (cardInterruption.metadata as any)?.designErrorType,
              userContext: effectiveUserContext,
            },
          );
          logger.info(
            `appendChoicePresentedCancelled result`,
            { component: 'JobCleanupManager', jobId },
            { emitted: result.emitted, cardId: result.cardId, reason: cardInterruption.reason },
          );
        } catch (err) {
          logger.error(
            `appendChoicePresentedCancelled threw — Resume/Dismiss UI will be missing for this pause (reason=${cardInterruption.reason})`,
            { component: 'JobCleanupManager', jobId },
            err,
          );
        }
      }
    }

    logger.debug(`cleanupJobState completed`, {
      component: 'JobCleanupManager',
      jobId
    });
  }

  /**
   * Broadcast final Kanban update and cleanup state.
   *
   * Also persists the just-built kanbanData into the session file's
   * `runs[]` array (keyed by `jobId`), so the Job-tab dropdown can later
   * restore this exact view via `GET /features/:feature/kanban?jobId=...`
   * even after Redis state has expired.
   */
  private async broadcastFinalUpdate(
    mapping: { projectId: string; featureName: string; jobType: string; userContext?: UserContext },
    jobType: 'design' | 'code' | 'learn' | 'plan' | 'visual',
    userContext: UserContext,
    jobId: string,
    interruptionReason?: InterruptionDetails,
    finalStatus?: SessionRunStatus,
  ): Promise<void> {
    try {
      // Final-snapshot SSOT: cleanupJobState has already projected the
      // Redis checkpoint into the session file (atomicWriteFile). At this
      // point Redis status may still read 'running' (updateJobStatus runs
      // after this) and the live taskQueue may still exist
      // (sealJobRedisState runs even later) — using `getKanbanData` here
      // would steer into LIVE/ESTIMATING and publish stale "in-progress"
      // tasks. `getFinalSnapshotKanbanData` reads only the patched session
      // file and always emits `dataSource: 'session'`, ensuring the
      // broadcast reflects the post-cleanup final state regardless of
      // Redis timing. It returns `null` when `session.state` belongs to a
      // DIFFERENT jobId (the shared slot is last-writer-wins) — in that case
      // we skip BOTH persist and broadcast so we never project another job's
      // board onto this finalizing jobId (plain-dimming-flock RCA).
      const kanbanData = await this.deps.kanbanService.getFinalSnapshotKanbanData(
        mapping.projectId,
        mapping.featureName,
        jobType,
        jobId,
        userContext
      );
      if (!kanbanData || (kanbanData.jobId && kanbanData.jobId !== jobId)) {
        logger.warn(
          `Skipping final kanban persist/broadcast — no board owned by this jobId`,
          { component: 'JobCleanupManager', jobId },
        );
        this.stateTracker.cleanup(jobId);
        return;
      }

      // Derive SessionRun.status with `finalStatus` as the SSOT when the
      // caller provided it (finalizeTerminalJob always does; pauseJob
      // passes `'paused'`). Fall back to the legacy interruption-derived
      // mapping only when finalStatus is omitted (HTTP routes / hard-
      // reset paths that don't yet thread the parameter).
      //
      // Pre-fix bug: `interruption ? ... : 'completed'` collapsed every
      // failed-without-interruption case (orchestrator deadlock, child
      // crash, lock_expired w/o killReason) to 'completed', and the FE
      // rendered such runs as "완료" despite tasks remaining in the
      // kanbanSnapshot. See the `such-pinning-milky` RCA.
      const derivedStatus: SessionRunStatus = interruptionReason
        ? (interruptionReason.reason === 'user_stopped' ? 'canceled' : 'paused')
        : (finalStatus ?? 'completed');

      // Inject onto the kanbanData itself so any consumer of the
      // kanbanSnapshot (FE replay endpoint, session.runs[i].kanbanSnapshot)
      // sees the terminal status without round-tripping to SessionRun.
      (kanbanData as { status?: SessionRunStatus }).status = derivedStatus;

      // Persist per-jobId kanban snapshot into session.runs[] for dropdown replay.
      // Best-effort: failures here must not block the broadcast.
      try {
        const featurePath = this.deps.workspaceResolver.getFeaturePath(
          userContext,
          mapping.projectId,
          mapping.featureName,
        );
        await appendJobSnapshotToSession(featurePath, jobType, jobId, kanbanData, derivedStatus);
      } catch (snapErr) {
        logger.warn(
          `Failed to persist kanban snapshot to session`,
          { component: 'JobCleanupManager', jobId },
          snapErr,
        );
      }

      // Broadcast via user-scoped Redis Pub/Sub → Realtime Server → SSE
      if (!userContext?.organizationId || !userContext?.userId) {
        logger.warn(`Cannot broadcast final update without userContext`, { 
          component: 'JobCleanupManager', 
          jobId 
        });
        return;
      }
      
      const stateStore = getInfrastructureFactory().getStateStore();
      const channel = getRealtimeBroadcastChannel(userContext.organizationId, userContext.userId);
      await stateStore.publish(channel, {
        projectId: mapping.projectId,
        featureName: mapping.featureName,
        type: 'kanban',
        data: kanbanData,
        userContext
      });
      
      // Clear live data AFTER broadcast
      this.stateTracker.cleanup(jobId);
    } catch (err) {
      logger.warn(`Failed to broadcast Kanban update`, { 
        component: 'JobCleanupManager', 
        jobId 
      }, err);
      
      // Clean up even if broadcast fails
      this.stateTracker.cleanup(jobId);
    }
  }
}
