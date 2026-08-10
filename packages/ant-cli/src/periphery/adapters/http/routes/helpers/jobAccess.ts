/**
 * Cross-tenant guard for `jobId`-addressed routes — SSOT.
 *
 * `jobId` is a low-entropy human id that leaks into logs, SSE payloads and
 * URLs, so in cloud mode a tracked job may only be read or controlled by its
 * owning `(org, user)`. This closes cross-tenant stop (availability) and
 * cross-tenant status/workflow reads (information disclosure).
 *
 * Local mode is single-tenant → no-op. Untracked jobs (no Redis record) are
 * allowed: they expose no other tenant's state, and the caller-scoped handlers
 * operate only within the caller's own namespace.
 */

import type { StateStorePort } from '../../../../../core/ports/stateStore';
import { logger } from '../../../../../utils/logger';
import { isLocalServerMode } from './userContext';

export interface JobAccessDenial {
  code: number;
  body: { error: string };
}

/**
 * @returns a denial to send, or `null` when the caller may proceed.
 */
export async function assertJobAccess(
  stateStore: Pick<StateStorePort, 'getJobStatus'>,
  jobId: string,
  userContext: { userId: string; organizationId: string },
): Promise<JobAccessDenial | null> {
  if (isLocalServerMode()) return null;

  const owner = (await stateStore.getJobStatus(jobId))?.userContext;
  if (
    owner &&
    (owner.userId !== userContext.userId || owner.organizationId !== userContext.organizationId)
  ) {
    logger.warn(
      `Cross-tenant job access denied: job=${jobId} owner=${owner.organizationId}/${owner.userId} caller=${userContext.organizationId}/${userContext.userId}`,
      { component: 'JobAccess' },
    );
    return { code: 403, body: { error: 'Forbidden' } };
  }
  return null;
}
