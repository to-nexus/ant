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

import type { WorkspaceResolver } from '../../../../../core/config/WorkspacePathResolver';
import { assertWithinRoot } from '../../../../../core/config/pathContainment';
import type { UserContext } from '../../../../../core/types/user';
import {
  resolveUniversalContainerPath,
  resolveUniversalMergedPath,
} from '../../../../../core/customAgents/universalContainer';

export function resolveFeatureScopedFilePath(
  workspaceResolver: WorkspaceResolver,
  userContext: UserContext,
  projectId: string,
  featureName: string,
  relPath: string,
): string {
  const projectPath = workspaceResolver.getProjectPath(userContext, projectId);
  const containerPath = resolveUniversalContainerPath(projectPath, featureName);
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
