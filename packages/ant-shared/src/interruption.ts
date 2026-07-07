/**
 * Interruption Types
 *
 * Defines why and how a job was interrupted.
 * Used in session state, Kanban UI, and resume logic.
 */

import { isMidGraphResumable } from './job';

/** Categorizes why a job was interrupted */
export type InterruptionReason =
  | 'recursion_limit'       // Hit recursion limit
  | 'verification_failed'   // Last code task failed verification after max retries
  | 'user_stopped'          // User clicked Stop button
  | 'api_error'             // LLM API error (rate limit, malformed request, etc.)
  | 'llm_auth_failed'       // LLM API key invalid or missing — never resumable (resume re-hits the same key)
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
  | 'awaiting_clarify'      // Turn ended on a <clarify> card; user-actionable, resumes on answer
  | 'unknown';              // Unknown reason

/**
 * Infrastructure/lifecycle interruption reasons — the process/worker/host died
 * or the lock lapsed, as opposed to a model-level, user, or task-logic pause.
 * For these, "resume from where it stopped" only makes sense when the job type
 * checkpoints mid-graph (see `isMidGraphResumable` in job.ts). A non-checkpointing
 * job (plan/visual) can only *restart*, so its `canResume` must be false here.
 */
export const INFRASTRUCTURE_INTERRUPTION_REASONS: readonly InterruptionReason[] = [
  'server_crash',
  'process_crash',
  'server_shutdown',
  'system_sleep',
  'lock_expired',
  'worker_stalled',
];

export function isInfrastructureInterruption(
  reason: InterruptionReason | string | undefined | null,
): boolean {
  return !!reason && (INFRASTRUCTURE_INTERRUPTION_REASONS as readonly string[]).includes(reason);
}

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

/**
 * Single owner for infrastructure-interruption `InterruptionDetails`.
 *
 * `canResume` is computed by the DOCUMENTED rule (see the
 * `INFRASTRUCTURE_INTERRUPTION_REASONS` docstring above): only mid-graph
 * checkpointing job types (code/design/learn) can resume from where they
 * stopped; plan/visual can only restart, so `canResume` is false. Producers
 * (`JobWorker.shutdown`, the job-runner SIGTERM handler, `StaleJobRecovery`)
 * MUST route infra reasons through here so the flag cannot drift per site.
 */
export function buildInfrastructureInterruption(
  reason: InterruptionReason,
  jobType: string | undefined | null,
  message?: string,
): InterruptionDetails {
  const canResume = isMidGraphResumable(jobType);
  return {
    reason,
    message: message ?? defaultInfrastructureMessage(reason, canResume),
    timestamp: new Date().toISOString(),
    canResume,
  };
}

function defaultInfrastructureMessage(reason: InterruptionReason, canResume: boolean): string {
  const tail = canResume ? 'You can resume this job.' : 'This job did not finish.';
  switch (reason) {
    case 'server_shutdown':
      return `Server is shutting down. ${tail}`;
    case 'server_crash':
    case 'process_crash':
      return `Server was terminated unexpectedly. ${tail}`;
    case 'worker_stalled':
      return `Worker process became unresponsive. ${tail}`;
    case 'system_sleep':
      return `System went to sleep and the job was interrupted. ${tail}`;
    case 'lock_expired':
      return `The job lock expired. ${tail}`;
    default:
      return `Job interrupted (${reason}). ${tail}`;
  }
}
