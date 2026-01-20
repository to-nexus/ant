/**
 * Task Types
 * 
 * Code Job: setup | feature | error | explain
 * Design Job: doc (always)
 */
export type TaskType = 'setup' | 'feature' | 'error' | 'explain' | 'doc';

/**
 * Task Timing Information
 */
export interface TaskTiming {
  startedAt?: string;              // ISO timestamp
  completedAt?: string;            // ISO timestamp
  pausedAt?: string;               // When paused
  resumedAt?: string;              // When resumed
  totalPausedDuration: number;     // Total paused time (ms)
  elapsedTime?: number;            // Total elapsed time (ms, excluding paused)
  duration?: string;               // Human-readable (e.g., "2m 30s")
}

/**
 * Task Token Usage Information
 */
export interface TaskTokenUsage {
  inputTokens: number;         // Total input tokens for this task
  outputTokens: number;        // Total output tokens for this task
  totalTokens: number;         // Total tokens (input + output)
  cacheReadTokens?: number;    // Total cached tokens read (Anthropic)
  cacheCreationTokens?: number; // Total cached tokens created (Anthropic)
}

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
 * Base Task Interface
 * Common structure for all job tasks
 */
export interface BaseTask {
  id: string;                      // Unique identifier
  name: string;                    // Task name
  type: TaskType;                  // Task type
  priority: number;                // Lower = higher priority
  description: string;             // What needs to be done
  completed?: boolean;             // Whether done
  interrupted?: boolean;           // Whether interrupted
  timing?: TaskTiming;             // Timing information
  tokenUsage?: TaskTokenUsage;     // Token usage information
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
}

/**
 * Design-specific Task
 */
export interface DesignTask extends BaseTask {
  targetFile?: string;             // Which design document (e.g., "system-design.md")
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
