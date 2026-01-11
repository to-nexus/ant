/**
 * Utility functions for runtime validation
 */

import { ArchitectGraphState } from "../../state";
import { RuntimeValidationResult } from "./types";

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Detect recent tool failures from command history
 */
export function detectRecentToolFailures(state: ArchitectGraphState): number {
  if (!state.commandHistory || state.commandHistory.length === 0) {
    return 0;
  }
  
  const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
  const recentFailures = state.commandHistory.filter(h => 
    !h.success && 
    h.timestamp > fiveMinutesAgo
  );
  
  return recentFailures.length;
}

/**
 * Format validation errors for display
 */
export function formatValidationErrors(result: RuntimeValidationResult): string[] {
  const lines: string[] = [];
  
  if (result.typeErrors && result.typeErrors.length > 0) {
    lines.push('📘 Type Errors:');
    result.typeErrors.slice(0, 5).forEach(err => lines.push(`  - ${err}`));
    if (result.typeErrors.length > 5) {
      lines.push(`  ... and ${result.typeErrors.length - 5} more`);
    }
    lines.push('');
  }
  
  if (result.lintErrors && result.lintErrors.length > 0) {
    lines.push('📋 Lint Errors (LOW PRIORITY - Fix after build/deps/types):');
    result.lintErrors.slice(0, 5).forEach(err => lines.push(`  - ${err}`));
    if (result.lintErrors.length > 5) {
      lines.push(`  ... and ${result.lintErrors.length - 5} more`);
    }
    lines.push('');
  }
  
  if (result.buildErrors && result.buildErrors.length > 0) {
    lines.push('🔨 Build Errors:');
    result.buildErrors.slice(0, 5).forEach(err => lines.push(`  - ${err}`));
    if (result.buildErrors.length > 5) {
      lines.push(`  ... and ${result.buildErrors.length - 5} more`);
    }
    lines.push('');
  }
  
  if (result.testErrors && result.testErrors.length > 0) {
    lines.push('🧪 Test Errors:');
    result.testErrors.forEach(err => lines.push(`  - ${err}`));
    lines.push('');
  }
  
  lines.push('⚠️  Please fix these errors and regenerate.');
  
  return lines;
}

/**
 * Wait for a server to become available using polling
 * 
 * Instead of fixed sleep, polls the server until it responds or timeout.
 * 
 * @param url - URL to check (e.g., "http://localhost:3000/")
 * @param options - Configuration options
 * @returns Object with success status and timing info
 * 
 * @example
 * // Wait up to 30 seconds for server to start
 * const result = await waitForServer("http://localhost:3001/", { maxAttempts: 30 });
 * if (result.success) {
 *   console.log(`Server ready in ${result.elapsedMs}ms`);
 * } else {
 *   console.log("Server failed to start");
 * }
 */
export async function waitForServer(
  url: string,
  options: {
    /** Maximum number of attempts (default: 30) */
    maxAttempts?: number;
    /** Interval between attempts in ms (default: 1000) */
    intervalMs?: number;
    /** Expected HTTP status codes for success (default: [200, 301, 302, 304]) */
    acceptedStatusCodes?: number[];
  } = {}
): Promise<{
  success: boolean;
  attempts: number;
  elapsedMs: number;
  error?: string;
}> {
  const {
    maxAttempts = 30,
    intervalMs = 1000,
    acceptedStatusCodes = [200, 301, 302, 304]
  } = options;
  
  const startTime = Date.now();
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s per request timeout
      
      const response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (acceptedStatusCodes.includes(response.status)) {
        return {
          success: true,
          attempts: attempt,
          elapsedMs: Date.now() - startTime
        };
      }
    } catch (error) {
      // Connection refused, timeout, etc. - server not ready yet
    }
    
    // Wait before next attempt (unless it's the last attempt)
    if (attempt < maxAttempts) {
      await sleep(intervalMs);
    }
  }
  
  return {
    success: false,
    attempts: maxAttempts,
    elapsedMs: Date.now() - startTime,
    error: `Server at ${url} did not respond after ${maxAttempts} attempts (${Math.round((Date.now() - startTime) / 1000)}s)`
  };
}

/**
 * Start a server in background and wait for it to be ready
 * 
 * @param commandPort - Command execution port
 * @param serverCommand - Command to start the server
 * @param healthCheckUrl - URL to poll for readiness
 * @param options - Configuration options
 */
export async function startServerAndWait(
  commandPort: { execute: (cmd: string, opts?: any) => Promise<any> },
  serverCommand: string,
  healthCheckUrl: string,
  options: {
    cwd?: string;
    maxAttempts?: number;
    intervalMs?: number;
  } = {}
): Promise<{
  success: boolean;
  serverOutput?: string;
  error?: string;
}> {
  const { cwd, maxAttempts = 30, intervalMs = 1000 } = options;
  
  // Start server in background (don't wait for completion)
  const serverPromise = commandPort.execute(serverCommand, {
    cwd,
    timeout: 60000 // 1 minute timeout for server startup
  });
  
  // Poll for server readiness
  const waitResult = await waitForServer(healthCheckUrl, {
    maxAttempts,
    intervalMs
  });
  
  if (waitResult.success) {
    return {
      success: true,
      serverOutput: `Server started successfully in ${waitResult.elapsedMs}ms (${waitResult.attempts} attempts)`
    };
  }
  
  return {
    success: false,
    error: waitResult.error
  };
}

