/**
 * Superseded-session archive — the durability half of the dismiss contract.
 *
 * `interruption.dismissed` promises "explicit /resume stays possible", but
 * `session.state` is a last-writer-wins slot: the first fresh job on the same
 * feature+jobType overwrites the interrupted queue and silently breaks that
 * promise (icy-landing-glade RCA). This module preserves the superseded state
 * as `sessions/{agent}/{jobType}.archived/{jobId}.json` when a fresh run takes
 * over, and lets the /resume route restore it by jobId later.
 *
 * Single owner for both directions (write on takeover, restore on /resume) so
 * the file layout cannot drift between producers and consumers.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SessionableJobType } from '@ant/shared';
import { getSessionFilePath, SESSION_SEARCH_MAP, readSessionTextBoundedAsync } from '../utils/sessionPaths';
import { writeSessionBounded } from './stateBudget';
import type { SessionState } from '../types/session';
import { deriveResumableState } from './resumable';
import { logger } from '../../utils/logger';

/** Newest archives kept per agent/jobType; older ones are pruned on write. */
const ARCHIVE_KEEP = 3;

interface ArchiveEnvelope {
  archivedAt: string;
  agent: string;
  jobType: SessionableJobType;
  state: SessionState;
}

export interface ArchivedStateHit {
  agent: string;
  jobType: SessionableJobType;
  state: SessionState;
  path: string;
}

function archiveDir(featurePath: string, agent: string, jobType: string): string {
  return path.join(featurePath, 'sessions', agent, `${jobType}.archived`);
}

/**
 * Preserve a superseded session state before a fresh run overwrites the live
 * slot. Idempotent per jobId (same-jobId re-archive overwrites). Best-effort:
 * returns false on any failure — a failed archive must never block the new job.
 */
export async function archiveSupersededState(
  featurePath: string,
  agent: string,
  jobType: SessionableJobType,
  state: SessionState,
): Promise<boolean> {
  if (!state?.jobId) return false;
  const dir = archiveDir(featurePath, agent, jobType);
  const envelope: ArchiveEnvelope = {
    archivedAt: new Date().toISOString(),
    agent,
    jobType,
    state,
  };
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    await writeSessionBounded(path.join(dir, `${state.jobId}.json`), envelope);
  } catch (err) {
    logger.warn(
      `[SessionArchive] Failed to archive superseded state (jobId=${state.jobId})`,
      { component: 'SessionArchive' },
      err,
    );
    return false;
  }
  await pruneArchiveDir(dir);
  logger.info(
    `[SessionArchive] Archived superseded state (jobId=${state.jobId}, ${agent}/${jobType})`,
  );
  return true;
}

async function pruneArchiveDir(dir: string): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const files = entries.filter((e) => e.isFile() && e.name.endsWith('.json'));
  if (files.length <= ARCHIVE_KEEP) return;
  const stamped = await Promise.all(
    files.map(async (e) => {
      const p = path.join(dir, e.name);
      try {
        const st = await fs.promises.stat(p);
        return { p, mtime: st.mtimeMs };
      } catch {
        return { p, mtime: 0 };
      }
    }),
  );
  stamped.sort((a, b) => b.mtime - a.mtime);
  for (const victim of stamped.slice(ARCHIVE_KEEP)) {
    await fs.promises.unlink(victim.p).catch(() => {});
  }
}

/** Locate an archived state by jobId across all agent/jobType archive dirs. */
export async function findArchivedState(
  featurePath: string,
  jobId: string,
): Promise<ArchivedStateHit | null> {
  for (const { agent, job } of SESSION_SEARCH_MAP) {
    const p = path.join(archiveDir(featurePath, agent, job), `${jobId}.json`);
    // Bounded on the read's own descriptor — an archived envelope is the same
    // job-state shape as a live session and is read on the resume path
    // (M-NEW-029). Over budget throws and is caught below as "not this one".
    let raw: string | null;
    try {
      raw = await readSessionTextBoundedAsync(p);
    } catch {
      continue;
    }
    if (raw === null) continue;
    try {
      const envelope = JSON.parse(raw) as ArchiveEnvelope;
      if (envelope?.state?.jobId !== jobId) continue;
      return { agent, jobType: job, state: envelope.state, path: p };
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Swap an archived state back into the live session slot so the normal
 * /resume flow can proceed. If the live slot currently holds a DIFFERENT
 * job's resumable work, that state is archived first (symmetric swap — no
 * work is ever silently destroyed by a restore).
 *
 * Returns the restored hit, or null when the archive is missing or the live
 * session file cannot be read/written.
 */
export async function restoreArchivedState(
  featurePath: string,
  jobId: string,
  opts: { onSessionPathTouched?: (sessionPath: string) => void } = {},
): Promise<ArchivedStateHit | null> {
  const hit = await findArchivedState(featurePath, jobId);
  if (!hit) return null;

  const sessionPath = getSessionFilePath(featurePath, hit.agent, hit.jobType);
  let session: any;
  try {
    // Same bounded seam as every other session reader. An over-budget live slot
    // refuses the restore rather than materialising + parsing it (M-NEW-029);
    // the archive file is left in place so no work is destroyed.
    const raw = await readSessionTextBoundedAsync(sessionPath);
    // null = missing/unreadable; over budget throws. Both mean "cannot restore".
    if (raw === null) throw new Error('live session unreadable');
    session = JSON.parse(raw);
  } catch (err) {
    logger.warn(
      `[SessionArchive] Live session unreadable, cannot restore (jobId=${jobId})`,
      { component: 'SessionArchive' },
      err,
    );
    return null;
  }

  const liveState: SessionState | undefined = session?.state;
  if (liveState?.jobId && liveState.jobId !== jobId) {
    const liveVerdict = deriveResumableState(liveState, hit.jobType);
    if (liveVerdict.hasResumableWork) {
      await archiveSupersededState(featurePath, hit.agent, hit.jobType, liveState);
    }
  }

  session.state = hit.state;
  session.updatedAt = new Date().toISOString();
  try {
    await writeSessionBounded(sessionPath, session);
  } catch (err) {
    logger.warn(
      `[SessionArchive] Failed to write restored state (jobId=${jobId})`,
      { component: 'SessionArchive' },
      err,
    );
    return null;
  }
  await fs.promises.unlink(hit.path).catch(() => {});
  opts.onSessionPathTouched?.(sessionPath);
  logger.info(
    `[SessionArchive] Restored archived state into live slot (jobId=${jobId}, ${hit.agent}/${hit.jobType})`,
  );
  return hit;
}

/** Remove a single jobId's archive file (trash-can delete path). */
export async function deleteArchivedState(featurePath: string, jobId: string): Promise<void> {
  const hit = await findArchivedState(featurePath, jobId);
  if (hit) await fs.promises.unlink(hit.path).catch(() => {});
}
