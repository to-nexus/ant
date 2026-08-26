/**
 * Child Process Environment Variables - Central Definition
 * 
 * ANT uses child processes (job-runner) to execute jobs in isolation.
 * Parent processes inject these env vars when spawning child processes.
 * 
 * These are NOT DevOps-managed (.env) variables.
 * They are runtime-injected by the parent process at spawn time.
 * 
 * Producers (set env vars):
 *   - JobWorker.ts (cloud mode: Job Worker → child process)
 *   - JobExecutionManager.ts (local mode: API Server → child process)
 * 
 * Consumer (reads env vars):
 *   - job-runner.ts (child process entry point)
 *   - LLMResponseService, Broadcasters, customAgents/restApi (within child process)
 */

// ============================================
// Environment Variable Names
// ============================================

/**
 * Runtime env vars injected into child processes.
 * 
 * Usage:
 *   // Producer (setting):
 *   env[CHILD_PROCESS_ENV.JOB_ID] = jobId;
 *   
 *   // Consumer (reading):
 *   const jobId = process.env[CHILD_PROCESS_ENV.JOB_ID];
 */
export const CHILD_PROCESS_ENV = {
  // --- Job Context (required) ---
  /** Unique job identifier */
  JOB_ID: 'ANT_JOB_ID',
  /** Project identifier */
  PROJECT_ID: 'ANT_PROJECT_ID',
  /** Feature name */
  FEATURE: 'ANT_FEATURE',
  /** Feature name alias (for ChatAPIClient compatibility) */
  FEATURE_NAME: 'ANT_FEATURE_NAME',
  /** Job type: code | design | learn */
  JOB_TYPE: 'ANT_JOB_TYPE',
  /** Agent type: architect | reviewer | planner | doc */
  AGENT: 'ANT_AGENT',
  /** Execution mode: generate | refactor | explain */
  MODE: 'ANT_MODE',

  // --- User Context (required) ---
  /** User ID (from authenticated session, NOT from .env) */
  USER_ID: 'ANT_USER_ID',
  /** Organization ID (from authenticated session, NOT from .env) */
  ORG_ID: 'ANT_ORG_ID',
  /** User email (format: userId@orgId) */
  USER_EMAIL: 'ANT_USER_EMAIL',

  // --- Paths (required) ---
  /** Resolved project path (full filesystem path) */
  PROJECT_PATH: 'ANT_PROJECT_PATH',
  /** Resolved feature path (full filesystem path) */
  FEATURE_PATH: 'ANT_FEATURE_PATH',

  // --- Infrastructure (required) ---
  /** Redis URL for direct state access */
  REDIS_URL: 'ANT_REDIS_URL',
  /** ant-api base URL — the origin an `apis` self entry resolves its calls against. */
  API_URL: 'ANT_API_URL',
  /**
   * Job-scoped bearer for the `apis` self entry (cloud only; local mode has no
   * auth gate and mints nothing). Minted by ant-api at job accept, never by a
   * child — the signing key stays in the minting process (C-001). Denied to
   * `run_command` children by the `ANT_*` namespace rule, so LLM-chosen
   * commands never see it.
   */
  SELF_API_TOKEN: 'ANT_SELF_API_TOKEN',

  // --- Optional ---
  /** Override directive text */
  OVERRIDE_DIRECTIVE: 'ANT_OVERRIDE_DIRECTIVE',
  /** Input file path */
  INPUT_FILE: 'ANT_INPUT_FILE',
  /** Whether this is a resume */
  IS_RESUME: 'ANT_IS_RESUME',
  /** Original job ID (for resume) */
  ORIGINAL_JOB_ID: 'ANT_ORIGINAL_JOB_ID',
  /** Whether triggered from chat */
  CHAT_SOURCE: 'ANT_CHAT_SOURCE',
  /** Server mode (local | cloud) */
  SERVER_MODE: 'ANT_SERVER_MODE',
  /** Workspace base path */
  WORKSPACE_BASE_PATH: 'ANT_WORKSPACE_BASE_PATH',
  /** CLI internal root path (for templates, policies) */
  CLI_ROOT: 'ANT_CLI_ROOT',
} as const;

// ============================================
// Type-safe accessor
// ============================================

export type ChildProcessEnvKey = typeof CHILD_PROCESS_ENV[keyof typeof CHILD_PROCESS_ENV];
