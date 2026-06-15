/**
 * Design graph session SSOT — axis ⑤ per NODE_GRAPH_LAYOUT.
 *
 * All design-job session writes MUST go through this module. `session.updateArtifacts`
 * calls outside this file are an axis ⑤ violation. The single allowed exception is
 * `design/nodes/learn/sessionWriter.ts`'s `addRun(...)` call, which is a
 * session-domain log append, not a checkpoint.
 *
 * Each wrapper represents a semantic boundary (task-start, task-complete,
 * interruption, decompose finish, clarify pause, learn, orchestrator, revise) and
 * builds the full Partial<SessionState> through `buildBasePatch` + per-boundary
 * overrides. `buildBasePatch` fully replaces session.state on write
 * (FileSessionAdapter.updateArtifacts replaces, it does not merge), so every
 * wrapper must write a complete state — dropping a field persists as `undefined`.
 *
 * Fire-and-forget: every write is wrapped in try/catch that warns but swallows,
 * matching pre-refactor behavior. Callers do not need their own try/catch.
 */

import type { DesignGraphState } from "../state";
import type { DesignTask } from "../../../types/task";
import type {
  SessionState,
  SessionArtifacts,
  InterruptionDetails,
} from "../../../../../core/types/session";
import { CONV_KEYS, type ConversationMessage } from "../../../../common/graph/conversations";
import type { JobTiming } from "../../../../common/graph/timing/JobTimingManager";
import type { ParallelCheckpoint } from "../../../../common/graph/parallelTypes";
import { buildResumableFailedTaskBase } from "../../../../common/graph/resumableFailedTask";

type CheckpointArtifacts = Partial<SessionArtifacts> & { state?: Partial<SessionState> };

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Internal helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Split a single `state.directive` (possibly containing history) into the
 * `directives[]` array using the same `\n\n---\n\n` separator convention as
 * `code/session/checkpoint.ts`.
 */
function buildDirectivesArray(directive: string | undefined): string[] {
  if (!directive) return [];
  if (directive.includes("\n\n---\n\n")) {
    return directive.split("\n\n---\n\n").filter((d) => d.trim());
  }
  return [directive];
}

/**
 * Snapshot the full design-job session state from the live graph state.
 *
 * Wrappers override only the fields whose semantics differ at their boundary
 * (interruption payloads, currentTask clearing, conversations retention, etc.).
 * Everything else must round-trip — `updateArtifacts` REPLACES `session.state`,
 * so anything omitted from this patch is wiped from the persisted session.
 */
function buildBasePatch(state: DesignGraphState): Partial<SessionState> {
  const patch: Partial<SessionState> = {
    taskQueue: state.taskQueue?.getAll() ?? [],
    currentTask: state.currentTask,
    completedTasks: state.completedTasks ?? [],
    completedTasksDetails: state.completedTasksDetails ?? [],
    planText: state.planText,
    conversations: state.conversations ?? {},
    files: state.files ?? [],
    filesToDelete: state.filesToDelete ?? [],
    jobId: state.jobId,
    jobTiming: state.jobTiming,
    tokenUsage: state.tokenUsage as SessionState["tokenUsage"],
    tokenUsageByModel: state.tokenUsageByModel as SessionState["tokenUsageByModel"],
    overrideDirective: state.overrideDirective,
    chatSource: state.chatSource,
    resolvedAction: state.resolvedAction,
    directive: state.directive,
    directives: buildDirectivesArray(state.directive),
    userLanguage: state.context.userLanguage as SessionState["userLanguage"],
    figmaConfig: state.figmaConfig,
    figmaAvailable: state.figmaAvailable,
    figmaFileKey: state.figmaFileKey,
    figmaStartNodeId: state.figmaStartNodeId,
  };
  if (state._estimatingTokenUsage) {
    patch.estimatingTokenUsage = state._estimatingTokenUsage as SessionState["estimatingTokenUsage"];
  }
  return patch;
}

/**
 * Common write path: guard → updateArtifacts → log/swallow.
 * All wrappers go through this so error handling stays uniform.
 */
async function writeCheckpoint(
  state: DesignGraphState,
  artifacts: CheckpointArtifacts,
  label: string,
  opts?: { featureFolderFallback?: string },
): Promise<void> {
  if (!state.deps?.session) return;
  const featureFolder = state.context.featureFolder ?? opts?.featureFolderFallback;
  if (!featureFolder) return;
  try {
    await state.deps.session.updateArtifacts(
      state.context.project,
      featureFolder,
      "design",
      artifacts,
    );
    console.log(`💾 [${label}] Checkpoint saved`);
  } catch (error) {
    console.warn(`⚠️  [${label}] Failed to save checkpoint:`, error);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Public API — one wrapper per semantic boundary
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Task-start boundary: plan node popped the next task and is about to dispatch
 * to docGen. Saves `currentTask` so a manual cancel during docGen can locate
 * the in-progress task on resume.
 */
export async function saveTaskStartCheckpoint(
  state: DesignGraphState,
  opts: { currentTask: DesignTask },
): Promise<void> {
  const patch: Partial<SessionState> = {
    ...buildBasePatch(state),
    currentTask: opts.currentTask,
  };
  await writeCheckpoint(state, { state: patch }, "Design:Plan");
}

/**
 * Task-complete boundary: checkTaskStatus finalized the current task. Clears
 * `currentTask` and persists `conversations: {}` (runtime retention policy
 * lives in checkTaskStatus; the persisted checkpoint is deliberately empty).
 */
export async function saveTaskCompleteCheckpoint(
  state: DesignGraphState,
  opts: {
    completedTasks: string[];
    completedTasksDetails: DesignTask[];
  },
): Promise<void> {
  const patch: Partial<SessionState> = {
    ...buildBasePatch(state),
    currentTask: undefined,
    completedTasks: opts.completedTasks,
    completedTasksDetails: opts.completedTasksDetails,
    // Checkpoint saves empty conversations; runtime state uses retention policy.
    conversations: {},
  };
  await writeCheckpoint(state, { state: patch }, "Design:checkTaskStatus");
}

/**
 * Interruption boundary for sequential paths (figma_connection_lost, etc.).
 * Caller supplies the replacement task queue (running task re-pushed at front)
 * and the interruption payload; wrapper ensures currentTask is cleared unless
 * the caller explicitly passes one.
 */
export async function saveInterruptionCheckpoint(
  state: DesignGraphState,
  opts: {
    taskQueue: DesignTask[];
    interruption: InterruptionDetails;
    currentTask?: DesignTask;
  },
): Promise<void> {
  const patch: Partial<SessionState> = {
    ...buildBasePatch(state),
    taskQueue: opts.taskQueue,
    currentTask: opts.currentTask,
    interruption: opts.interruption,
  };
  await writeCheckpoint(state, { state: patch }, "Design:Interruption");
}

/**
 * Decompose boundary: LLM produced the initial task breakdown. No currentTask
 * yet — plan node will pop the first one.
 */
export async function saveDecomposeCheckpoint(
  state: DesignGraphState,
  opts: {
    taskQueue: DesignTask[];
    completedTasks?: string[];
    completedTasksDetails?: DesignTask[];
  },
): Promise<void> {
  const patch: Partial<SessionState> = {
    ...buildBasePatch(state),
    taskQueue: opts.taskQueue,
    currentTask: undefined,
    completedTasks: opts.completedTasks ?? [],
    completedTasksDetails: opts.completedTasksDetails ?? [],
  };
  await writeCheckpoint(state, { state: patch }, "Design:Decompose");
}

/**
 * Clarify pause: either the docGen spec-clarify tag fired (kind='docgen')
 * or the detect node paused for the user to pick between spec/system
 * (kind='detect'). docgen form carries the current docGen node history.
 */
export async function saveClarifyCheckpoint(
  state: DesignGraphState,
  opts: { kind: "docgen" | "detect"; nodeHistory?: ConversationMessage[] },
): Promise<void> {
  const patch: Partial<SessionState> = { ...buildBasePatch(state) };
  if (opts.kind === "docgen") {
    patch.awaitingClarify = true;
    if (opts.nodeHistory) {
      patch.conversations = { [CONV_KEYS.NODE_DOCGEN]: opts.nodeHistory };
    }
  } else {
    patch.awaitingDetectClarify = true;
  }
  await writeCheckpoint(state, { state: patch }, `Design:Clarify:${opts.kind}`);
}

/**
 * Learn boundary: final session write at job end. Persists keyDecisions
 * alongside the state patch; preserves any existing `interruption` so a
 * tasks-failed job keeps its reason visible on reload.
 *
 * NOTE: The `addRun(...)` call in sessionWriter is NOT a checkpoint — it's a
 * session-domain append and stays in sessionWriter.
 */
export async function saveLearnCheckpoint(
  state: DesignGraphState,
  opts: {
    decisions: string[];
    directivesArray: string[];
    completedJobTiming: JobTiming | undefined;
    existingInterruption: InterruptionDetails | undefined;
  },
): Promise<void> {
  const patch: Partial<SessionState> = {
    ...buildBasePatch(state),
    jobTiming: opts.completedJobTiming,
    directives: opts.directivesArray,
    interruption: opts.existingInterruption,
  };
  await writeCheckpoint(
    state,
    { keyDecisions: opts.decisions.slice(0, 5), state: patch },
    "Design:Learn",
    // sessionWriter historically fell back to 'default' when featureFolder
    // was missing (matches addRun(...) on the same code path).
    { featureFolderFallback: "default" },
  );
}

/**
 * Revise boundary: plan re-written on resume with a new directive. We pass
 * the already-updated `updatedState` as the basis for the snapshot so
 * taskQueue / planText / conversations mutations survive. The directive
 * field is assumed to have been overwritten on updatedState already.
 */
export async function saveReviseCheckpoint(
  state: DesignGraphState,
  updatedState: DesignGraphState,
): Promise<void> {
  const patch: Partial<SessionState> = { ...buildBasePatch(updatedState) };
  await writeCheckpoint(state, { state: patch }, "Design:Revise");
}

/**
 * Parallel orchestrator periodic / on-demand checkpoint.
 *
 * Persists the merged task queue with `_failed` markers on failed entries so
 * they survive a process kill and surface on resume as Retry cards. There is
 * no separate `SessionState.failedTasks` channel — the `_failed:true` marker
 * on each task is the SSOT for "this task failed in the last run".
 */
export async function saveOrchestratorCheckpoint(
  state: DesignGraphState,
  checkpoint: ParallelCheckpoint<DesignTask>,
): Promise<void> {
  if (!state.deps?.session || !state.context.featureFolder) return;

  // POISON GATE — Crash-recovery boundary (BullMQJobQueue / JobWorker stalled
  // handlers) sets `ant:job-poisoned:{id}` before publishing the pause
  // lifecycle event. Skip the write so it can't land AFTER cleanupJobState's
  // projection and resurrect un-interrupted runningTasks on Kanban.
  try {
    if (state.deps?.redis && state.jobId) {
      const poisoned = await state.deps.redis.exists(`ant:job-poisoned:${state.jobId}`);
      if (poisoned === 1) {
        console.log(`[DesignOrchestrator] Checkpoint skipped — job poisoned: ${state.jobId}`);
        return;
      }
    }
  } catch { /* best-effort */ }

  try {
    // SSOT helper: marker trio (`interrupted`/`_failed`/`_failureReason`)
    // is owned by `buildResumableFailedTaskBase` so design and code jobs
    // share one shape for the FE's Retry+Paused card. DesignTask has no
    // CodeTask-specific budget axes, so the base helper is used directly.
    const failedAsQueue: DesignTask[] = checkpoint.failedTasks.map((f) =>
      buildResumableFailedTaskBase<DesignTask>(f.task, f.error.message),
    );
    const failedIds = new Set(failedAsQueue.map((t) => t.id));
    const dedupedQueue = checkpoint.taskQueue.filter((t) => !failedIds.has(t.id));

    const patch: Partial<SessionState> = {
      taskQueue: [...failedAsQueue, ...dedupedQueue],
      runningTasks: checkpoint.runningTasks,
      completedTasks: checkpoint.completedTasks.map((t) => t.id),
      completedTasksDetails: checkpoint.completedTasks,
      tokenUsage: checkpoint.tokenUsage,
      tokenUsageByModel: checkpoint.tokenUsageByModel,
      estimatingTokenUsage: state._estimatingTokenUsage as SessionState["estimatingTokenUsage"],
      jobId: state.jobId,
      jobTiming: state.jobTiming,
      parallelMode: true,
      figmaConfig: state.figmaConfig,
      figmaAvailable: state.figmaAvailable,
      figmaFileKey: state.figmaFileKey,
      figmaStartNodeId: state.figmaStartNodeId,
      resolvedAction: state.resolvedAction,
      userLanguage: state.context.userLanguage as SessionState["userLanguage"],
    };
    if (checkpoint.interruption) {
      const reason = checkpoint.interruption.reason as InterruptionDetails["reason"];
      const message = reason === "tasks_failed" && checkpoint.failedTasks.length > 0
        ? [
            `${checkpoint.failedTasks.length} task(s) failed during parallel execution`,
            ...checkpoint.failedTasks.map((f) => `- "${f.task.name}": ${f.error.message}`),
          ].join("\n")
        : `Design paused: ${reason}`;
      patch.interruption = {
        reason,
        message,
        timestamp: new Date().toISOString(),
        canResume: checkpoint.interruption.canResume,
      };
    }

    await state.deps.session.updateArtifacts(
      state.context.project,
      state.context.featureFolder,
      "design",
      { state: patch },
    );

    const failedCount = checkpoint.failedTasks.length;
    console.log(
      `💾 [Design:ParallelOrchestrator] Checkpoint saved (${checkpoint.completedTasks.length} completed, ${checkpoint.taskQueue.length} queued${failedCount > 0 ? `, ${failedCount} failed` : ""})`,
    );
  } catch (err) {
    console.warn(`⚠️  [Design:ParallelOrchestrator] Checkpoint save failed:`, err);
  }
}
