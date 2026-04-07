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
   * Absolute maximum total files for regular feature tasks (plan node).
   * Decompose has no limit (file paths are cheap).
   */
  TOTAL_MAX: 20,

  /**
   * Higher file limit for integration/foundation tasks.
   * Integration tasks wire together outputs from ALL parallel feature tasks,
   * so they typically need more files than a single-feature task.
   * Uses the same 3-tier RAG pipeline (keyword → error → semantic) — files
   * are loaded with FULL content (no truncation), selected by relevance.
   */
  INTEGRATION_TOTAL_MAX: 30,

  /**
   * Maximum total characters for all file content in projectCodeContext.
   * 200K chars ≈ ~70K tokens at 2.8 chars/token ratio.
   * Files exceeding this cumulative limit are excluded from content loading
   * (paths still retained). Acts as a safety net alongside file-count limits.
   */
  MAX_CONTEXT_CHARS: 200_000,

  /**
   * Maximum lines per individual file. Files larger than this are truncated
   * to the first MAX_FILE_LINES lines when loaded into projectCodeContext.
   */
  MAX_FILE_LINES: 500,
  
  /**
   * Calculate semantic quota based on already-loaded file count.
   * 
   * @param preloadedCount - Files already loaded (required + error)
   * @param isIntegration - True for integration/foundation tasks (higher limit)
   */
  getSemanticQuota(preloadedCount: number, isIntegration?: boolean): number {
    const max = isIntegration ? this.INTEGRATION_TOTAL_MAX : this.TOTAL_MAX;
    return Math.max(0, max - preloadedCount);
  },

  /**
   * Verification task configuration.
   * Verification tasks list all codebase files (paths-only) and pre-load
   * config/infra files with content. Source files are discovered on demand
   * via build error output.
   */
  VERIFICATION_MAX_FILES: 60,
} as const;
