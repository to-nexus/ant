/**
 * AsyncMutex
 *
 * Simple async/await-based mutual exclusion lock for single-process concurrency.
 * Used by TaskOrchestrator to serialize access to shared state (taskQueue,
 * runningTasks, completedTasks) across concurrent async workers.
 *
 * NOT suitable for multi-process or multi-pod synchronization.
 * For that, use Redis-based distributed locks.
 */

export class AsyncMutex {
  private locked = false;
  private waitQueue: Array<() => void> = [];

  /**
   * Acquire the lock. If already locked, the caller is suspended
   * until the lock becomes available.
   */
  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }

    return new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  /**
   * Release the lock and wake the next waiter, if any.
   */
  release(): void {
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift()!;
      // Keep locked = true; ownership transfers to next waiter
      next();
    } else {
      this.locked = false;
    }
  }

  /**
   * Execute a function while holding the lock.
   * Guarantees release even if fn throws.
   */
  async runExclusive<T>(fn: () => T | Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /**
   * Check if the lock is currently held (for diagnostics only).
   */
  isLocked(): boolean {
    return this.locked;
  }
}
