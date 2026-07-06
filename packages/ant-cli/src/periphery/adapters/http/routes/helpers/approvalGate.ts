import type { ApprovalStatus } from '@ant/shared';
import { isBillingEnabled } from '../../../../../core/config/billingCapability';
import { getInfrastructureFactory } from '../../../../../infrastructure/adapters/InfrastructureFactory';
import { logger } from '../../../../../utils/logger';

/**
 * Pre-flight approval gate for STARTING / RESUMING a job or chat turn. Returns
 * `{ status }` when the account is not `approved` (caller maps to a 403), else
 * null (allow). No-op (null) when billing is disabled or the cloud overlay is
 * absent (OSS/local → Noop repo returns `'approved'`). Non-fatal on read error
 * — an infra blip must not lock everyone out (Redis is the whole system's
 * dependency anyway; if it's down, jobs can't run regardless), mirroring the
 * credit pre-flight's fail-open posture.
 */
export async function checkApproval(
  userContext: { userId: string; organizationId: string },
): Promise<{ status: ApprovalStatus } | null> {
  if (!isBillingEnabled()) return null;
  try {
    const repo = getInfrastructureFactory().getOrganizationRepository();
    const status = await repo.getUserApproval(userContext.userId);
    if (status !== 'approved') return { status };
  } catch (err) {
    logger.warn('approval pre-flight check failed — allowing job', { component: 'JobRoute' }, err as any);
  }
  return null;
}

/** Map a non-approved status to a stable client error code. */
export function approvalErrorCode(status: ApprovalStatus): 'ACCOUNT_DENIED' | 'ACCOUNT_PENDING_APPROVAL' {
  return status === 'denied' ? 'ACCOUNT_DENIED' : 'ACCOUNT_PENDING_APPROVAL';
}
