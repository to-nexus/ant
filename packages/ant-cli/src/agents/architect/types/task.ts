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
   * | `fe-main` | `fe-system-design-main.md` | Single frontend |
   * | `fe-{pkg}` | `fe-system-design-{pkg}.md` | Multi frontend (monorepo) |
   * | `be-main` | `be-system-design-main.md` | Single backend |
   * | `be-{svc}` | `be-system-design-{svc}.md` | MSA service |
   * | `shared` | all api-contract-*.md | Shared/utility package (types, DTOs, configs) |
   * 
   * ## Examples
   * 
   * ### Single Package Projects
   * - `['fe-main']` → fe-system-design-main.md
   * - `['be-main']` → be-system-design-main.md
   * - `['fe-main', 'be-main']` → both (fullstack integration)
   * 
   * ### Multi-Package Frontend (Monorepo)
   * - `['fe-web']` → fe-system-design-web.md
   * - `['fe-admin']` → fe-system-design-admin.md
   * 
   * ### MSA Backend
   * - `['be-auth']` → be-system-design-auth.md + api-contract-auth.md
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
  targetFile?: string;             // Which design document (e.g., "be-system-design-main.md")
  targetService?: string;          // MSA: Which service this task targets (e.g., "auth", "order")
  
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
  
  push(task: T): void {
    this.tasks.push(task);
    // Sort by priority (lower number = higher priority)
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
