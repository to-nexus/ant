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
   * 
   * ✅ Increased to 20 to handle projects with many files
   * - Most projects have 15-20 uncommitted files during development
   */
  TOTAL_MAX: 20,
  
  /**
   * Calculate semantic quota based on stack trace count
   * 
   * CRITICAL: Semantic search MUST exclude stack trace files to avoid wasting quota!
   * 
   * @param errorFileCount - Number of files already loaded from stack trace
   * @returns Maximum number of NEW semantic files to load (after excluding stack trace files)
   * 
   * @example
   * - errorFiles: 0 → semantic: 15 (use full quota)
   * - errorFiles: 3 → semantic: 12 (15 - 3) ← Can load 12 NEW files
   * - errorFiles: 5 → semantic: 10 (15 - 5) ← Can load 10 NEW files
   * - errorFiles: 10 → semantic: 5  (15 - 10)
   * - errorFiles: 15 → semantic: 0  (quota exhausted)
   */
  getSemanticQuota(errorFileCount: number): number {
    return Math.max(0, this.TOTAL_MAX - errorFileCount);
  }
} as const;
