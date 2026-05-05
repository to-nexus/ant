/**
 * Cross-process preview cleanup signaling
 *
 * `PreviewService` lives in the separate `ant-preview` process — the API
 * server cannot call it in-process. We publish a request on a Redis pub/sub
 * channel and wait for an ack so project / feature deletion can block on
 * preview cleanup completing (which is required before `fs.rm` so EFS
 * silly-rename `.nfsXXXX` orphans don't survive deletion).
 *
 * Aligns with the Unified Distributed System Principle (no in-process call
 * masquerading as cross-process; Redis is the only inter-process control
 * plane).
 */

import { randomUUID } from 'crypto';
import type { StateStorePort } from '../../../../../core/ports/stateStore';
import type { UserContext } from '../../../../../core/types/user';
import { REDIS_KEYS } from '../../../../../core/constants/redis';
import { logger } from '../../../../../utils/logger';

export type CleanupScope = 'project' | 'feature';

export interface CleanupRequestPayload {
  requestId: string;
  scope: CleanupScope;
  organizationId: string;
  userId: string;
  projectId: string;
  featureName?: string;
}

export interface CleanupAckPayload {
  requestId: string;
  /** Identifies the worker that ack'd — currently 'preview', extensible to other infra owners. */
  source: 'preview';
  success: boolean;
  error?: string;
}

/**
 * Publish a cleanup request and resolve when the matching ack arrives.
 *
 * Timeout-resilient: if no ack returns in `timeoutMs` (e.g. ant-preview not
 * running in dev, or Redis briefly disconnected), the promise rejects so the
 * caller can fall back to a `warn` log and proceed. Preview-side cleanup is
 * idempotent so a missed ack doesn't leave bad state — it just means the
 * caller couldn't confirm.
 */
export async function requestPreviewCleanup(
  stateStore: StateStorePort,
  scope: CleanupScope,
  userContext: UserContext,
  projectId: string,
  featureName?: string,
  timeoutMs: number = 15_000,
): Promise<void> {
  const requestId = randomUUID();
  let settled = false;
  let resolveAck!: () => void;
  let rejectAck!: (err: Error) => void;

  const ackPromise = new Promise<void>((resolve, reject) => {
    resolveAck = resolve;
    rejectAck = reject;
  });

  // CRITICAL ordering: subscribe MUST be fully registered (await resolved)
  // BEFORE publish runs, otherwise the ack from a fast subscriber races us
  // and we miss the message — Redis pub/sub is fire-and-forget and the
  // publisher/subscriber use different connections, so command ordering is
  // not preserved across them.
  const unsub = await stateStore.subscribe(REDIS_KEYS.LIFECYCLE.CLEANUP_ACK, (raw: unknown) => {
    const msg = raw as Partial<CleanupAckPayload> | undefined;
    if (!msg || msg.requestId !== requestId) return;
    if (settled) return;
    settled = true;
    if (msg.success) {
      resolveAck();
    } else {
      rejectAck(new Error(`Preview cleanup failed: ${msg.error ?? '<no error message>'}`));
    }
  });

  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    rejectAck(new Error(`Preview cleanup ack timeout (${timeoutMs}ms): requestId=${requestId}`));
  }, timeoutMs);

  const requestPayload: CleanupRequestPayload = {
    requestId,
    scope,
    organizationId: userContext.organizationId,
    userId: userContext.userId,
    projectId,
    featureName,
  };

  logger.info(`[PreviewCleanup] Publishing cleanup request`, { component: 'PreviewCleanup' }, {
    requestId,
    scope,
    projectId,
    featureName,
  });

  try {
    await stateStore.publish(REDIS_KEYS.LIFECYCLE.CLEANUP_REQUEST, requestPayload);
    await ackPromise;
    logger.info(`[PreviewCleanup] Cleanup ack received`, { component: 'PreviewCleanup' }, { requestId });
  } finally {
    clearTimeout(timer);
    unsub();
  }
}
