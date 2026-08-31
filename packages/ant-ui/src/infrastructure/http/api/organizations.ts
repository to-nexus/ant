/**
 * Organizations API client — team lifecycle, join discovery, and join
 * requests. Wire contract: `@ant/shared/orgTeam.ts` ↔ BE `teams.routes.ts`
 * and `organizations.routes.ts`.
 *
 * `API_BASE` aliases `/api`.
 */

import { API_BASE, apiGet, apiPost, apiPut, apiDelete } from './client';
import type {
  OrgSummaryView,
  OrgMemberView,
  OrgInviteView,
  OrgDomainClaimView,
  OrgMembershipRole,
  OrgInviteRole,
  OrgJoinRequestView,
  OrgRemovedMemberView,
} from '@ant/shared';

export interface OrganizationSummary {
  id: string;
  name: string;
}

export interface AcceptInviteResponse {
  alreadyMember: boolean;
  organization: OrgSummaryView;
  role?: OrgInviteRole;
}

export async function createTeam(name: string): Promise<{ organization: OrgSummaryView }> {
  return apiPost(`${API_BASE()}/organizations`, { name });
}

export async function fetchOrg(orgId: string): Promise<{ organization: OrgSummaryView; role: OrgMembershipRole }> {
  return apiGet(`${API_BASE()}/organizations/${encodeURIComponent(orgId)}`);
}

export async function renameOrg(orgId: string, name: string): Promise<{ organization: OrgSummaryView }> {
  return apiPut(`${API_BASE()}/organizations/${encodeURIComponent(orgId)}/name`, { name });
}

export async function deleteOrg(orgId: string): Promise<void> {
  await apiDelete(`${API_BASE()}/organizations/${encodeURIComponent(orgId)}`);
}

export async function fetchOrgMembers(orgId: string): Promise<{ members: OrgMemberView[] }> {
  return apiGet(`${API_BASE()}/organizations/${encodeURIComponent(orgId)}/members`);
}

export async function removeOrgMember(orgId: string, userId: string): Promise<void> {
  await apiDelete(
    `${API_BASE()}/organizations/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}`,
  );
}

export async function setOrgMemberRole(
  orgId: string,
  userId: string,
  role: Exclude<OrgMembershipRole, 'owner'>,
): Promise<void> {
  await apiPut(
    `${API_BASE()}/organizations/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}/role`,
    { role },
  );
}

export async function transferOrgOwnership(orgId: string, toUserId: string): Promise<void> {
  await apiPost(`${API_BASE()}/organizations/${encodeURIComponent(orgId)}/transfer-ownership`, {
    toUserId,
  });
}

export async function leaveOrg(orgId: string): Promise<void> {
  await apiPost(`${API_BASE()}/organizations/${encodeURIComponent(orgId)}/leave`, {});
}

export async function fetchOrgInvites(orgId: string): Promise<{ invites: OrgInviteView[] }> {
  return apiGet(`${API_BASE()}/organizations/${encodeURIComponent(orgId)}/invites`);
}

export async function createOrgInvite(
  orgId: string,
  email: string,
  role: OrgInviteRole,
): Promise<{ invite: OrgInviteView }> {
  return apiPost(`${API_BASE()}/organizations/${encodeURIComponent(orgId)}/invites`, { email, role });
}

export async function revokeOrgInvite(orgId: string, inviteId: string): Promise<{ invite: OrgInviteView }> {
  return apiPost(
    `${API_BASE()}/organizations/${encodeURIComponent(orgId)}/invites/${encodeURIComponent(inviteId)}/revoke`,
    {},
  );
}

export async function acceptOrgInvite(token: string): Promise<AcceptInviteResponse> {
  return apiPost(`${API_BASE()}/organizations/invites/accept`, { token });
}

export async function fetchOrgDomains(orgId: string): Promise<{ domains: OrgDomainClaimView[] }> {
  return apiGet(`${API_BASE()}/organizations/${encodeURIComponent(orgId)}/domains`);
}

export async function claimOrgDomain(orgId: string, domain: string): Promise<{ domain: OrgDomainClaimView }> {
  return apiPost(`${API_BASE()}/organizations/${encodeURIComponent(orgId)}/domains`, { domain });
}

export async function verifyOrgDomain(
  orgId: string,
  domain: string,
): Promise<{ verified: boolean; domain: OrgDomainClaimView }> {
  return apiPost(
    `${API_BASE()}/organizations/${encodeURIComponent(orgId)}/domains/${encodeURIComponent(domain)}/verify`,
    {},
  );
}

export async function deleteOrgDomain(orgId: string, domain: string): Promise<void> {
  await apiDelete(
    `${API_BASE()}/organizations/${encodeURIComponent(orgId)}/domains/${encodeURIComponent(domain)}`,
  );
}

export async function joinByDomain(organizationId: string): Promise<AcceptInviteResponse> {
  return apiPost(`${API_BASE()}/organizations/join-by-domain`, { organizationId });
}

/**
 * Substring + case-insensitive org search over DISCOVERABLE orgs only. The
 * BE clamps `limit` at 25 and returns [] below 2 characters.
 */
export async function searchOrganizations(
  query: string,
  limit = 20,
): Promise<OrganizationSummary[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const url = `${API_BASE()}/organizations?q=${encodeURIComponent(trimmed)}&limit=${limit}`;
  const res = await apiGet<{ organizations: OrganizationSummary[] }>(url);
  return res.organizations ?? [];
}

export async function setOrgDiscoverable(
  orgId: string,
  discoverable: boolean,
): Promise<{ organization: OrgSummaryView }> {
  return apiPut(`${API_BASE()}/organizations/${encodeURIComponent(orgId)}/discoverable`, {
    discoverable,
  });
}

export async function updateOrgDomain(
  orgId: string,
  domain: string,
  patch: { autoJoin?: boolean; autoJoinRole?: OrgInviteRole },
): Promise<{ domain: OrgDomainClaimView }> {
  return apiPut(
    `${API_BASE()}/organizations/${encodeURIComponent(orgId)}/domains/${encodeURIComponent(domain)}`,
    patch,
  );
}

// ── Join requests ───────────────────────────────────────────────────────────

export async function createJoinRequest(
  orgId: string,
  message?: string,
): Promise<{ joinRequest: OrgJoinRequestView }> {
  return apiPost(`${API_BASE()}/organizations/${encodeURIComponent(orgId)}/join-requests`, {
    ...(message ? { message } : {}),
  });
}

export async function fetchJoinRequests(
  orgId: string,
): Promise<{ joinRequests: OrgJoinRequestView[] }> {
  return apiGet(`${API_BASE()}/organizations/${encodeURIComponent(orgId)}/join-requests`);
}

export async function approveJoinRequest(
  orgId: string,
  requestId: string,
  role?: OrgInviteRole,
): Promise<{ joinRequest: OrgJoinRequestView | null; role: OrgInviteRole }> {
  return apiPost(
    `${API_BASE()}/organizations/${encodeURIComponent(orgId)}/join-requests/${encodeURIComponent(requestId)}/approve`,
    { ...(role ? { role } : {}) },
  );
}

export async function rejectJoinRequest(
  orgId: string,
  requestId: string,
): Promise<{ joinRequest: OrgJoinRequestView | null }> {
  return apiPost(
    `${API_BASE()}/organizations/${encodeURIComponent(orgId)}/join-requests/${encodeURIComponent(requestId)}/reject`,
    {},
  );
}

export async function cancelJoinRequest(
  requestId: string,
): Promise<{ joinRequest: OrgJoinRequestView | null }> {
  return apiPost(
    `${API_BASE()}/organizations/join-requests/${encodeURIComponent(requestId)}/cancel`,
    {},
  );
}

// ── Removal rows (domain-shortcut blocklist) ────────────────────────────────

export async function fetchRemovedMembers(
  orgId: string,
): Promise<{ removedMembers: OrgRemovedMemberView[] }> {
  return apiGet(`${API_BASE()}/organizations/${encodeURIComponent(orgId)}/removed-members`);
}

export async function clearRemovedMember(orgId: string, userId: string): Promise<void> {
  await apiDelete(
    `${API_BASE()}/organizations/${encodeURIComponent(orgId)}/removed-members/${encodeURIComponent(userId)}`,
  );
}
