/**
 * Active custom-job definition — module singleton, job-runner child ONLY.
 *
 * One job = one child process, so the active definition is process-global
 * derived state whose SSOT is the workspace disk (no in-memory-fallback rule
 * is not violated: this is a load-once view, not a Redis mirror). The server
 * process must never activate a definition — it only lists summaries.
 */

import type { CustomAgentScopeRoot } from './CustomAgentLoader.js';
import type { ResolvedCustomJob } from './types.js';

let active: ResolvedCustomJob | null = null;
let activeScopeRoots: CustomAgentScopeRoot[] = [];

/**
 * `scopeRoots` rides along because the agent plane resolves PEER definitions
 * (`_agents/{agentId}/…`) from the same ordered roots the child already
 * derived to load this job — a second derivation site would be a second
 * authority.
 */
export function activateCustomJob(job: ResolvedCustomJob, scopeRoots: CustomAgentScopeRoot[] = []): void {
  if (active) {
    throw new Error(
      `Custom job already active (${active.agentId}/${active.jobId}) — activation is once-per-process (job-runner child only)`,
    );
  }
  active = job;
  activeScopeRoots = scopeRoots;
}

/** Definition scope roots of the activated job (empty outside a universal child). */
export function getActiveCustomAgentScopeRoots(): CustomAgentScopeRoot[] {
  return activeScopeRoots;
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
  activeScopeRoots = [];
}
