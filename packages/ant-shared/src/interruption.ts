/**
 * Interruption Types
 * 
 * Defines why and how a job was interrupted.
 * Used in session state, Kanban UI, and resume logic.
 */

/** Categorizes why a job was interrupted */
export type InterruptionReason =
  | 'recursion_limit'      // Hit recursion limit
  | 'user_stopped'         // User clicked Stop button
  | 'api_error'            // LLM API error (overloaded, rate limit, etc.)
  | 'process_crash'        // Child process crashed unexpectedly
  | 'server_crash'         // Server/worker killed unexpectedly (SIGKILL, OOM, etc.)
  | 'timeout'              // Job timeout
  | 'server_shutdown'      // Server graceful shutdown
  | 'figma_rate_limited'   // Figma MCP/API rate limit exceeded
  | 'figma_connection_lost' // Figma MCP connection lost (consecutive failures)
  | 'unknown';             // Unknown reason

/** Details about a job interruption */
export interface InterruptionDetails {
  reason: InterruptionReason;
  message: string;
  timestamp: string;
  canResume: boolean;
  metadata?: Record<string, any>;
}
