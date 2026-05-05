/**
 * Debug Artifact Retention SSOT
 *
 * `sessions/{agent}/debug/{subdir}/` accumulates `prompt-{jobId}.md`,
 * `plan-{jobId}.md`, `tokens-{jobId}.json`, etc. for every completed job.
 * Without retention, long-running features bloat to GBs over weeks.
 *
 * Activation: idle-loop only (60s tick). NOT called on `finalizeTerminalJob`
 * to avoid double-prune within the retention window.
 *
 * Active-job protection (3-source union — see Phase 5 plan §A.2):
 *   (a) `state.jobId` from every session.json (5 files: architect/{code,
 *       design,learn} + planner/plan + creator/visual)
 *   (b) Redis `JOB.STATUS` with status ∈ {pending, queued, running}
 *   (c) `mtime < now - 1h` conservative fallback for files whose jobId
 *       has not yet been written into either source
 *
 * Files matching ANY of (a)/(b)/(c) are kept; everything else is pruned
 * by `mtime <= now - maxAgeDays` OR `index >= maxFilesPerSubdir`.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { StateStorePort } from '../ports/stateStore';
import {
  DEBUG_SUBDIRS,
  getAllSessionPaths,
  getSessionDebugDir,
} from './sessionPaths';
import { logger } from '../../utils/logger';

export interface DebugRetentionPolicy {
  maxFilesPerSubdir: number;
  maxAgeDays: number;
}

export const DEFAULT_DEBUG_RETENTION: DebugRetentionPolicy = (() => {
  const days = Number(process.env.ANT_DEBUG_RETENTION_DAYS);
  const max = Number(process.env.ANT_DEBUG_RETENTION_MAX);
  return {
    maxAgeDays: Number.isFinite(days) && days > 0 ? days : 14,
    maxFilesPerSubdir: Number.isFinite(max) && max > 0 ? max : 50,
  };
})();

const ONE_HOUR_MS = 60 * 60 * 1000;
const ACTIVE_REDIS_STATUSES = new Set(['pending', 'queued', 'running']);

export interface PruneStats {
  removed: number;
  kept: number;
  protectedActive: number;
}

export interface PruneOptions {
  policy?: DebugRetentionPolicy;
  /** Optional: skips Redis lookup when undefined (e.g. unit tests). */
  stateStore?: StateStorePort;
  /**
   * Required for Redis active-job lookup. When omitted alongside `stateStore`,
   * source (b) is skipped and only sources (a)+(c) protect files.
   */
  context?: { projectId: string; featureName: string };
  /** Override `now` for deterministic tests. */
  nowMs?: number;
}

const JOB_ID_PATTERN = /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i;

function extractJobId(fileName: string): string | undefined {
  const m = fileName.match(JOB_ID_PATTERN);
  return m ? m[1].toLowerCase() : undefined;
}

async function readActiveJobIdsFromSessions(featurePath: string): Promise<Set<string>> {
  const ids = new Set<string>();
  await Promise.all(
    getAllSessionPaths(featurePath).map(async ({ path: sessionPath }) => {
      try {
        const raw = await fs.promises.readFile(sessionPath, 'utf-8');
        const session = JSON.parse(raw);
        const jobId = session?.state?.jobId;
        if (typeof jobId === 'string' && jobId.length > 0) ids.add(jobId.toLowerCase());
      } catch {
        // ENOENT / parse error — treat as no active job
      }
    }),
  );
  return ids;
}

async function readActiveJobIdsFromRedis(
  stateStore: StateStorePort | undefined,
  ctx: PruneOptions['context'],
): Promise<Set<string>> {
  const ids = new Set<string>();
  if (!stateStore || !ctx) return ids;
  try {
    const jobs = await stateStore.listJobsByFeature(ctx.projectId, ctx.featureName);
    for (const j of jobs) {
      if (j.jobId && ACTIVE_REDIS_STATUSES.has(j.status)) ids.add(j.jobId.toLowerCase());
    }
  } catch (err) {
    logger.warn(
      `[debugRetention] Redis active-job lookup failed (continuing with sessions only)`,
      { component: 'debugRetention' },
      err,
    );
  }
  return ids;
}

async function pruneSubdir(
  dir: string,
  protectedJobIds: Set<string>,
  policy: DebugRetentionPolicy,
  nowMs: number,
): Promise<PruneStats> {
  const stats: PruneStats = { removed: 0, kept: 0, protectedActive: 0 };
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return stats;
  }

  const files: { name: string; mtimeMs: number }[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    try {
      const st = await fs.promises.stat(path.join(dir, entry.name));
      files.push({ name: entry.name, mtimeMs: st.mtimeMs });
    } catch {
      // race with concurrent unlink
    }
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const ageThresholdMs = nowMs - policy.maxAgeDays * 24 * 60 * 60 * 1000;
  const recencyThresholdMs = nowMs - ONE_HOUR_MS;

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const jobId = extractJobId(f.name);
    const isActive = jobId !== undefined && protectedJobIds.has(jobId);
    const isRecent = f.mtimeMs >= recencyThresholdMs;

    if (isActive || isRecent) {
      stats.kept += 1;
      if (isActive) stats.protectedActive += 1;
      continue;
    }

    const overAge = f.mtimeMs < ageThresholdMs;
    const overCount = i >= policy.maxFilesPerSubdir;
    if (overAge || overCount) {
      try {
        await fs.promises.unlink(path.join(dir, f.name));
        stats.removed += 1;
      } catch (err) {
        logger.warn(
          `[debugRetention] Failed to unlink debug file: ${f.name}`,
          { component: 'debugRetention' },
          err,
        );
        stats.kept += 1;
      }
    } else {
      stats.kept += 1;
    }
  }

  return stats;
}

/**
 * Prune debug artifacts for a feature.
 *
 * Idempotent and concurrency-safe: another process may delete files between
 * `readdir` and `unlink` — handled silently.
 */
export async function pruneDebugArtifacts(
  featurePath: string,
  options: PruneOptions = {},
): Promise<PruneStats> {
  const policy = options.policy ?? DEFAULT_DEBUG_RETENTION;
  const nowMs = options.nowMs ?? Date.now();

  const [sessionIds, redisIds] = await Promise.all([
    readActiveJobIdsFromSessions(featurePath),
    readActiveJobIdsFromRedis(options.stateStore, options.context),
  ]);
  const protectedJobIds = new Set<string>([...sessionIds, ...redisIds]);

  const aggregate: PruneStats = { removed: 0, kept: 0, protectedActive: 0 };
  for (const [agent, subdirs] of Object.entries(DEBUG_SUBDIRS)) {
    for (const subdir of subdirs) {
      const dir = getSessionDebugDir(featurePath, agent, subdir);
      const s = await pruneSubdir(dir, protectedJobIds, policy, nowMs);
      aggregate.removed += s.removed;
      aggregate.kept += s.kept;
      aggregate.protectedActive += s.protectedActive;
    }
  }

  if (aggregate.removed > 0) {
    logger.info(
      `[debugRetention] pruned ${aggregate.removed} files (kept=${aggregate.kept}, active=${aggregate.protectedActive}) under ${featurePath}`,
      { component: 'debugRetention' },
    );
  }

  return aggregate;
}

export const __test = { extractJobId };
