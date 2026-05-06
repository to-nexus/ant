import { ServiceConnection } from '../../../../../../../core/ports/portRegistry';
import { toUrlKeyWithService } from '../../utils/serverKeyUtils';

/**
 * Resolve `ant-project` connections (both `self` and explicit cross-project)
 * by computing the target serverKey under the same `tenantId:userId` and
 * baking the proxy path into `value`. Mutates the input array in place.
 *
 * `self` semantics: `projectId === 'self'` and `feature === 'self'` are
 * substituted with the current project's identifiers parsed from
 * `serverKey` (`tenant:user:project:feature`).
 */
export function enrichInternalConnections(connections: ServiceConnection[], serverKey: string): void {
  const parts = serverKey.split(':');
  const tenantId = parts[0] || '';
  const userId = parts[1] || '';
  const currentProjectId = parts[2] || '';
  const currentFeature = parts[3] || '';

  for (const conn of connections) {
    if (conn.resolution.type !== 'ant-project') continue;

    const resolvedProjectId = conn.resolution.projectId === 'self' ? currentProjectId : conn.resolution.projectId;
    const resolvedFeature = conn.resolution.feature === 'self' ? currentFeature : conn.resolution.feature;

    if (!resolvedProjectId || !resolvedFeature) continue;

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
