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

/**
 * Token Usage Breakdown (for job-level analytics)
 */
export interface TokenUsageBreakdown {
  detectEnvironment?: TaskTokenUsage;  // detectEnvironment node
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
export interface TaskResumeState {
  planText: string;
  conversationHistory: any[];
  projectCodeContext?: {
    source: string;
    filePaths: string[];
    stats: any;
  };
  retries: number;
  violations?: any[];
  enforcementHistory?: any[];
  tokenUsage?: TaskTokenUsage;
}

/**
 * Code-specific Task
 */
export interface CodeTask extends BaseTask {
  errors?: string[];               // Error messages (for error tasks)
  category?: string;               // Error category (for error tasks)
  /**
   * Pre-built planText from diagnostic batch split.
   * When present, plan node skips diagnostic generation and uses this directly as planText.
   * Created when a diagnostic task detects many errors and splits into sub-tasks.
   */
  prePlanText?: string;
  /**
   * UI task hint (set by decompose LLM).
   * When true, UI docs/assets (Figma-derived) may be injected into prompts.
   */
  ui?: boolean;
  /**
   * UI sections required for this task (set by decompose LLM).
   * Used for split injection - only specified sections are loaded into prompt.
   * 
   * Section types:
   * - Component sections: "gnb", "hero", "about", "ecosystem", "token", "technology", "social", "footer"
   * - Common sections: "layout", "responsive", "accessibility"
   * - Special: "tokens" (ui-tokens.json), "assets" (ui-assets.json)
   * 
   * If ui=true but uiSections is empty/undefined, all UI docs are injected.
   */
  uiSections?: string[];
  /**
   * Target packages for this task (set by decompose LLM).
   * Used for split injection - only specified package design docs are loaded into prompt.
   * 
   * **REQUIRED**: Every task MUST have packages set by decompose.
   * If missing, plan/codeGen falls back to state.design (all docs) with a warning.
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
   */
  resumeState?: TaskResumeState;
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

  /**
   * Source files from inputs/sources/ relevant to this task (set by decompose).
   * MUST be set when multiple source files exist.
   * Can contain 1 or more filenames. e.g. ["prd.md", "tech-constraints.md"]
   * If not set (single file case), all sourceDocuments are injected.
   */
  sourceFiles?: string[];

  /**
   * Spec chapter decomposition fields.
   * When a spec document is split into sections, each task carries its section context.
   */
  sectionIndex?: number;           // 0-based index of this section (0 = first)
  totalSections?: number;          // Total number of sections for this spec
  sectionScope?: string;           // Description of what this section covers

  /**
   * Technology profile resolved from decompose's profiles map.
   * Used by ModeController to deterministically select framework augmentations.
   * 
   * Resolved at buildTaskQueue time via targetFile → tag → profiles lookup:
   * - be-system-auth.md → tag "be-auth" → profiles["be-auth"] || profiles["be-main"]
   * - fe-system-main.md → tag "fe-main" → profiles["fe-main"]
   * - api-contract-auth.md → tag "be-auth" → profiles["be-auth"] || profiles["be-main"]
   */
  profile?: { language: string; framework?: string };

  /**
   * Per-task resume state (exists only when interrupted during parallel execution).
   * Contains the worker's execution context at the time of interruption.
   */
  resumeState?: TaskResumeState;
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
