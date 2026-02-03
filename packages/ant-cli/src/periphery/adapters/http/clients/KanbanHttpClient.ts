/**
 * KanbanHttpClient
 * 
 * Hexagonal Architecture - Secondary/Driven Adapter (Remote Proxy)
 * 
 * Purpose:
 * - Implements TaskQueueUpdatePort for child processes
 * - Acts as HTTP client to communicate with parent process server
 * - Enables Kanban updates across process boundaries
 * 
 * Architecture Pattern: Remote Proxy
 * - Core domain defines TaskQueueUpdatePort (interface)
 * - ExpressServerAdapter implements it directly (in-process)
 * - KanbanHttpClient implements it via HTTP (out-of-process)
 * 
 * Use Case:
 * - Parent process: ExpressServerAdapter (direct implementation)
 * - Child process: KanbanHttpClient (HTTP proxy to parent)
 * 
 * Design Principles:
 * - Single Responsibility: HTTP communication only
 * - Dependency Inversion: Depends on port interface, not concrete implementations
 * - Fail-safe: Non-blocking, logs warnings on failure
 */

import { TaskQueueUpdatePort } from '../../../../core/ports';

/**
 * HTTP client for Kanban/Task Queue updates
 * Used by child processes to communicate with parent server
 */
export class KanbanHttpClient implements TaskQueueUpdatePort {
  private readonly baseUrl: string;

  /**
   * Uses ANT_API_URL environment variable (set by parent process)
   * Fallback: http://localhost:8080 (shouldn't happen in normal operation)
   */
  constructor() {
    // ANT_API_URL is set by parent process (JobWorker, JobExecutionManager)
    const apiUrl = process.env.ANT_API_URL || 'http://localhost:8080';
    this.baseUrl = `${apiUrl}/api`;
  }

  /**
   * Update task queue snapshot
   * Notifies parent server of current task, queue, and completed tasks
   */
  updateTaskQueue(
    taskId: string,
    currentTask: any | undefined,
    queue: any[],
    completedTasks: any[],
    recursionCount?: number,
    recursionLimit?: number
  ): void {
    this.sendUpdate(taskId, currentTask, queue, completedTasks, recursionCount, recursionLimit)
      .catch(err => {
        console.warn(`[KanbanHttpClient] Failed to update task queue:`, err.message);
      });
  }

  /**
   * Send HTTP update to parent server
   * Fire-and-forget pattern with error logging
   * 
   * @private
   */
  private async sendUpdate(
    taskId: string,
    currentTask: any | undefined,
    queue: any[],
    completedTasks: any[],
    recursionCount?: number,
    recursionLimit?: number
  ): Promise<void> {
    const url = `${this.baseUrl}/internal/task-queue`;
    const payload = {
      taskId,
      currentTask,
      queue,
      completedTasks,
      recursionCount,
      recursionLimit
    };

    try {
      // Use native fetch (Node 18+) or fall back to manual HTTP
      const fetch = globalThis.fetch || this.getFetchPolyfill();
      
      // ✅ Build headers with authentication (Cloud mode)
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      
      // ✅ Add user email for Cloud mode authentication
      const userEmail = process.env.ANT_USER_EMAIL;
      if (userEmail) {
        headers['x-user-email'] = userEmail;
      }
      
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      console.log(`[KanbanHttpClient] ✅ Task queue update sent (task: ${taskId}, current: ${currentTask?.name || 'none'})`);
    } catch (error: any) {
      // Re-throw for caller to handle
      throw new Error(`Failed to send Kanban update: ${error.message}`);
    }
  }

  /**
   * Get fetch polyfill for older Node versions
   * @private
   */
  private getFetchPolyfill(): (url: string, options?: any) => Promise<Response> {
    // Use http module as fallback
    return async (url: string, options: any = {}) => {
      const http = await import('http');
      const urlParsed = new URL(url);
      
      return new Promise((resolve, reject) => {
        const req = http.request(
          {
            hostname: urlParsed.hostname,
            port: urlParsed.port,
            path: urlParsed.pathname,
            method: options.method || 'GET',
            headers: options.headers || {},
          },
          (res) => {
            resolve({
              ok: res.statusCode! >= 200 && res.statusCode! < 300,
              status: res.statusCode!,
              statusText: res.statusMessage || '',
            } as any);
          }
        );

        req.on('error', reject);
        if (options.body) {
          req.write(options.body);
        }
        req.end();
      });
    };
  }
}

