/**
 * Feature-scoped file path resolution shared by route-level handlers that
 * bypass FileOperationService (raw bytes / download streaming).
 *
 * Universal seam: when `featureName` is the universal pseudo-feature on a
 * universal-type project, paths resolve against the container's merged view
 * (`artifacts/**` + grafted `sessions/**`) via the `universalContainer` SSOT.
 * Canonical projects fall through to the normal feature path with the same
 * traversal guard the routes used before.
 */

import * as fsPromises from 'fs/promises';
import type { Dirent } from 'fs';
import * as pathMod from 'path';

import type { WorkspaceResolver } from '../../../../../core/config/WorkspacePathResolver';
import { assertWithinRoot } from '../../../../../core/config/pathContainment';
import type { UserContext } from '../../../../../core/types/user';
import {
  resolveUniversalContainerPath,
  resolveUniversalMergedPath,
} from '../../../../../core/customAgents/universalContainer';

/**
 * The universal container root for `(project, feature)`, or null when the pair
 * addresses a canonical feature plane. Single owner of the "which plane is
 * this" question: routes that anchor a write by NAME (`getFeaturePath`) must
 * refuse the universal answer rather than write into the phantom
 * `features/universal` tree.
 */
export function resolveUniversalPlaneRoot(
  workspaceResolver: WorkspaceResolver,
  userContext: UserContext,
  projectId: string,
  featureName: string,
): string | null {
  try {
    return resolveUniversalContainerPath(
      workspaceResolver.getProjectPath(userContext, projectId),
      featureName,
    );
  } catch {
    return null;
  }
}

export function resolveFeatureScopedFilePath(
  workspaceResolver: WorkspaceResolver,
  userContext: UserContext,
  projectId: string,
  featureName: string,
  relPath: string,
): string {
  const containerPath = resolveUniversalPlaneRoot(workspaceResolver, userContext, projectId, featureName);
  if (containerPath) {
    return resolveUniversalMergedPath(containerPath, relPath);
  }
  const featurePath = workspaceResolver.getFeaturePath(userContext, projectId, featureName);
  try {
    return assertWithinRoot(featurePath, relPath);
  } catch {
    throw new Error(`Invalid file path: ${relPath}`);
  }
}

/**
 * Bounded walk that answers "is this directory small enough to archive?" without
 * building a list of it.
 *
 * The ZIP stream itself is not the memory risk — `archiver` streams. The risk is
 * everything else it costs: filesystem reads, zlib CPU, a response socket held
 * open, all multiplied by however many an account starts at once (M-NEW-004). A
 * preflight is what turns that into an explicit refusal instead of a very long
 * stream, and it stops the moment either budget is exceeded so measuring a huge
 * tree is not itself the attack.
 *
 * `sessions/` is skipped to match the archive filter — a folder that is mostly
 * session logs must not be refused for bytes that would never be included.
 */
export async function measureArchiveInput(
  root: string,
  budget: { maxEntries: number; maxBytes: number },
): Promise<{ exceeded: boolean; entries: number; bytes: number }> {
  let entries = 0;
  let bytes = 0;

  const walk = async (dir: string, depth: number): Promise<boolean> => {
    // A symlink loop inside the tree would otherwise make this unbounded; the
    // archive itself does not follow directory links either.
    if (depth > 64) return true;

    let dirents: Dirent[];
    try {
      dirents = await fsPromises.readdir(dir, { withFileTypes: true });
    } catch {
      return false;
    }

    for (const entry of dirents) {
      if (entry.name === 'sessions' && depth === 0) continue;
      entries += 1;
      if (entries > budget.maxEntries) return true;

      const abs = pathMod.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (await walk(abs, depth + 1)) return true;
        continue;
      }
      try {
        bytes += (await fsPromises.stat(abs)).size;
      } catch {
        continue;
      }
      if (bytes > budget.maxBytes) return true;
    }
    return false;
  };

  const exceeded = await walk(root, 0);
  return { exceeded, entries, bytes };
}
