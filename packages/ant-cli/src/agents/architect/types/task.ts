/**
 * Agent-Specific Task Types
 *
 * Extends the shared discriminated union ({@link BaseTask}) with agent-
 * specific fields. CodeTask / DesignTask are themselves discriminated
 * unions (one variant per `type`), so the type system enforces:
 *
 *   - `band` is reachable ONLY on FeatureCodeTask (Three-Axis SSOT)
 *   - verification-only fields (`batchSplitCount`, `selfVerifyOnDone`) are
 *     scoped to the variants where they are actually used
 *
 * Core types (TaskType, BaseTask, TaskTiming, TaskTokenUsage) are
 * defined in `@ant/shared` and re-exported through `core/types/task.ts`.
 */

export type { TaskType, TaskTiming, TaskTokenUsage, BaseTask } from '../../../core/types/task';
import type { BaseTask, TaskType, TaskTiming, TaskTokenUsage } from '../../../core/types/task';
import type {
  TechTier,
  FeatureTask,
  ErrorTask,
  SetupTask,
  UiTask,
  DesignSystemTask,
  VerificationTask,
  TestCodeTask,
  DocTask,
  ExplainTask,
} from '@ant/shared';

/**
 * Token Usage Breakdown (for job-level analytics)
 */
export interface TokenUsageBreakdown {
  detect?: TaskTokenUsage;
  decompose?: TaskTokenUsage;          // decompose node
  tasks: {                             // Per-task breakdown
    [taskId: string]: TaskTokenUsage;
  };
  total: TaskTokenUsage;               // Total job usage
}

/**
 * Per-task resume state (populated only when a task is interrupted).
 * Stores individual worker context so that each interrupted task can
 * resume independently during parallel execution.
 */
/**
 * Job-agnostic carry-over state attached to `task.resumeState` at every
 * exit boundary (interruption / reportFailure transient retry / plan
 * batch split). The next worker invocation consumes this in
 * `TaskWorker.executeTask` to rehydrate planText, conversations,
 * retries, etc.
 *
 * Structurally aligned with `WorkerSnapshot` (agents/common/graph/parallelTypes)
 * — `snapshotFromState()` produces values assignable here. All fields are
 * optional so partial snapshots remain valid.
 *
 * Job-specific extensions live in `{Job}TaskResumeState` (e.g.
 * `CodeTaskResumeState`), introduced in T4a to prevent code-only fields
 * (verification carry-over) leaking into design tasks.
 */
export interface BaseTaskResumeState {
  planText?: string;
  conversations?: Record<string, any[]>;
  retries?: number;
  violations?: any[];
  enforcementHistory?: any[];
  tokenUsage?: TaskTokenUsage;
}

/**
 * Code-job resume state. The verification cycle's only carry-over
 * (`task.batchSplitCount`) is a first-class CodeTask field, not a
 * resume-state field — re-queue paths assign it explicitly so it survives
 * even when `resumeState` is omitted.
 */
export interface CodeTaskResumeState extends BaseTaskResumeState {}

/**
 * Design-job resume state. Presently no job-specific fields; the type
 * exists so design tasks never accidentally receive code-only fields
 * (verification carry-over) through a shared alias.
 */
export interface DesignTaskResumeState extends BaseTaskResumeState {}

/**
 * Cross-variant code-task fields.
 *
 * Most fields are populated by execute / plan / verify phases regardless
 * of task type, so they live here. Variants below add only the slots that
 * are TRULY type-specific (e.g. `errors`/`category` on error tasks).
 */
interface CodeTaskCommon {
  /**
   * Per-task technology tiers resolved from decompose's packageTiers map.
   * Array preserves per-package stack info (e.g., [frontend/ts, backend/go]).
   */
  techTiers?: TechTier[];
  /**
   * SSOT for files mutated during execution. Written by tool handlers
   * via `ToolExecutionContext.recordFileTouch`; persisted into
   * `code.json.state.completedTasksDetails[i]` when checkTaskStatus
   * marks the task complete.
   */
  touchedFiles?: string[];
  /**
   * Number of batch-split cycles this task has triggered. SSOT for the
   * `batch_cycle_limit` fail-safe (cap = MAX_BATCH_SPLIT_CYCLES = 10).
   * Carried across re-queues by the orchestrator's `task.resumeState` round-trip.
   */
  batchSplitCount?: number;
  /**
   * Pre-built planText from diagnostic batch split. When present, plan node
   * skips diagnostic generation and uses this directly as planText.
   */
  prePlanText?: string;
  /**
   * Remediation scope mode inherited from the verification plan's
   * `rootCauseSelfCheck.mode`. Consumed by the error execute variant to
   * branch its "Minimal changes" rule between patch / upstream / refactor.
   */
  remediationMode?: 'patch' | 'upstream' | 'refactor';
  /**
   * UI sections required for this task (set by decompose LLM). Used for
   * split injection — only specified sections are loaded into prompt.
   * Meaningful only for `ui` / `design-system` variants.
   */
  uiSections?: string[];
  /**
   * Per-task resume state (exists only when interrupted during parallel
   * execution). Contains the worker's execution context at the time of
   * interruption.
   */
  resumeState?: CodeTaskResumeState;
}

/**
 * Tier-Verification Alignment: Tier 2 (Exploratory, single unit of work) flag.
 *
 * When `true`, this task owns a verification cycle that runs after the
 * apply phase emits `<done>`. Detected via
 * `tasks/_shared/verify/predicate.requiresVerification(task)`:
 *
 *   1. Apply phase — task-type-specific plan/execute applies fixes.
 *      `command.guard` blocks build/test/typecheck (verification is
 *      handled in the next phase).
 *   2. Reverify phase — when execute emits `<done>` with a non-empty
 *      `planText`, `executeRouter` routes to the plan node via the
 *      shared `routeAfterDone` hook. The plan node's `resolvePlanEntry`
 *      detects the apply→verify boundary from observable channel state
 *      (`_activePhase='execute'` + execute's `done` + non-empty `planText`
 *      + `requiresVerification(task) && !isVerificationTask(task)`) and
 *      routes to `handleReverifyEntry`, which commits `_verifyEntered:true`.
 *      From here, the task uses the shared verify-mode plan/execute/command/
 *      check/router surface identical to a Tier 3/4 dedicated verification
 *      task.
 *
 * Set ONLY by decompose for Tier 2 (exactly one task) breakdowns —
 * available on the four task types that can be the sole Tier 2 unit:
 * feature / error / ui / setup. Tier 3/4 breakdowns never set this flag —
 * their dedicated verification task (priority 1000) governs the gates instead.
 */
interface SelfVerifyCapable {
  selfVerifyOnDone?: boolean;
}

export type FeatureCodeTask       = FeatureTask       & CodeTaskCommon & SelfVerifyCapable;
export type ErrorCodeTask         = ErrorTask         & CodeTaskCommon & SelfVerifyCapable & {
  errors?: string[];
  category?: string;
};
export type SetupCodeTask         = SetupTask         & CodeTaskCommon & SelfVerifyCapable;
export type UiCodeTask            = UiTask            & CodeTaskCommon & SelfVerifyCapable;
export type DesignSystemCodeTask  = DesignSystemTask  & CodeTaskCommon;
export type VerificationCodeTask  = VerificationTask  & CodeTaskCommon;
export type TestCodeCodeTask      = TestCodeTask      & CodeTaskCommon;
export type DocCodeTask           = DocTask           & CodeTaskCommon;
export type ExplainCodeTask       = ExplainTask       & CodeTaskCommon;

/**
 * Code-specific task — discriminated union over `type`. Narrow with
 * `task.type === '...'` to expose variant-specific fields (e.g.
 * `band` on FeatureCodeTask, `errors` on ErrorCodeTask).
 */
export type CodeTask =
  | FeatureCodeTask
  | ErrorCodeTask
  | SetupCodeTask
  | UiCodeTask
  | DesignSystemCodeTask
  | VerificationCodeTask
  | TestCodeCodeTask
  | DocCodeTask
  | ExplainCodeTask;

/**
 * Design-specific Task — every design-job task currently has `type: 'doc'`,
 * but this declaration narrows the design surface explicitly so the union
 * shape is consistent with CodeTask. If a future design intent ships a new
 * task type, add a variant here and `decompose` will route accordingly.
 */
export type DesignTask = DocTask & {
  targetFile?: string;             // Which design document (e.g., "be-system-main.md", "wallet-login.md")
  targetDir?: string;              // Optional output directory override. When set, callers (docGen) use it
                                   // instead of designDirOf(targetFile). Used by spec tasks whose filenames
                                   // no longer carry a "spec-" prefix and thus cannot be routed by filename alone.
  targetService?: string;          // MSA: Which service this task targets (e.g., "auth", "order")

  /**
   * Files generated by this task during parallel execution. Workers operate
   * on isolated state copies, so their `state.files` outputs are aggregated
   * back into `result.completedTasks[i].files` by the orchestrator and then
   * spliced into `state.artifacts` by the parallel-merge step in
   * `design/graph.ts`. Mirrors `DesignGraphState.files` shape.
   */
  files?: Array<{
    path: string;
    content: string;
    actionType?: 'create' | 'append' | 'edit' | 'delete';
  }>;

  /**
   * Catalog section names assigned to this task (set by decompose).
   * Defines the EXCLUSIVE scope — this task writes ONLY these sections.
   * Other catalog sections not listed here are FORBIDDEN for this task.
   * e.g. ["§ Overview", "§ Architecture Boundaries"]
   */
  assignedSections?: string[];

  /** Pre-computed at decompose time: true if this is the last task targeting the same file. */
  isLastTaskForDocument?: boolean;

  /** Pre-computed at decompose time: true for non-first chapters that must use <append> in parallel. */
  forceAppend?: boolean;

  /**
   * Source files from `plan/` relevant to this task (set by decompose).
   * MUST be set when multiple source files exist.
   * Can contain 1 or more filenames. e.g. ["prd.md", "tech-constraints.md"]
   * If not set (single file case), all sourceDocuments are injected.
   */
  sourceFiles?: string[];

  /**
   * Artifact pool include patterns (set by decompose, consumed by docGen).
   * Path-prefix patterns matching ARTIFACT_PREFIX values.
   * When set, docGen uses `selectArtifacts(pool, { include: task.include })`
   * instead of hardcoded per-intent defaults.
   * e.g. ["plan", "architecture/system/api-contract-"]
   */
  include?: string[];

  /**
   * Spec chapter decomposition fields.
   * When a spec document is split into sections, each task carries its section context.
   */
  sectionIndex?: number;           // 0-based index of this section (0 = first)
  totalSections?: number;          // Total number of sections for this spec
  sectionScope?: string;           // Description of what this section covers

  /**
   * Per-task technology tiers resolved from decompose's packageTiers map.
   * Used by PromptResolver to deterministically select framework augmentations.
   * Array preserves per-package stack info (e.g., [frontend/ts, backend/go]).
   *
   * Resolved at buildTaskQueue time via targetFile → tag → packageTiers lookup:
   * - be-system-auth.md → packages: ["be-auth"] → packageTiers["be-auth"]
   * - fe-system-main.md → packages: ["fe-main"] → packageTiers["fe-main"]
   */
  techTiers?: TechTier[];

  /**
   * Per-task resume state (exists only when interrupted during parallel execution).
   * Contains the worker's execution context at the time of interruption.
   *
   * Narrowed to `DesignTaskResumeState` so the code-only `verification`
   * snapshot cannot bleed onto the design surface.
   */
  resumeState?: DesignTaskResumeState;
};

/**
 * Generic Task Queue
 * Supports both CodeTask and DesignTask
 */
export class TaskQueue<T extends BaseTask> {
  private tasks: T[] = [];

  /**
   * Unified factory: Array, TaskQueue instance, or undefined/null → TaskQueue instance.
   * Use at every serialization boundary (checkpoint restore, worker state, session resume).
   */
  static from<T extends BaseTask>(data: T[] | TaskQueue<T> | undefined | null): TaskQueue<T> {
    if (data instanceof TaskQueue) return data;
    const q = new TaskQueue<T>();
    if (Array.isArray(data)) {
      data.forEach(t => q.push(t));
    }
    return q;
  }

  push(task: T): void {
    const existingIndex = this.tasks.findIndex(t => t.id === task.id);
    if (existingIndex !== -1) {
      console.warn(`[TaskQueue] Duplicate taskId "${task.id}" — replacing existing entry`);
      this.tasks[existingIndex] = task;
    } else {
      this.tasks.push(task);
    }
    this.tasks.sort((a, b) => a.priority - b.priority);
  }
  
  pop(): T | undefined {
    return this.tasks.shift();
  }
  
  peek(): T | undefined {
    return this.tasks[0];
  }
  
  isEmpty(): boolean {
    return this.tasks.length === 0;
  }
  
  size(): number {
    return this.tasks.length;
  }
  
  removeType(type: TaskType): void {
    this.tasks = this.tasks.filter(t => t.type !== type);
  }
  
  /**
   * Remove a specific task by ID (for parallel task assignment from middle of queue).
   * Returns the removed task, or undefined if not found.
   */
  removeById(id: string): T | undefined {
    const index = this.tasks.findIndex(t => t.id === id);
    if (index === -1) return undefined;
    return this.tasks.splice(index, 1)[0];
  }
  
  /**
   * Insert a task at the front of the queue (highest priority position).
   * Used for interrupted tasks that should be resumed first.
   * Bypasses priority sort — placed at index 0 unconditionally.
   */
  unshift(task: T): void {
    this.tasks.unshift(task);
  }
  
  getAll(): T[] {
    return [...this.tasks];
  }
}
