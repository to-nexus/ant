import type { ApprovalStatus } from '@ant/shared';
import { getInfrastructureFactory } from '../../../../../infrastructure/adapters/InfrastructureFactory';
import { logger } from '../../../../../utils/logger';

/**
 * Pre-flight approval gate for STARTING / RESUMING a job or chat turn. Returns
 * `{ status }` when the account is not `approved` (caller maps to a 403), else
 * null (allow). Approval is an IDENTITY concern, not billing — it always
 * consults the organization repository port: local mode's Noop repo answers
 * `'approved'` (single code path, no capability short-circuit), and every
 * cloud-mode deployment (self-hosted or managed) gets the real Redis-backed
 * judgment. Non-fatal on read error — an infra blip must not lock everyone
 * out (Redis is the whole system's dependency anyway; if it's down, jobs
 * can't run regardless), mirroring the credit pre-flight's fail-open posture.
 */
export async function checkApproval(
  userContext: { userId: string; organizationId: string },
): Promise<{ status: ApprovalStatus } | null> {
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
