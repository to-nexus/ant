/**
 * FileTreeHttpClient
 * 
 * Hexagonal Architecture - Secondary/Driven Adapter (Remote Proxy)
 * 
 * Purpose:
 * - Implements FileTreeUpdatePort for child processes
 * - Acts as HTTP client to communicate with parent process server
 * - Enables File Tree updates across process boundaries
 * 
 * Architecture Pattern: Remote Proxy
 * - Core domain defines FileTreeUpdatePort (interface)
 * - ExpressServerAdapter implements it directly (in-process)
 * - FileTreeHttpClient implements it via HTTP (out-of-process)
 * 
 * Use Case:
 * - Parent process: ExpressServerAdapter (direct implementation)
 * - Child process: FileTreeHttpClient (HTTP proxy to parent)
 * 
 * Design Principles:
 * - Single Responsibility: HTTP communication only
 * - Dependency Inversion: Depends on port interface, not concrete implementations
 * - Fail-safe: Non-blocking, logs warnings on failure
 */

import { FileTreeUpdatePort } from '../../../../core/ports';

/**
 * HTTP client for File Tree updates
 * Used by child processes to communicate with parent server
 */
export class FileTreeHttpClient implements FileTreeUpdatePort {
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
   * Notify file tree update
   * Notifies parent server that file tree has changed
   */
  notifyFileTreeUpdate(projectId: string, featureName: string): void {
    this.sendUpdate(projectId, featureName)
      .catch(err => {
        console.warn(`[FileTreeHttpClient] Failed to notify file tree update:`, err.message);
      });
  }

  /**
   * Send HTTP update to parent server
   * Fire-and-forget pattern with error logging
   * 
   * @private
   */
  private async sendUpdate(
    projectId: string,
    featureName: string
  ): Promise<void> {
    const url = `${this.baseUrl}/internal/file-tree-update`;
    const payload = {
      projectId,
      featureName
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
      
      console.log(`[FileTreeHttpClient] ✅ File tree update sent for ${projectId}/${featureName}`);
    } catch (error: any) {
      // Re-throw for caller to handle
      throw new Error(`Failed to send file tree update: ${error.message}`);
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

