import type { OrganizationKind } from '@ant/shared';
import type { AccountVerdict } from '../../../../../core/ports/organizationRepository';
import { deriveKindFromOrgId } from '@ant/shared';
import { getInfrastructureFactory } from '../../../../../infrastructure/adapters/InfrastructureFactory';
import { logger } from '../../../../../utils/logger';

/**
 * The single read of the approval verdict: consult the organization-repository
 * port, fail open on infra error. Returns `{ status }` when the account is not
 * `approved` (caller maps that to a 403 / a failure reason), else null (allow).
 *
 * `status: 'unknown'` is the one verdict that is NOT a judgement about the
 * person — the JWT is valid but no record backs it (a deleted account, or state
 * loss). Callers answer 401 so the holder re-authenticates; see the port's
 * `getUserApproval`.
 *
 * Three callers, one per plane that can admit an identity:
 *  - `createRequireApprovedAccount` — the whole HTTP surface, on every server
 *    that authenticates a cookie or bearer;
 *  - `BridgeWebSocketHandler.handleUpgrade` — the WS upgrade bypasses Express;
 *  - `PipelineRunCoordinator` — a cron tick is not a request at all.
 *
 * No route handler is a caller. Re-asking inside one would make a second owner
 * of a verdict the surface guard has already answered.
 *
 * Approval is an IDENTITY concern, not billing — this always consults the
 * organization repository port: local mode's Noop repo answers `'approved'`
 * (single code path, no capability short-circuit), and every cloud-mode
 * deployment (self-hosted or managed) gets the real Redis-backed judgment.
 * Non-fatal on read error — an infra blip must not lock everyone out (Redis is
 * the whole system's dependency anyway; if it's down, jobs can't run
 * regardless), mirroring the credit pre-flight's fail-open posture.
 */
export async function checkApproval(
  userContext: { userId: string; organizationId: string },
): Promise<{ status: AccountVerdict } | null> {
  try {
    const repo = getInfrastructureFactory().getOrganizationRepository();
    const status = await repo.getUserApproval(userContext.userId);
    if (status !== 'approved') return { status };
  } catch (err) {
    logger.warn('approval pre-flight check failed — allowing job', { component: 'JobRoute' }, err as any);
  }
  return null;
}

/**
 * Map a non-approved verdict to a stable client error code. `unknown` is a
 * stale session, so it pairs with 401 rather than the 403 the other two carry.
 */
export function approvalErrorCode(
  status: AccountVerdict,
): 'ACCOUNT_DENIED' | 'ACCOUNT_PENDING_APPROVAL' | 'SESSION_IDENTITY_GONE' {
  if (status === 'unknown') return 'SESSION_IDENTITY_GONE';
  return status === 'denied' ? 'ACCOUNT_DENIED' : 'ACCOUNT_PENDING_APPROVAL';
}

/** HTTP status for a verdict: a vanished identity is 401, a judgement is 403. */
export function approvalHttpStatus(status: AccountVerdict): 401 | 403 {
  return status === 'unknown' ? 401 : 403;
}

/**
 * Stale-JWT blockade for team orgs (Phase 1). A JWT can carry a team `org`
 * claim for up to 7 days after the member was removed, so compute start
 * points (job / chat) re-check the LIVE membership row. `true` = allow.
 * Kind-dispatch: only `team` kinds have membership semantics — individual
 * and local pass unconditionally. Soft-deleted orgs refuse too. Fail-open on
 * infra error, mirroring `checkApproval` (if Redis is down nothing runs
 * anyway); fail-CLOSED on a missing row (that IS the stale-JWT case).
 */
export async function checkTeamMembership(userContext: {
  userId: string;
  organizationId: string;
  organizationKind?: OrganizationKind;
}): Promise<boolean> {
  const kind = userContext.organizationKind ?? deriveKindFromOrgId(userContext.organizationId);
  if (kind !== 'team') return true;
  try {
    const repo = getInfrastructureFactory().getOrganizationRepository();
    const membership = await repo.getMembership(userContext.userId, userContext.organizationId);
    if (!membership) return false;
    const org = await repo.getOrganization(userContext.organizationId);
    if (!org || org.deletedAt) return false;
    return true;
  } catch (err) {
    logger.warn('team membership pre-flight failed — allowing', { component: 'JobRoute' }, err as any);
    return true;
  }
}
