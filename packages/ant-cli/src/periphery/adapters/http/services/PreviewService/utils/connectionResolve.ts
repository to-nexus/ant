import type { ServiceConnection } from '../../../../../../core/ports/portRegistry';
import { packageSlug, toUrlKeyWithService } from './serverKeyUtils';

export interface SaveResolutionContext {
  /** The project receiving the save — substituted for a `self` projectId. */
  projectId: string;
  /** The feature receiving the save — substituted for a `self` feature. */
  feature: string;
  organizationId: string;
  userId: string;
}

/**
 * Resolve an `ant-project` connection to its proxy urlKey + value before
 * persisting (the write-side of panel Save). Non-ant-project connections pass
 * through unchanged.
 *
 * `serviceName` is optional: a service-less connection (e.g. the `self` chip,
 * which sets `projectId/feature='self'` with no service) resolves to the
 * whole-backend proxy path. Slugging only happens when a service is named —
 * `packageSlug` would throw on `undefined` (the `reading 'replace' of undefined`
 * 500 this guards against), and `toUrlKeyWithService` already omits the 5th
 * segment when the slug is absent.
 */
export function resolveConnectionForSave(
  conn: ServiceConnection,
  ctx: SaveResolutionContext,
): ServiceConnection {
  if (
    conn.resolution?.type === 'ant-project' &&
    conn.resolution.projectId &&
    conn.resolution.feature
  ) {
    const resolvedProjectId =
      conn.resolution.projectId === 'self' ? ctx.projectId : conn.resolution.projectId;
    const resolvedFeature =
      conn.resolution.feature === 'self' ? ctx.feature : conn.resolution.feature;
    const backendServerKey = `${ctx.organizationId}:${ctx.userId}:${resolvedProjectId}:${resolvedFeature}`;
    // Normalize the user-supplied serviceName through the SAME slug helper used
    // when producing `PreviewPackage.slug`, so `apps/web`, `apps-web`, `web` all
    // resolve to the same 5th segment and the proxy can match by exact equality.
    const slug = conn.resolution.serviceName
      ? packageSlug(conn.resolution.serviceName)
      : undefined;
    const resolvedUrlKey = toUrlKeyWithService(backendServerKey, slug);
    return {
      ...conn,
      resolution: {
        ...conn.resolution,
        serviceName: slug,
        resolvedUrlKey,
      },
      value: `/${resolvedUrlKey}`,
    };
  }
  return conn;
}
