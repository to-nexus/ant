/**
 * Common Task Types
 * Shared by both code and design jobs
 */

export type TaskType = 'setup' | 'feature' | 'error' | 'explain';

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
}

/**
 * Code-specific Task
 */
export interface CodeTask extends BaseTask {
  errors?: string[];               // Error messages (for error tasks)
  category?: string;               // Error category (for error tasks)
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
