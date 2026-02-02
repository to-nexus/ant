import { logger } from '../../../../../../utils/logger';

export type LogCallback = (type: 'stdout' | 'stderr', message: string) => void;

/**
 * HealthChecker
 * 
 * Performs health checks on dev servers to verify they are ready.
 */
export class HealthChecker {
  /**
   * Health check: Try to connect to dev server
   */
  async check(
    port: number, 
    onLog: LogCallback,
    maxAttempts = 20, 
    delayMs = 500
  ): Promise<boolean> {
    logger.debug(`Health check starting for port ${port}`, { component: 'HealthChecker' });
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await fetch(`http://localhost:${port}/`, {
          method: 'GET',
          signal: AbortSignal.timeout(2000)  // 2s timeout per attempt
        });
        
        // Any response (even 404) means server is up
        logger.warn(`[Preview] Health check PASSED for port ${port}`, { component: 'HealthChecker' });
        onLog('stdout', `✅ Dev server is ready on port ${port}`);
        return true;
      } catch (error: any) {
        logger.debug(`Health check failed (${attempt}/${maxAttempts}): ${error.message}`, { component: 'HealthChecker' });
        
        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }
    
    logger.warn(`Health check failed after ${maxAttempts} attempts for port ${port}`, { component: 'HealthChecker' });
    onLog('stderr', `❌ Dev server failed to respond on port ${port} after ${maxAttempts * delayMs / 1000}s`);
    return false;
  }
}
