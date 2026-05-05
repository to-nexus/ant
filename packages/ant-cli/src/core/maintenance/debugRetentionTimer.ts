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
import type { StateStorePort } from '../ports/stateStore';
import { pruneDebugArtifacts } from '../utils/debugRetention';
import { logger } from '../../utils/logger';

const DEFAULT_TICK_MS = 60_000;

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
    try {
      const features = await listAllFeaturePaths(options.workspacesPath);
      for (const feat of features) {
        await pruneDebugArtifacts(feat.featurePath, {
          stateStore: options.stateStore,
          context: { projectId: feat.projectId, featureName: feat.featureName },
        });
      }
    } catch (err) {
      logger.warn(
        `[debugRetentionTimer] tick failed`,
        { component: 'debugRetentionTimer' },
        err,
      );
    } finally {
      running = false;
    }
  };

  const handle = setInterval(() => {
    void tick();
  }, tickMs);
  if (handle.unref) handle.unref();

  logger.info(
    `[debugRetentionTimer] started — base=${options.workspacesPath} tick=${tickMs}ms`,
    { component: 'debugRetentionTimer' },
  );

  return {
    stop: () => {
      clearInterval(handle);
      logger.info(`[debugRetentionTimer] stopped`, { component: 'debugRetentionTimer' });
    },
  };
}

interface FeatureRef {
  featurePath: string;
  projectId: string;
  featureName: string;
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
            featurePath: path.join(featuresDir, feature),
            projectId: project,
            featureName: feature,
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
