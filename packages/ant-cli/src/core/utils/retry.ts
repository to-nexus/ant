/**
 * Retry utility for handling transient LLM API errors
 * 
 * Supports:
 * - Exponential backoff
 * - Retry-after header detection
 * - Selective retry based on error type
 */

interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  retryableErrors?: string[];
  /** Callback invoked before each retry attempt (for cleanup/reset) */
  onBeforeRetry?: () => void;
  /** Marker value yielded before retry so consumers can reset accumulated state (streaming only) */
  retryMarker?: any;
}

interface RetryableError {
  error?: {
    type?: string;
    message?: string;
  };
  headers?: any;
  status?: number;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'retryMarker'>> = {
  maxAttempts: 4,
  initialDelayMs: 2000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableErrors: ['overloaded_error', 'api_error'],
  onBeforeRetry: undefined as any,  // Optional callback
};

/**
 * Check if error is retryable
 */
function isRetryableError(error: unknown, retryableErrors: string[]): boolean {
  if (!error || typeof error !== 'object') return false;

  const apiError = error as any;

  // Check for network errors (TypeError with "terminated", "fetch failed", etc.)
  // Also covers idle timeout errors thrown by withStreamIdleTimeout
  if (error instanceof TypeError || (apiError as any)._isStreamIdleTimeout === true) {
    const message = apiError.message?.toLowerCase() || '';
    if ((apiError as any)._isStreamIdleTimeout ||
        message.includes('terminated') ||
        message.includes('fetch failed') ||
        message.includes('network') ||
        message.includes('econnreset') ||
        message.includes('socket')) {
      console.log(`[Retry] Network error detected: ${apiError.message} - will retry`);
      return true;
    }
  }
  
  // Check Anthropic API error format (nested structure)
  // Structure: { error: { type: 'error', error: { type: 'overloaded_error' } } }
  if (apiError.error?.error?.type) {
    return retryableErrors.includes(apiError.error.error.type);
  }
  
  // Check simpler format (direct)
  if (apiError.error?.type) {
    return retryableErrors.includes(apiError.error.type);
  }
  
  // Check generic error with status code
  if (apiError.status && apiError.status >= 500) {
    return true;
  }
  
  return false;
}

/**
 * Extract retry delay from error headers
 */
function getRetryAfterMs(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  
  const apiError = error as any;
  
  // Check for retry-after header (direct)
  if (apiError.headers) {
    const retryAfterHeader = apiError.headers['retry-after'] || apiError.headers.get?.('retry-after');
    
    if (retryAfterHeader) {
      // If it's a number, it's seconds
      if (typeof retryAfterHeader === 'number') {
        return retryAfterHeader * 1000;
      }
      
      // If it's a string, parse it
      if (typeof retryAfterHeader === 'string') {
        const seconds = parseInt(retryAfterHeader, 10);
        if (!isNaN(seconds)) {
          return seconds * 1000;
        }
      }
    }
  }
  
  return null;
}

/**
 * Calculate exponential backoff delay
 */
function calculateBackoffDelay(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
  backoffMultiplier: number
): number {
  const delay = initialDelayMs * Math.pow(backoffMultiplier, attempt - 1);
  return Math.min(delay, maxDelayMs);
}

/**
 * Retry an async function with exponential backoff
 * 
 * @param fn - Async function to retry
 * @param options - Retry configuration
 * @returns Result of the function
 * @throws Last error if all retries fail
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;
  
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Check if error is retryable
      if (!isRetryableError(error, opts.retryableErrors)) {
        console.log(`[Retry] Error is not retryable, throwing immediately`);
        throw error;
      }
      
      // Last attempt, don't wait
      if (attempt === opts.maxAttempts) {
        console.error(`[Retry] ❌ All ${opts.maxAttempts} attempts failed`);
        throw error;
      }
      
      // Calculate delay (ignore retry-after header, use exponential backoff)
      const delay = calculateBackoffDelay(attempt, opts.initialDelayMs, opts.maxDelayMs, opts.backoffMultiplier);
      
      const apiError = error as any;
      // Handle nested error structure
      const errorType = apiError.error?.error?.type || apiError.error?.type || 'unknown';
      const errorMessage = apiError.error?.error?.message || apiError.error?.message || 'Unknown error';
      
      console.log(`[Retry] ⚠️  Attempt ${attempt}/${opts.maxAttempts} failed: ${errorType}`);
      console.log(`[Retry] 📝 ${errorMessage}`);
      console.log(`[Retry] ⏳ Waiting ${(delay / 1000).toFixed(1)}s before retry...`);
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, delay));
      
      console.log(`[Retry] 🔄 Retrying (attempt ${attempt + 1}/${opts.maxAttempts})...`);
    }
  }

  throw lastError;
}

/**
 * Wrap an async iterable with a per-event idle timeout.
 *
 * If no event is received within `idleTimeoutMs`, the iteration is aborted
 * and a retryable "terminated" error is thrown. This handles the case where
 * a network connection appears open (no OS-level error) but data has stopped
 * flowing — e.g., after a Mac sleep/wake cycle or transient network partition.
 */
export async function* withStreamIdleTimeout<T>(
  gen: AsyncIterable<T>,
  idleTimeoutMs: number,
): AsyncIterable<T> {
  const iterator = gen[Symbol.asyncIterator]();
  try {
    while (true) {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          const err = Object.assign(new TypeError('terminated'), { _isStreamIdleTimeout: true });
          reject(err);
        }, idleTimeoutMs);
      });

      let result: IteratorResult<T>;
      try {
        result = await Promise.race([iterator.next(), timeoutPromise]);
        if (timeoutId !== null) clearTimeout(timeoutId);
      } catch (err) {
        if (timeoutId !== null) clearTimeout(timeoutId);
        if (iterator.return) {
          try { await iterator.return(); } catch { /* ignore */ }
        }
        throw err;
      }

      if (result.done) break;
      yield result.value;
    }
  } finally {
    if (iterator.return) {
      try { await iterator.return(); } catch { /* ignore */ }
    }
  }
}

/**
 * Retry wrapper for async generators (streaming)
 * 
 * @param fn - Async generator function to retry
 * @param options - Retry configuration
 * @returns Async generator that yields items from the function
 */
export async function* withRetryStream<T>(
  fn: () => AsyncIterable<T>,
  options: RetryOptions = {}
): AsyncIterable<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;
  
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      for await (const item of fn()) {
        yield item;
      }
      return; // Success
    } catch (error) {
      lastError = error;
      
      // Check if error is retryable
      if (!isRetryableError(error, opts.retryableErrors)) {
        console.log(`[Retry] Error is not retryable, throwing immediately`);
        throw error;
      }
      
      // Last attempt, don't wait
      if (attempt === opts.maxAttempts) {
        console.error(`[Retry] ❌ All ${opts.maxAttempts} attempts failed`);
        throw error;
      }
      
      // Calculate delay (ignore retry-after header, use exponential backoff)
      const delay = calculateBackoffDelay(attempt, opts.initialDelayMs, opts.maxDelayMs, opts.backoffMultiplier);
      
      const apiError = error as any;
      // Handle nested error structure
      const errorType = apiError.error?.error?.type || apiError.error?.type || 'unknown';
      const errorMessage = apiError.error?.error?.message || apiError.error?.message || 'Unknown error';
      
      console.log(`[Retry] ⚠️  Attempt ${attempt}/${opts.maxAttempts} failed: ${errorType}`);
      console.log(`[Retry] 📝 ${errorMessage}`);
      console.log(`[Retry] ⏳ Waiting ${(delay / 1000).toFixed(1)}s before retry...`);
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, delay));
      
      // ✅ Call onBeforeRetry callback if provided (for cleanup/reset)
      if (opts.onBeforeRetry) {
        opts.onBeforeRetry();
      }
      
      // ✅ Yield retry marker so consumers can reset accumulated state
      if (opts.retryMarker !== undefined) {
        yield opts.retryMarker;
      }
      
      console.log(`[Retry] 🔄 Retrying (attempt ${attempt + 1}/${opts.maxAttempts})...`);
    }
  }
  
  throw lastError;
}

