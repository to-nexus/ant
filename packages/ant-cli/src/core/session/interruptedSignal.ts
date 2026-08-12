/**
 * Interrupted-job signal — the single derivation of "which interrupted job,
 * with what leftover work, exists on this feature" for consumers that need to
 * REASON about the interruption rather than restore it (triage prompt
 * injection, inline-ask dispatch).
 *
 * Builds on `deriveResumableState` (the resumable verdict SSOT) so the signal
 * cannot drift from the runner/route view of resumability. Unlike the old
 * hand-rolled orchestrator scan, this also surfaces sessions whose final
 * checkpoint was poison-skipped (no explicit `state.interruption`) — the
 * verdict synthesizes `server_crash` for those, and they are just as
 * resumable.
 */

import * as fs from 'fs';
import type { SessionableJobType } from '@ant/shared';
import { getAllSessionPaths } from '../utils/sessionPaths';
import type { SessionState } from '../types/session';
import { deriveResumableState } from './resumable';

export interface InterruptedJobSignal {
  jobId: string;
  jobType: SessionableJobType;
  agent: string;
  canResume: boolean;
  /** Implicit-continuation consent withdrawn (cancelled card dismissed). */
  dismissed: boolean;
  /** Unfinished task names, queue order, capped — names only, never bodies. */
  taskNames: string[];
  interruptedAt?: string;
}

const TASK_NAME_CAP = 8;

function taskName(t: unknown): string | null {
  if (!t || typeof t !== 'object') return null;
  const name = (t as { name?: unknown }).name;
  return typeof name === 'string' && name.trim().length > 0 ? name.trim() : null;
}

/**
 * Unfinished task names from the live queue fields, falling back to the
 * matching run's `kanbanSnapshot` when the queue arrays were already drained
 * (e.g. the final checkpoint recorded the interruption but pruned the queue).
 */
function collectTaskNames(state: SessionState, runs: unknown): string[] {
  const names: string[] = [];
  const push = (t: unknown) => {
    const n = taskName(t);
    if (n && !names.includes(n) && names.length < TASK_NAME_CAP) names.push(n);
  };

  if (state.currentTask) push(state.currentTask);
  for (const t of state.runningTasks ?? []) push(t);
  for (const t of state.taskQueue ?? []) push(t);
  if (names.length > 0) return names;

  if (Array.isArray(runs)) {
    for (let i = runs.length - 1; i >= 0; i--) {
      const run = runs[i] as { jobId?: string; kanbanSnapshot?: { todo?: unknown[]; inProgress?: unknown[] } };
      if (run?.jobId !== state.jobId || !run.kanbanSnapshot) continue;
      for (const t of run.kanbanSnapshot.inProgress ?? []) push(t);
      for (const t of run.kanbanSnapshot.todo ?? []) push(t);
      break;
    }
  }
  return names;
}

/**
 * Work-routing rows for the inline-ask dispatch's `intent:'work'` results.
 *  - 'resume-request': the LLM classified the turn as a continuation request
 *    AND the deterministic gate held (signal exists ∧ canResume) — the FE
 *    obtains consent via a card and calls /jobs/:id/resume.
 *  - 'newJob' (MANDATORY when dismissed): without it the FE's legacy
 *    else-branch auto-POSTs /continue with isResume:true — a silent resume
 *    of dismissed work, the exact breach dismiss exists to prevent.
 *  - {} : live undismissed interruption — legacy /continue path unchanged.
 */
export interface InlineAskWorkRouting {
  action?: 'resume-request' | 'newJob';
  resumeJobId?: string;
  resumeJobType?: string;
  resumeDismissed?: boolean;
  originalDirective?: string;
}

export function deriveInlineAskWorkRouting(
  resumeRequested: boolean,
  interruptedSignal: InterruptedJobSignal | null,
  message: string,
): InlineAskWorkRouting {
  if (resumeRequested && interruptedSignal?.canResume === true) {
    return {
      action: 'resume-request',
      resumeJobId: interruptedSignal.jobId,
      resumeJobType: interruptedSignal.jobType,
      resumeDismissed: interruptedSignal.dismissed,
      originalDirective: message,
    };
  }
  if (interruptedSignal?.dismissed === true) {
    return { action: 'newJob' };
  }
  return {};
}

/**
 * Scan the feature's session files and return the first with leftover work.
 *
 * @param opts.excludeJobId — skip the session currently owned by the caller's
 *   own job (the in-graph triage must not report itself as interrupted).
 */
export function deriveInterruptedJobSignal(
  featurePath: string,
  opts: { excludeJobId?: string } = {},
): InterruptedJobSignal | null {
  for (const entry of getAllSessionPaths(featurePath)) {
    let data: { state?: SessionState; runs?: unknown };
    try {
      data = JSON.parse(fs.readFileSync(entry.path, 'utf-8'));
    } catch {
      continue;
    }
    const state = data.state;
    if (!state?.jobId) continue;
    if (opts.excludeJobId && state.jobId === opts.excludeJobId) continue;

    const verdict = deriveResumableState(state, entry.job);
    if (!verdict.hasResumableWork) continue;

    return {
      jobId: state.jobId,
      jobType: entry.job,
      agent: entry.agent,
      canResume: verdict.canResume,
      dismissed: state.interruption?.dismissed === true,
      taskNames: collectTaskNames(state, data.runs),
      interruptedAt: verdict.interruption?.timestamp,
    };
  }
  return null;
}
