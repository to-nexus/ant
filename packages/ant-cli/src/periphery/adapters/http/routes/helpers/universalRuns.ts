/**
 * Universal run-record I/O — the single owner of per-run history inside
 * universal container session files.
 *
 * Universal sessions are keyed per (agentId, customJobId) at
 * `{container}/sessions/{agentId}/{customJobId}.json` and owned by the
 * runner (conversation memory). Run history rides the same file's `runs[]`
 * (already part of the Session schema), keyed by the per-run BullMQ jobId —
 * finalize appends via `appendRunToSessionFile`, the helpers below read and
 * delete. All mutation is raw-JSON + atomic rename so unknown fields survive;
 * `state.conversations` / `state.checklist` are never touched.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { KanbanService } from '../../services';
import type { SessionRun } from '../../../../../core/types/session';
import { atomicWriteFile } from '../../../../../core/utils/atomicWriteFile';
import { logger } from '../../../../../utils/logger';
import { deleteArchivedState } from '../../../../../core/session/archive';

export interface UniversalSessionFileRef {
  path: string;
  agentId: string;
  customJobId: string;
}

/**
 * Enumerate `{container}/sessions/{agentDir}/*.json`. Root-level files
 * (chat.jsonl / feature.jsonl) and dotfiles are skipped by construction —
 * only one directory level below `sessions/` is scanned.
 */
export async function listUniversalSessionFiles(containerPath: string): Promise<UniversalSessionFileRef[]> {
  const sessionsDir = path.join(containerPath, 'sessions');
  let agentDirs: fs.Dirent[];
  try {
    agentDirs = await fs.promises.readdir(sessionsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const refs: UniversalSessionFileRef[] = [];
  for (const agentDir of agentDirs) {
    if (!agentDir.isDirectory() || agentDir.name.startsWith('.')) continue;
    let files: fs.Dirent[];
    try {
      files = await fs.promises.readdir(path.join(sessionsDir, agentDir.name), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.json') || file.name.startsWith('.')) continue;
      refs.push({
        path: path.join(sessionsDir, agentDir.name, file.name),
        agentId: agentDir.name,
        customJobId: file.name.slice(0, -'.json'.length),
      });
    }
  }
  return refs;
}

async function readSessionJson(filePath: string): Promise<any | null> {
  try {
    return JSON.parse(await fs.promises.readFile(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/** A run row qualifies as universal history: universal-stamped and jobId-keyed. */
function isUniversalRun(run: any, session: any): boolean {
  if (!run || typeof run.jobId !== 'string' || run.jobId.length === 0) return false;
  // Filter guards against legacy canonical-skeleton pollution inside the
  // container's sessions/ (pre-reconcile residue) leaking bogus rows.
  return run.job === 'universal' || typeof session?.state?.customJobRef === 'string';
}

/**
 * Flattened universal runs across all session files in the container, each
 * tagged with its `{agentId}/{customJobId}` ref (run-level `customJobRef`
 * wins when present — finalize stamps it).
 */
export async function collectUniversalRuns(
  containerPath: string,
): Promise<Array<SessionRun & { customJobRef: string }>> {
  const out: Array<SessionRun & { customJobRef: string }> = [];
  for (const ref of await listUniversalSessionFiles(containerPath)) {
    const session = await readSessionJson(ref.path);
    if (!session || !Array.isArray(session.runs)) continue;
    for (const run of session.runs) {
      if (!isUniversalRun(run, session)) continue;
      out.push({ ...run, customJobRef: run.customJobRef ?? `${ref.agentId}/${ref.customJobId}` });
    }
  }
  return out;
}

/**
 * Locate the session file that references this per-run jobId — via a
 * `runs[]` entry or the sealed `state.jobId` (respond seals the run's HTTP
 * jobId). Used by finalize's mapping-less fallback, per-jobId kanban
 * restore, and DELETE.
 */
export async function findUniversalSessionFileByJobId(
  containerPath: string,
  jobId: string,
): Promise<UniversalSessionFileRef | null> {
  for (const ref of await listUniversalSessionFiles(containerPath)) {
    const session = await readSessionJson(ref.path);
    if (!session) continue;
    if (session.state?.jobId === jobId) return ref;
    if (Array.isArray(session.runs) && session.runs.some((r: any) => r?.jobId === jobId)) return ref;
  }
  return null;
}

/**
 * Remove one run's footprint from its universal session file — the universal
 * counterpart of `deleteJobRunFromSession`. Deliberately does NOT inject the
 * canonical state-reset fields (taskQueue / completedTasks / currentTask):
 * universal state carries a checklist and conversations, not tasks, and must
 * not grow kanban-shaped keys. Only `state.jobId` is nulled when it matches.
 */
export async function deleteUniversalRunFromSession(
  kanbanService: KanbanService | undefined,
  containerPath: string,
  jobId: string,
): Promise<void> {
  await deleteArchivedState(containerPath, jobId).catch(() => {});
  const ref = await findUniversalSessionFileByJobId(containerPath, jobId);
  if (!ref) return;
  const session = await readSessionJson(ref.path);
  if (!session) return;
  let mutated = false;
  if (Array.isArray(session.runs)) {
    const before = session.runs.length;
    session.runs = session.runs.filter((r: any) => r?.jobId !== jobId);
    if (session.runs.length !== before) mutated = true;
  }
  if (session.state?.jobId === jobId) {
    session.state = { ...session.state, jobId: null };
    mutated = true;
  }
  if (mutated) {
    session.updatedAt = new Date().toISOString();
    try {
      await atomicWriteFile(ref.path, JSON.stringify(session, null, 2));
    } catch (err) {
      logger.warn(
        `[UniversalRuns] Failed to write session after jobId removal`,
        { component: 'UniversalRuns' },
        err,
      );
      return;
    }
  }
  kanbanService?.invalidateSessionCache(ref.path);
}
