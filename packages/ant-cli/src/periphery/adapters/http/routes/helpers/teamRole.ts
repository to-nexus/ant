/**
 * Team-role helpers (SSOT) — extracted from `teams.routes.ts` so agent/org
 * routes can enforce live-membership authority without duplicating the role
 * ladder. Authorization always reads the LIVE membership row, never the JWT
 * `org` claim (stale-JWT safety).
 */

import type { OrgMembershipRole } from '@ant/shared';
import type { OrganizationRepositoryPort } from '../../../../../core/ports/organizationRepository';
import type { Organization, Membership } from '../../../../../core/auth/types';

export const ROLE_RANK: Record<OrgMembershipRole, number> = { member: 0, admin: 1, owner: 2 };

export function hasMinRole(role: OrgMembershipRole, min: OrgMembershipRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/**
 * Resolve org + LIVE membership for a TEAM org. Soft-deleted org, non-team
 * kind, or non-member all collapse to null — callers decide the HTTP shape.
 */
export async function resolveLiveTeamMembership(
  repo: OrganizationRepositoryPort,
  userId: string,
  orgId: string,
): Promise<{ org: Organization; membership: Membership } | null> {
  const org = orgId ? await repo.getOrganization(orgId) : null;
  if (!org || org.deletedAt || (org.kind ?? 'team') !== 'team') return null;
  const membership = await repo.getMembership(userId, org.id);
  if (!membership) return null;
  return { org, membership };
}
