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
  },

  /**
   * Exclusive task configuration
   * 
   * Exclusive tasks (e.g., application-integration, verification) need access to
   * ALL codebase files because they wire together outputs from all feature tasks.
   * RAG keyword search is insufficient — these tasks load the full codebase directly.
   */
  EXCLUSIVE_MAX_FILES: 60,
  EXCLUSIVE_MAX_FILE_LINES: 200,

  /**
   * Universal core file patterns for exclusive tasks (Option B optimization).
   * These match regardless of detected language.
   *
   * Core files: loaded with FULL CONTENT (essential for wiring/verification).
   * Reference files: loaded as PATH ONLY (LLM uses read_file if needed).
   *
   * Patterns are matched against the file path (case-insensitive).
   */
  EXCLUSIVE_CORE_PATTERNS_UNIVERSAL: [
    'docker-compose', 'dockerfile', 'makefile',
    '.env.example', '.env',
    'router', 'routes', 'server.',
    'migration',
  ] as readonly string[],

  /**
   * Language-specific core file patterns.
   * Selected at runtime via state.detectionReport.profile.language.
   * Unknown languages fall back to 'typescript' (widest coverage).
   */
  EXCLUSIVE_CORE_PATTERNS_BY_LANGUAGE: {
    typescript: ['package.json', 'tsconfig', 'index.', 'app.', 'next.config', 'vite.config'],
    go:         ['go.mod', 'go.sum', 'cmd/', 'main.go'],
    python:     ['requirements.txt', 'pyproject.toml', 'manage.py', 'app.py', 'main.py', 'wsgi', 'asgi'],
    rust:       ['Cargo.toml', 'main.rs', 'lib.rs', 'build.rs'],
    java:       ['pom.xml', 'build.gradle', 'Main.java', 'Application.java'],
  } as Record<string, readonly string[]>,

  /**
   * Maximum number of core files allowed for exclusive tasks.
   * If more files match core patterns, excess files become reference files.
   */
  EXCLUSIVE_MAX_CORE_FILES: 25,
} as const;
