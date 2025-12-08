/**
 * Retrieval Configuration
 * 
 * Shared config for file retrieval in both decompose and plan nodes
 */

export const RETRIEVAL_CONFIG = {
  /**
   * Maximum files from stack trace (priority: highest)
   */
  MAX_STACK_TRACE: 5,
  
  /**
   * Absolute maximum total files (for plan node only)
   * Decompose has no limit (file paths are cheap)
   */
  TOTAL_MAX: 15,
  
  /**
   * Calculate semantic quota based on stack trace count
   * 
   * CRITICAL: Semantic search MUST exclude stack trace files to avoid wasting quota!
   * 
   * @param stackTraceCount - Number of files already loaded from stack trace
   * @returns Maximum number of NEW semantic files to load (after excluding stack trace files)
   * 
   * @example
   * - stackTrace: 0 → semantic: 15 (use full quota)
   * - stackTrace: 3 → semantic: 12 (15 - 3) ← Can load 12 NEW files
   * - stackTrace: 5 → semantic: 10 (15 - 5) ← Can load 10 NEW files
   * - stackTrace: 10 → semantic: 5  (15 - 10)
   * - stackTrace: 15 → semantic: 0  (quota exhausted)
   */
  getSemanticQuota(stackTraceCount: number): number {
    return Math.max(0, this.TOTAL_MAX - stackTraceCount);
  }
} as const;
