/**
 * Active custom-job definition — module singleton, job-runner child ONLY.
 *
 * One job = one child process, so the active definition is process-global
 * derived state whose SSOT is the workspace disk (no in-memory-fallback rule
 * is not violated: this is a load-once view, not a Redis mirror). The server
 * process must never activate a definition — it only lists summaries.
 */

import type { ResolvedCustomJob } from './types.js';

let active: ResolvedCustomJob | null = null;

export function activateCustomJob(job: ResolvedCustomJob): void {
  if (active) {
    throw new Error(
      `Custom job already active (${active.agentId}/${active.jobId}) — activation is once-per-process (job-runner child only)`,
    );
  }
  active = job;
}

/** Returns null when the process runs a builtin job (or the server). */
export function getActiveCustomJob(): ResolvedCustomJob | null {
  return active;
}

/** Throwing accessor for universal-graph nodes, which must have a definition. */
export function requireActiveCustomJob(): ResolvedCustomJob {
  if (!active) {
    throw new Error('No active custom job — universal graph nodes require an activated definition');
  }
  return active;
}

/** Test-only reset. */
export function _resetActiveCustomJobForTests(): void {
  active = null;
}
