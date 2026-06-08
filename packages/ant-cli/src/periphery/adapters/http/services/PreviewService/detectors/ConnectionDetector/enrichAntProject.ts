import { ServiceConnection } from '../../../../../../../core/ports/portRegistry';
import { ProjectStructure } from '../../types';
import { toUrlKeyWithService } from '../../utils/serverKeyUtils';
import { logger } from '../../../../../../../utils/logger';

/**
 * Resolve `ant-project` connections (both `self` and explicit cross-project)
 * by computing the target serverKey under the same `tenantId:userId` and
 * baking the proxy path into `value`. Mutates the input array in place.
 *
 * `self` semantics: `projectId === 'self'` and `feature === 'self'` are
 * substituted with the current project's identifiers parsed from
 * `serverKey` (`tenant:user:project:feature`).
 *
 * Self-reference validation: a connection that resolves to THIS project
 * (`self`, or `ant-project:<currentProject>:<currentFeature>`) only has a
 * live target if a backend package actually exists in the workspace. When
 * there is none (a frontend-only workspace whose backend is virtualized via
 * Service Virtualization), honoring the `ant-project` resolution would bake
 * an internal proxy path that points at nothing — a dead route in the
 * preview connection view. In that case the connection is downgraded to a
 * plain `url` (its annotated default value), which is the correct
 * classification for a virtualized/external backend. Genuine cross-project
 * references (a DIFFERENT project) are left untouched — their target lives
 * outside this workspace's structure.
 */
export function enrichInternalConnections(
  connections: ServiceConnection[],
  serverKey: string,
  structure?: ProjectStructure,
): void {
  const parts = serverKey.split(':');
  const tenantId = parts[0] || '';
  const userId = parts[1] || '';
  const currentProjectId = parts[2] || '';
  const currentFeature = parts[3] || '';

  // Only a POPULATED package list lets us assert "no backend exists". An
  // empty list means structure detection has not populated packages — that is
  // "unknown", not "no backend", so we must not downgrade on it.
  const packages = structure?.packages ?? [];
  const packageListIsKnown = packages.length > 0;
  const hasBackendPackage = packages.some(p => p.type === 'backend');

  for (const conn of connections) {
    if (conn.resolution.type !== 'ant-project') continue;

    const resolvedProjectId = conn.resolution.projectId === 'self' ? currentProjectId : conn.resolution.projectId;
    const resolvedFeature = conn.resolution.feature === 'self' ? currentFeature : conn.resolution.feature;

    if (!resolvedProjectId || !resolvedFeature) continue;

    // Self-reference to the current project with a KNOWN package list that has
    // no backend: the proxy target does not exist. Downgrade to `url` instead
    // of baking a dead `ant://` route. Only fires when the package list is
    // populated (callers that omit `structure`, or pass an empty list, keep
    // the legacy honor-the-annotation behavior — "unknown", not "no backend").
    const isSelfReference = resolvedProjectId === currentProjectId && resolvedFeature === currentFeature;
    if (packageListIsKnown && isSelfReference && !hasBackendPackage) {
      logger.warn(
        `[ConnectionDetector] '@connection ${conn.id}' uses self/ant-project resolution but no backend package exists in this workspace — downgrading to url (backend is virtualized or absent).`,
        { component: 'ConnectionDetector' },
      );
      conn.resolution = { type: 'url', url: conn.value || '' };
      continue;
    }

    const serviceName = conn.resolution.serviceName;
    const targetServerKey = `${tenantId}:${userId}:${resolvedProjectId}:${resolvedFeature}`;
    const resolvedUrlKey = toUrlKeyWithService(targetServerKey, serviceName);
    conn.resolution = {
      type: 'ant-project',
      projectId: resolvedProjectId,
      feature: resolvedFeature,
      serviceName,
      resolvedUrlKey,
    };
    conn.value = `/${resolvedUrlKey}`;
  }
}
