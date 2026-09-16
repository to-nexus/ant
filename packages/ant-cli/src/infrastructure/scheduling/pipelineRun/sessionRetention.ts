/**
 * Run session-file retention — the ONE owner of "how many sealed run files a
 * (agent, job) stem keeps". Every pipeline run seals into its own
 * `sessions/{agentId}/{customJobId}@{runId}.json` (doc 46 §5b), so an
 * activation that fires daily accumulates a file per run; the job-tab history
 * scanner (`listUniversalSessionFiles`) walks them under an entry budget, so
 * unbounded growth would eventually serve a partial history. The reconciler
 * calls this per activation with the live set — a live run's file is never a
 * candidate, whatever its age.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getSessionsDir, parseUniversalSessionStem } from '../../../core/utils/sessionPaths';
import { logger } from '../../../utils/logger';

const COMPONENT = 'PipelineSessionRetention';

/** Sealed run files kept per `{agentId}/{customJobId}` stem (newest first). */
export const RUN_SESSION_FILE_RETENTION = 20;

interface RunFile {
  file: string;
  mtimeMs: number;
}

/**
 * Remove the oldest sealed run files beyond `keep` per stem. Pure fs; never
 * throws — a retention miss costs disk, a throw would fail the reconcile pass.
 * Returns the removed file paths (tests + logs).
 */
export function pruneRunSessionFiles(
  containerPath: string,
  liveRunIds: ReadonlySet<string>,
  keep: number = RUN_SESSION_FILE_RETENTION,
): string[] {
  const removed: string[] = [];
  const sessionsDir = getSessionsDir(containerPath);
  let agentDirs: fs.Dirent[];
  try {
    agentDirs = fs.readdirSync(sessionsDir, { withFileTypes: true });
  } catch {
    return removed;
  }
  for (const agentDir of agentDirs) {
    if (!agentDir.isDirectory() || agentDir.name.startsWith('.')) continue;
    const dir = getSessionsDir(containerPath, agentDir.name);
    const byStem = new Map<string, RunFile[]>();
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const stem = parseUniversalSessionStem(entry.name.slice(0, -'.json'.length));
      // Shared (interactive) files and live runs are never candidates.
      if (!stem.pipelineRunId || liveRunIds.has(stem.pipelineRunId)) continue;
      const file = path.join(dir, entry.name);
      let mtimeMs: number;
      try {
        mtimeMs = fs.statSync(file).mtimeMs;
      } catch {
        continue;
      }
      const list = byStem.get(stem.customJobId) ?? [];
      list.push({ file, mtimeMs });
      byStem.set(stem.customJobId, list);
    }
    for (const files of byStem.values()) {
      files.sort((a, b) => b.mtimeMs - a.mtimeMs);
      for (const { file } of files.slice(keep)) {
        try {
          fs.rmSync(file, { force: true });
          // The adapter's set-aside directory for an oversized seal rides with its file.
          fs.rmSync(`${file.slice(0, -'.json'.length)}.oversized`, { recursive: true, force: true });
          removed.push(file);
        } catch (e) {
          logger.warn(`[Pipeline] could not prune run session file: ${file}`, { component: COMPONENT }, e);
        }
      }
    }
  }
  if (removed.length > 0) {
    logger.info(`[Pipeline] pruned ${removed.length} sealed run session file(s) under ${containerPath}`, { component: COMPONENT });
  }
  return removed;
}
