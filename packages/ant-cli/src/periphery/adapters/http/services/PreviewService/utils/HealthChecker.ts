import { logger } from '../../../../../../utils/logger';
import type { LogCallback } from '../types';

// Cloud environments (EFS/NFS) are slower for initial compilation.
// Next.js first build can take 30-60+ seconds on network filesystems.
const DEFAULT_MAX_ATTEMPTS = 60;
const DEFAULT_DELAY_MS = 1000;

/**
 * HealthChecker
 * 
 * Performs health checks on dev servers to verify they are ready.
 * Default timeout: 60 attempts × 1s = 60s (sufficient for Next.js on EFS).
 */
export class HealthChecker {
  /**
   * Health check: Try to connect to dev server
   */
  async check(
    port: number, 
    onLog: LogCallback,
    maxAttempts = DEFAULT_MAX_ATTEMPTS, 
    delayMs = DEFAULT_DELAY_MS,
    signal?: AbortSignal
  ): Promise<boolean> {
    const totalTimeoutSec = Math.round(maxAttempts * delayMs / 1000);
    logger.debug(`Health check starting for port ${port} (max ${totalTimeoutSec}s)`, { component: 'HealthChecker' });
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (signal?.aborted) {
        logger.debug(`Health check aborted for port ${port} at attempt ${attempt}`, { component: 'HealthChecker' });
        return false;
      }

      try {
        // Use 127.0.0.1 explicitly to avoid IPv6 resolution issues
        const response = await fetch(`http://127.0.0.1:${port}/`, {
          method: 'GET',
          signal: AbortSignal.timeout(3000)  // 3s timeout per attempt
        });
        
        // Any response (even 404) means server is up
        logger.warn(`[Preview] Health check PASSED for port ${port} (attempt ${attempt})`, { component: 'HealthChecker' });
        onLog('stdout', `✅ Dev server is ready on port ${port}`);
        return true;
      } catch (error: any) {
        if (signal?.aborted) {
          logger.debug(`Health check aborted for port ${port} at attempt ${attempt}`, { component: 'HealthChecker' });
          return false;
        }

        if (attempt % 10 === 0) {
          logger.debug(`Health check in progress (${attempt}/${maxAttempts}): ${error.message}`, { component: 'HealthChecker' });
          onLog('stdout', `⏳ Waiting for dev server... (${attempt}/${maxAttempts})`);
        }
        
        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }
    
    logger.warn(`Health check failed after ${maxAttempts} attempts for port ${port}`, { component: 'HealthChecker' });
    onLog('stderr', `❌ Dev server failed to respond on port ${port} after ${totalTimeoutSec}s`);
    return false;
  }
}
