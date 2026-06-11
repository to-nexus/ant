/**
 * Interruption Types
 * 
 * Defines why and how a job was interrupted.
 * Used in session state, Kanban UI, and resume logic.
 */

/** Categorizes why a job was interrupted */
export type InterruptionReason =
  | 'recursion_limit'       // Hit recursion limit
  | 'verification_failed'   // Last code task failed verification after max retries
  | 'user_stopped'          // User clicked Stop button
  | 'api_error'             // LLM API error (rate limit, malformed request, etc.)
  | 'api_overloaded'        // Anthropic API overloaded (HTTP 529, external/transient — not a code defect)
  | 'process_crash'         // Child process crashed unexpectedly
  | 'server_crash'          // Server/worker killed unexpectedly (SIGKILL, OOM, etc.)
  | 'system_sleep'          // System entered sleep mode (wall-clock gap > lock duration)
  | 'lock_expired'          // Redis lock extension failed (network/Redis issue)
  | 'worker_stalled'        // BullMQ stalled event (process unresponsive)
  | 'tasks_failed'          // Parallel task(s) failed during execution
  | 'consecutive_timeouts'  // Consecutive LLM response timeouts
  | 'timeout'               // Job timeout
  | 'server_shutdown'       // Server graceful shutdown
  | 'figma_rate_limited'    // Figma MCP/API rate limit exceeded
  | 'figma_connection_lost' // Figma MCP connection lost (consecutive failures)
  | 'insufficient_credits'  // Credit balance exhausted mid-job (resumable after top-up)
  | 'unknown';              // Unknown reason

/** Details about a job interruption */
export interface InterruptionDetails {
  reason: InterruptionReason;
  message: string;
  timestamp: string;
  canResume: boolean;
  /** Code job: task name when verification failed (learn node) */
  failedTask?: string;
  /** Code job: sample violations when verification failed */
  violations?: Array<{ type: string; message: string }>;
  metadata?: Record<string, any>;
}
