/**
 * Artifact root seam — the one place that maps `(projectId, featureId)` to the
 * directory a root-relative artifact path (`plan/x.md`) lives under, across
 * BOTH project kinds:
 *
 *   canonical  `{project}/features/{slug}`            (featureId = real feature)
 *   universal  `{project}/universal/artifacts`        (featureId = 'universal')
 *
 * A universal project has no `features/` plane, so resolving its pseudo-feature
 * through `getFeaturePath` would mint a phantom `features/universal` directory.
 * Transfer (service + routes) and the recipient destination picker resolve here
 * and never call `getFeaturePath` directly.
 *
 * Lives outside `universalContainer.ts` because `core/utils/sessionPaths.ts`
 * imports that module and this one needs both.
 */

import * as path from 'path';
import { UNIVERSAL_FEATURE, UNIVERSAL_RESERVED_ROOT_DIRNAMES, isCanonicalDir } from '@ant/shared';
import type { WorkspaceResolver } from '../config/WorkspacePathResolver';
import { assertWithinRoot } from '../config/pathContainment';
import type { UserContext } from '../types/user';
import {
  UNIVERSAL_ARTIFACTS_DIRNAME,
  UNIVERSAL_ARTIFACT_CANONICAL_DIRS,
  getUniversalContainerPathOf,
  isUniversalProject,
} from './universalContainer';

export type ArtifactRootKind = 'canonical' | 'universal';

export interface ArtifactRoot {
  kind: ArtifactRootKind;
  /** Directory that root-relative artifact paths resolve under. */
  root: string;
  projectPath: string;
}

export type ArtifactRootResolver = Pick<WorkspaceResolver, 'getProjectPath' | 'getFeaturePath'>;

/** Sessions is the only reserved root on the canonical plane. */
const CANONICAL_RESERVED_ROOT = 'sessions';

/**
 * `null` when the pair cannot name an artifact root: an unresolvable project
 * id, or a universal project addressed with anything but `'universal'`.
 * Existence on disk is NOT checked — callers decide between 404 and lazy
 * materialization (`ensureUniversalContainer`).
 */
export function resolveArtifactRoot(
  resolver: ArtifactRootResolver,
  ctx: UserContext,
  projectId: string,
  featureId: string,
): ArtifactRoot | null {
  let projectPath: string;
  try {
    projectPath = resolver.getProjectPath(ctx, projectId);
  } catch {
    return null;
  }
  if (isUniversalProject(projectPath)) {
    if (featureId !== UNIVERSAL_FEATURE) return null;
    return {
      kind: 'universal',
      root: path.join(getUniversalContainerPathOf(projectPath), UNIVERSAL_ARTIFACTS_DIRNAME),
      projectPath,
    };
  }
  try {
    return { kind: 'canonical', root: resolver.getFeaturePath(ctx, projectId, featureId), projectPath };
  } catch {
    return null;
  }
}

/**
 * First segment of the posix-NORMALIZED path — `artifacts/../sessions` has a
 * first segment of `artifacts` but lands in `sessions`, so the verdict is taken
 * on the shape the write lands on.
 */
function normalizedFirstSegment(rel: string): string {
  const cleaned = (rel ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (cleaned === '') return '';
  return path.posix.normalize(cleaned).split('/')[0] ?? '';
}

/** The reserved top-level name `rel` targets on this plane, or null. */
export function reservedRootOf(kind: ArtifactRootKind, rel: string): string | null {
  const first = normalizedFirstSegment(rel);
  if (first === '') return null;
  if (kind === 'canonical') return first === CANONICAL_RESERVED_ROOT ? first : null;
  return UNIVERSAL_RESERVED_ROOT_DIRNAMES.includes(first) ? first : null;
}

/** Roots that may be copied but never moved (deleting them would break the plane). */
export function isMoveProtectedRoot(kind: ArtifactRootKind, rel: string): boolean {
  const normalized = (rel ?? '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/$/, '');
  if (kind === 'canonical') return isCanonicalDir(normalized);
  return (UNIVERSAL_ARTIFACT_CANONICAL_DIRS as readonly string[]).includes(normalized);
}

/** Absolute path of `rel` under the root. @throws when `rel` escapes it. */
export function resolveArtifactPath(root: ArtifactRoot, rel: string): string {
  return assertWithinRoot(root.root, rel);
}
