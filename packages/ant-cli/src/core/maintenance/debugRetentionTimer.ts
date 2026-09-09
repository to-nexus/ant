/**
 * Debug Retention Timer — periodic prune of `sessions/{agent}/debug/*`.
 *
 * Walks the workspace tree on a 60s tick and prunes every feature
 * directory under it. Independent of IDE pod existence — debug files
 * accumulate even after a feature's IDE has terminated.
 *
 * SSOT: see `core/utils/debugRetention.ts` for the policy + 3-source
 * active-job protection.
 */

import * as fs from 'fs';
import * as path from 'path';
import { featureSlugToName } from '@ant/shared';
import type { StateStorePort } from '../ports/stateStore';
import { pruneDebugArtifacts } from '../utils/debugRetention';
import { logger } from '../../utils/logger';

const DEFAULT_TICK_MS = 60_000;

/**
 * Cluster-wide leader lock for one sweep. Every API pod starts this timer, and
 * they all mount the SAME shared workspace tree — so without a lock the whole
 * tree is walked once per pod per tick, and each pod duplicates the other's
 * work (and its log lines) against shared storage. Same idiom as
 * `ant:lock:stale-job-recovery`; held for the tick, released in `finally`.
 */
const SWEEP_LOCK_KEY = 'ant:lock:debug-retention';

export interface DebugRetentionTimerOptions {
  workspacesPath: string;
  stateStore?: StateStorePort;
  tickMs?: number;
}

export interface DebugRetentionTimer {
  stop(): void;
}

export function startDebugRetentionTimer(
  options: DebugRetentionTimerOptions,
): DebugRetentionTimer {
  const tickMs = options.tickMs ?? DEFAULT_TICK_MS;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    // TTL slightly under the tick so a pod that dies mid-sweep cannot park the
    // lock for longer than one missed tick.
    const lockTtlSeconds = Math.max(1, Math.floor((tickMs / 1000) * 0.9));
    let holdsLock = false;
    try {
      if (options.stateStore) {
        holdsLock = await options.stateStore.acquireLock(SWEEP_LOCK_KEY, lockTtlSeconds).catch(() => true);
        if (!holdsLock) {
          logger.debug(`another pod holds the sweep lock — skipping this tick`, { component: 'debugRetentionTimer' });
          return;
        }
      }
      const features = await listAllFeaturePaths(options.workspacesPath);
      for (const feat of features) {
        await pruneDebugArtifacts(feat.featurePath, {
          stateStore: options.stateStore,
          context: {
            userContext: feat.userContext,
            projectId: feat.projectId,
            featureName: feat.featureName,
          },
        });
      }
    } catch (err) {
      logger.warn(
        `tick failed`,
        { component: 'debugRetentionTimer' },
        err,
      );
    } finally {
      if (holdsLock && options.stateStore) {
        await options.stateStore.releaseLock(SWEEP_LOCK_KEY).catch(() => { /* TTL reclaims it */ });
      }
      running = false;
    }
  };

  const handle = setInterval(() => {
    void tick();
  }, tickMs);
  if (handle.unref) handle.unref();

  logger.info(
    `started — base=${options.workspacesPath} tick=${tickMs}ms`,
    { component: 'debugRetentionTimer' },
  );

  return {
    stop: () => {
      clearInterval(handle);
      logger.info(`stopped`, { component: 'debugRetentionTimer' });
    },
  };
}

interface FeatureRef {
  featurePath: string;
  projectId: string;
  featureName: string;
  /** Owning tenant — the jobsByFeature index is tenant-scoped. */
  userContext: { organizationId: string; userId: string };
}

/**
 * Walk `${base}/${org}/${user}/${project}/features/${feature}` and yield
 * every feature directory. Tolerant of missing/transient dirs (returns
 * partial result on permission errors).
 */
async function listAllFeaturePaths(base: string): Promise<FeatureRef[]> {
  const out: FeatureRef[] = [];
  const orgs = await safeReaddir(base);
  for (const org of orgs) {
    const userDir = path.join(base, org);
    const users = await safeReaddir(userDir);
    for (const user of users) {
      const projectDir = path.join(userDir, user);
      const projects = await safeReaddir(projectDir);
      for (const project of projects) {
        const featuresDir = path.join(projectDir, project, 'features');
        const features = await safeReaddir(featuresDir);
        for (const feature of features) {
          out.push({
            // `feature` is the on-disk slug: keep it for the path, decode it
            // for the domain name used to look up job state in redis.
            featurePath: path.join(featuresDir, feature),
            projectId: project,
            featureName: featureSlugToName(feature),
            userContext: { organizationId: org, userId: user },
          });
        }
      }
    }
  }
  return out;
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}
