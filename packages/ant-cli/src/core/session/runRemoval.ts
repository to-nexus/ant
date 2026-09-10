/**
 * Removing ONE run from a session file — the single owner of that policy for
 * every job type.
 *
 * A session file has the same shape whatever wrote it: `runs[]` is the per-run
 * history and `state` is the LAST run's checkpoint (`updateArtifacts` assigns
 * `session.state = state` wholesale, canonical and universal alike). So the
 * rule is one sentence:
 *
 *   Deleting a run deletes its `runs[]` entry, and — when `state` is pinned to
 *   it — that checkpoint too, keeping only the fields the THREAD owns rather
 *   than the run. With no run left the file has no owner, so it goes.
 *
 * The policy used to live twice (canonical `deleteJobRunFromSession`, universal
 * `deleteUniversalRunFromSession`) and both enumerated what to ERASE — a list
 * that falls behind every field a seal adds, which is how universal came to
 * clear 1 of the 19 keys its seal writes. Here the enumeration is inverted: the
 * table below names what SURVIVES, so a new seal field is run-owned by default.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SessionableJobType } from '@ant/shared';
import { readSessionTextContained } from '../utils/sessionPaths';
import { writeSessionBounded, sessionWriteGuardOf } from './stateBudget';
import { logger } from '../../utils/logger';

/**
 * `state` keys that outlive the run that wrote them. Everything else in `state`
 * belongs to that run and goes with it.
 *
 * Keyed by `SessionableJobType` on purpose: a new job type is a `pnpm typecheck`
 * failure here, not a silently-missing row.
 *
 *  - code/design/learn/visual — nothing. A fresh run overwrites the slot
 *    (`deriveRestoreMode` → 'fresh'); `archiveSupersededState` exists precisely
 *    because that is destructive.
 *  - plan — the planner reads `state.conversations` OUTSIDE any restore-mode
 *    gate and appends to it, so the transcript spans runs.
 *  - universal — the runner continues the (agent, job) thread from
 *    `conversations[channel]`; the channel and ref label it.
 *
 * Deliberately NOT "whatever the runner restores": universal also restores
 * `checklist` / `tokenUsage` / pause markers, but those are the last run's
 * output carried forward as a convenience — every one self-clears at the next
 * seal, and per-run token figures survive in `runs[].kanbanSnapshot`.
 */
export const CROSS_RUN_STATE_KEYS: Record<SessionableJobType, readonly string[]> = {
  code: [],
  design: [],
  learn: [],
  visual: [],
  plan: ['conversations'],
  universal: ['conversations', 'conversationChannel', 'customJobRef'],
};

export interface RunRemovalResult {
  /** The file was rewritten. */
  mutated: boolean;
  /** The file was removed — no run referenced it any more. */
  unlinked: boolean;
}

const NOOP: RunRemovalResult = { mutated: false, unlinked: false };

function keepCrossRun(state: Record<string, unknown>, jobType: SessionableJobType): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const key of CROSS_RUN_STATE_KEYS[jobType]) {
    if (state[key] !== undefined) kept[key] = state[key];
  }
  return kept;
}

/**
 * Drop `jobId`'s footprint from the session file at `sessionPath`.
 *
 * Best-effort by contract: a missing, over-budget or unparseable file is a
 * no-op, and a losing CAS is logged rather than retried (a concurrent seal is
 * newer than what we read). Callers own cache invalidation — this module is
 * `core/` and must not know `KanbanService`.
 */
export async function removeRunFromSessionFile(
  sessionPath: string,
  jobId: string,
  jobType: SessionableJobType,
): Promise<RunRemovalResult> {
  let raw: string | null;
  try {
    raw = await readSessionTextContained(sessionPath);
  } catch (err) {
    logger.warn(
      `[RunRemoval] Session read refused; skipping run removal`,
      { component: 'RunRemoval' },
      { sessionPath, jobId, error: err instanceof Error ? err.message : String(err) },
    );
    return NOOP;
  }
  if (raw === null) return NOOP;

  let session: any;
  try {
    session = JSON.parse(raw);
  } catch (err) {
    logger.warn(
      `[RunRemoval] Session unparseable; skipping run removal`,
      { component: 'RunRemoval' },
      err,
    );
    return NOOP;
  }

  let mutated = false;
  if (Array.isArray(session.runs)) {
    const before = session.runs.length;
    session.runs = session.runs.filter((r: any) => r?.jobId !== jobId);
    if (session.runs.length !== before) mutated = true;
  }
  if (session.state?.jobId === jobId) {
    session.state = keepCrossRun(session.state, jobType);
    mutated = true;
  }
  if (!mutated) return NOOP;

  // No run left AND no live checkpoint pinning the slot: nothing owns the file.
  // A `state.jobId` still set names ANOTHER run — keep the file for it.
  const runless = (!Array.isArray(session.runs) || session.runs.length === 0) && !session.state?.jobId;
  if (runless) {
    try {
      await fs.promises.unlink(sessionPath);
      // Prune the agent directory when this was its last session file. Never
      // recursive: `rmdir` refuses a non-empty directory, which is the guard.
      await fs.promises.rmdir(path.dirname(sessionPath)).catch(() => {});
      logger.info(
        `[RunRemoval] Session file removed — no run left (${jobType})`,
        { component: 'RunRemoval' },
        { sessionPath, jobId },
      );
      return { mutated: true, unlinked: true };
    } catch (err) {
      logger.warn(
        `[RunRemoval] Failed to unlink a runless session; falling back to a rewrite`,
        { component: 'RunRemoval' },
        err,
      );
    }
  }

  session.updatedAt = new Date().toISOString();
  try {
    await writeSessionBounded(sessionPath, session, { expect: sessionWriteGuardOf(raw) });
  } catch (err) {
    logger.warn(
      `[RunRemoval] Failed to write session after run removal`,
      { component: 'RunRemoval' },
      err,
    );
    return NOOP;
  }
  return { mutated: true, unlinked: false };
}
