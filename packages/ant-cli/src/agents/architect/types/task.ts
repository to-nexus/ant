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
   * If ui=true but uiSections is empty/undefined, all UI docs are injected (backward compatible).
   */
  uiSections?: string[];
  /**
   * Target packages for this task (set by decompose LLM).
   * Used for split injection - only specified package design docs are loaded into prompt.
   * 
   * ## Normalized Tag Format
   * 
   * | Tag Pattern | Maps To | Description |
   * |-------------|---------|-------------|
   * | `fe` | `fe-system-design.md` | Single frontend (legacy) |
   * | `fe-{pkg}` | `fe-system-design-{pkg}.md` | Multi frontend (monorepo) |
   * | `be` | `be-system-design.md` | Single backend (legacy) |
   * | `be-{svc}` | `be-system-design-{svc}.md` | MSA service |
   * 
   * ## Examples
   * 
   * ### Single Package Projects
   * - `['fe']` → fe-system-design.md
   * - `['be']` → be-system-design.md
   * - `['fe', 'be']` → both (fullstack integration)
   * 
   * ### Multi-Package Frontend (Monorepo)
   * - `['fe-web']` → fe-system-design-web.md
   * - `['fe-admin']` → fe-system-design-admin.md
   * - `['fe-web', 'fe-shared-ui']` → web app + shared UI library
   * 
   * ### MSA Backend
   * - `['be-auth']` → be-system-design-auth.md
   * - `['be-auth', 'be-order']` → auth + order (inter-service)
   * 
   * ### Cross-Tier Integration
   * - `['fe-web', 'be-auth']` → frontend + specific backend service
   * 
   * ### Default Behavior
   * - `undefined` → environment-based selection (all relevant docs)
   * 
   * ## Note
   * - `api-contract.md` is ALWAYS injected when any package is specified
   * - If undefined, falls back to environment-based selection (legacy behavior)
   */
  packages?: string[];
}

/**
 * Design-specific Task
 */
export interface DesignTask extends BaseTask {
  targetFile?: string;             // Which design document (e.g., "system-design.md")
  targetService?: string;          // MSA: Which service this task targets (e.g., "auth", "order")
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
  
  getAll(): T[] {
    return [...this.tasks];
  }
}
