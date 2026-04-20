/**
 * Agent-Specific Task Types
 * 
 * Extends core BaseTask with agent-specific fields.
 * Core types (TaskType, BaseTask, TaskTiming, TaskTokenUsage) are
 * defined in core/types/task.ts (single source of truth).
 */

// Re-export core types for convenience (consumers can import from here)
export type { TaskType, TaskTiming, TaskTokenUsage, BaseTask } from '../../../core/types/task';
import type { TaskType, TaskTiming, TaskTokenUsage, BaseTask } from '../../../core/types/task';
import type { TechTier } from '@ant/shared';

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
  projectCodeContext?: {
    source: string;
    filePaths: string[];
    stats: any;
  };
  retries?: number;
  violations?: any[];
  enforcementHistory?: any[];
  tokenUsage?: TaskTokenUsage;
}

/**
 * Code-job resume state: base fields + verification carry-over.
 *
 * The `_verification*` / `_depFileHash` / `_appliedPlanHistory` fields are
 * @deprecated T4a — kept for the migration window so T5+ can land the
 * hook layer without breaking existing carry-over consumers. T4b removes
 * them and leaves `verification: VerificationSnapshot` as the only
 * verification-domain field.
 */
export interface CodeTaskResumeState extends BaseTaskResumeState {
  /** @deprecated T4a — authority moves to `verification.depHash` in T4b. */
  _depFileHash?: string;
  /** @deprecated T4a — authority moves to `verification.attempts` in T4b. */
  _verificationAttempts?: number;
  /**
   * @deprecated T4a — authority moves to
   * `verification.{required,passed,attemptedThisCycle}` in T4b.
   */
  _verificationTracker?: any;
  /**
   * @deprecated T4a — authority moves to `verification.planHistoryBodies`
   * / `planHistoryHashes` in T4b.
   */
  _appliedPlanHistory?: string[];
  /**
   * VerificationSession snapshot — post-T4a SSOT for verification-domain
   * carry-over. Typed as `any` here to avoid importing from
   * `graph/code/tasks/...` into `types/task.ts` (the module would then
   * participate in a cycle with the graph state).
   * Concrete shape: `VerificationSnapshot` (see
   * `agents/architect/graph/code/tasks/verification/model/snapshot.ts`).
   */
  verification?: any;
}

/**
 * Design-job resume state. Presently no job-specific fields; the type
 * exists so design tasks never accidentally receive code-only fields
 * (verification carry-over, dep-hash, applied plan history, …) through
 * the `TaskResumeState` alias.
 */
export interface DesignTaskResumeState extends BaseTaskResumeState {}

/**
 * Backward-compatible alias — pre-T4a sites referenced a single
 * `TaskResumeState`. New call sites should prefer the concrete
 * `CodeTaskResumeState` / `DesignTaskResumeState` directly. The alias
 * itself will be removed in T4b once the deprecated `_verification*` /
 * `_depFileHash` / `_appliedPlanHistory` fields are dropped from
 * `CodeTaskResumeState`.
 *
 * NOTE: `DesignTask.resumeState` already uses `DesignTaskResumeState` —
 * see below — so the alias's presence does NOT leak code-only fields
 * onto the design surface. It exists purely as an import shim for
 * existing references.
 */
export type TaskResumeState = CodeTaskResumeState;

/**
 * Code-specific Task
 */
export interface CodeTask extends BaseTask {
  /**
   * Per-task technology tiers resolved from decompose's packageTiers map.
   * In fullstack projects, each task inherits techTiers from the
   * packageTiers mapping based on task.packages.
   * Array preserves per-package stack info (e.g., [frontend/ts, backend/go]).
   */
  techTiers?: TechTier[];
  errors?: string[];               // Error messages (for error tasks)
  category?: string;               // Error category (for error tasks)
  /**
   * Pre-built planText from diagnostic batch split.
   * When present, plan node skips diagnostic generation and uses this directly as planText.
   * Created when a diagnostic task detects many errors and splits into sub-tasks.
   */
  prePlanText?: string;
  /**
   * Phase 3-11 — remediation scope mode inherited from the verification plan's
   * `rootCauseSelfCheck.mode` (or a fallback heuristic based on the rootCauses'
   * affectedFiles fan-out). Consumed by the error execute variant to branch
   * its "Minimal changes" rule between patch / upstream / refactor scopes.
   */
  remediationMode?: 'patch' | 'upstream' | 'refactor';
  /**
   * UI sections required for this task (set by decompose LLM).
   * Used for split injection - only specified sections are loaded into prompt.
   *
   * Applies when type is 'ui' or 'design-system'.
   * Section types:
   * - Component sections: "gnb", "hero", "about", "ecosystem", "token", "technology", "social", "footer"
   * - Common sections: "layout", "responsive", "accessibility"
   * - Special: "tokens" (ui-tokens.json), "assets" (ui-assets.json)
   *
   * If uiSections is empty/undefined, all UI docs are injected.
   */
  uiSections?: string[];
  /**
   * Target packages for this task (set by decompose LLM).
   * Used for split injection - only specified package design docs are loaded into prompt.
   * 
   * **REQUIRED**: Every task MUST have packages set by decompose.
   * If missing, plan/execute falls back to all design artifacts in the pool
   * (ARTIFACT_PREFIX.SYSTEM_DESIGN + API_CONTRACT) with a warning.
   * 
   * ## Normalized Tag Format (unified naming: always `{type}-{name}.md`)
   * 
   * | Tag Pattern | Maps To | Description |
   * |-------------|---------|-------------|
   * | `fe-main` | `fe-system-main.md` | Single frontend |
   * | `fe-{pkg}` | `fe-system-{pkg}.md` | Multi frontend (monorepo) |
   * | `be-main` | `be-system-main.md` | Single backend |
   * | `be-{svc}` | `be-system-{svc}.md` | MSA service |
   * | `shared` | all api-contract-*.md | Shared/utility package (types, DTOs, configs) |
   * 
   * ## Examples
   * 
   * ### Single Package Projects
   * - `['fe-main']` → fe-system-main.md
   * - `['be-main']` → be-system-main.md
   * - `['fe-main', 'be-main']` → both (fullstack integration)
   * 
   * ### Multi-Package Frontend (Monorepo)
   * - `['fe-web']` → fe-system-web.md
   * - `['fe-admin']` → fe-system-admin.md
   * 
   * ### MSA Backend
   * - `['be-auth']` → be-system-auth.md + api-contract-auth.md
   * - `['be-auth', 'be-order']` → auth + order (inter-service)
   * 
   * ### Cross-Tier Integration
   * - `['fe-web', 'be-auth']` → frontend + specific backend service
   * 
   * ### Shared / Root Workspace
   * - `['shared']` → all api-contract-*.md only
   * 
   * ## Note
   * - All api-contract-*.md files are ALWAYS injected when any package is specified
   * - `shared` tag has no system design mapping — only api-contracts are injected
   * - If undefined, falls back to environment-based selection (all docs) — this is a decompose bug
   */
  packages?: string[];
  
  /**
   * Per-task resume state (exists only when interrupted during parallel execution).
   * Contains the worker's execution context at the time of interruption.
   *
   * Narrowed to `CodeTaskResumeState` so the verification snapshot and the
   * (deprecated) `_verification*` carry-over fields are visible only on code
   * tasks — design tasks consume `DesignTaskResumeState`.
   */
  resumeState?: CodeTaskResumeState;

  // ── Batch split loop detection ──────────────────────────────────
  // These fields live on the task (not ArchitectGraphState) so they
  // survive re-enqueue across checkTaskStatus state resets.

  /** Total number of batch split cycles this task has triggered. */
  _batchSplitCount?: number;
  /** JSON summary of previous batch split diagnostics (injected into LLM prompt). */
  _previousBatchDiagnostics?: string;
}

/**
 * Design-specific Task
 */
export interface DesignTask extends BaseTask {
  targetFile?: string;             // Which design document (e.g., "be-system-main.md")
  targetService?: string;          // MSA: Which service this task targets (e.g., "auth", "order")

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
   * Source files from inputs/sources/ relevant to this task (set by decompose).
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
   * e.g. ["inputs/sources", "outputs/design/system/api-contract-"]
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
   * Narrowed to `DesignTaskResumeState` (T4 review) so code-only fields
   * such as `verification` / `_verificationTracker` cannot silently bleed
   * onto the design surface via the legacy `TaskResumeState` alias.
   */
  resumeState?: DesignTaskResumeState;
}

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
