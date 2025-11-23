/**
 * WorkflowHttpClient
 * 
 * Hexagonal Architecture - Secondary/Driven Adapter (Remote Proxy)
 * 
 * Purpose:
 * - Implements WorkflowStateUpdatePort for child processes
 * - Acts as HTTP client to communicate with parent process server
 * - Enables workflow tracking across process boundaries
 * 
 * Architecture Pattern: Remote Proxy
 * - Core domain defines WorkflowStateUpdatePort (interface)
 * - ExpressServerAdapter implements it directly (in-process)
 * - WorkflowHttpClient implements it via HTTP (out-of-process)
 * 
 * Use Case:
 * - Parent process: ExpressServerAdapter (direct implementation)
 * - Child process: WorkflowHttpClient (HTTP proxy to parent)
 * 
 * Design Principles:
 * - Single Responsibility: HTTP communication only
 * - Dependency Inversion: Depends on port interface, not concrete implementations
 * - Fail-safe: Non-blocking, logs warnings on failure
 */

import { WorkflowStateUpdatePort, TaskInfo } from '../../../../core/ports/workflow';

/**
 * HTTP client for workflow state updates
 * Used by child processes to communicate with parent server
 */
export class WorkflowHttpClient implements WorkflowStateUpdatePort {
  private readonly baseUrl: string;

  /**
   * @param serverPort - Port where parent server is running (default: 4100)
   */
  constructor(serverPort: string = '4100') {
    this.baseUrl = `http://localhost:${serverPort}/api`;
  }

  /**
   * Start job tracking
   * Note: Called by parent server, not needed in child process
   */
  startJob(jobId: string, llmInfo?: import('../../../../core/ports/workflow').LLMInfo): void {
    // No-op: Job is already started by parent server
    // llmInfo is ignored in child process context
  }

  /**
   * Track node entry
   * Notifies parent server that agent entered a graph node
   * ✅ Returns Promise to ensure SSE ordering
   */
  async enterNode(jobId: string, nodeId: string, taskInfo?: TaskInfo, llmInfo?: import('../../../../core/ports/workflow').LLMInfo): Promise<void> {
    console.log(`[WorkflowHttpClient] 📤 Sending enterNode: ${nodeId} (job: ${jobId})`);
    try {
      await this.sendUpdate(jobId, 'enterNode', { nodeId, taskInfo, llmInfo });
      console.log(`[WorkflowHttpClient] ✅ enterNode sent successfully: ${nodeId}`);
    } catch (err: any) {
      console.warn(`[WorkflowHttpClient] ❌ Failed to track enterNode (${nodeId}):`, err.message);
    }
  }

  /**
   * Track node exit
   * Notifies parent server that agent exited a graph node
   */
  exitNode(jobId: string, nodeId: string): void {
    this.sendUpdate(jobId, 'exitNode', { nodeId })
      .catch(err => {
        console.warn(`[WorkflowHttpClient] Failed to track exitNode (${nodeId}):`, err.message);
      });
  }

  /**
   * Track actor interaction start
   * Notifies parent server that agent started interacting with an actor (LLM, DB, etc.)
   */
  startActorInteraction(jobId: string, actorId: string): void {
    this.sendUpdate(jobId, 'startActor', { actorId })
      .catch(err => {
        console.warn(`[WorkflowHttpClient] Failed to track startActor (${actorId}):`, err.message);
      });
  }

  /**
   * Track actor interaction end
   * Notifies parent server that agent finished interacting with an actor
   */
  endActorInteraction(jobId: string, actorId: string): void {
    this.sendUpdate(jobId, 'endActor', { actorId })
      .catch(err => {
        console.warn(`[WorkflowHttpClient] Failed to track endActor (${actorId}):`, err.message);
      });
  }

  /**
   * Track job completion
   * Notifies parent server that job has finished
   */
  endJob(jobId: string): void {
    this.sendUpdate(jobId, 'endJob', {})
      .catch(err => {
        console.warn(`[WorkflowHttpClient] Failed to track endJob:`, err.message);
      });
  }

  /**
   * Send HTTP update to parent server
   * Fire-and-forget pattern with error logging
   * 
   * @private
   */
  private async sendUpdate(jobId: string, action: string, data: Record<string, any>): Promise<void> {
    const url = `${this.baseUrl}/jobs/${jobId}/workflow/update`;
    const payload = {
      action,
      ...data
    };

    console.log(`[WorkflowHttpClient] 🔗 Sending ${action} to ${url}`);
    console.log(`[WorkflowHttpClient] 📦 Payload:`, JSON.stringify(payload, null, 2));

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
        console.error(`[WorkflowHttpClient] ❌ HTTP ${response.status}: ${response.statusText}`);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      console.log(`[WorkflowHttpClient] ✅ Update sent successfully: ${action}`);
    } catch (error: any) {
      console.error(`[WorkflowHttpClient] ❌ Failed to send workflow update:`, error.message);
      // Re-throw for caller to handle
      throw new Error(`Failed to send workflow update: ${error.message}`);
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

