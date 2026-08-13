/**
 * Organizations API client — backs the OrganizationOnboardingScreen
 * autocomplete (`GET /api/organizations?q=...`) and the onboarding
 * submission (`POST /api/auth/onboarding/organization`).
 *
 * `API_BASE` aliases `/api`. The shape mirrors the BE contract — see
 * `packages/ant-cli/src/periphery/adapters/http/routes/organizations.routes.ts`
 * and `auth.routes.ts`'s onboarding handler.
 */

import { API_BASE, apiGet, apiPost } from './client';

export interface OrganizationSummary {
  id: string;
  name: string;
}

export interface OnboardingResponse {
  user: {
    userId: string;
    email: string;
    organization: string;
    name?: string;
    picture?: string;
  };
  needsOnboarding: boolean;
}

// ── Team lifecycle (Phase 1) ────────────────────────────────────────────────
// Wire contract: `@ant/shared/orgTeam.ts` ↔ BE `teams.routes.ts`.

import { apiPut, apiDelete } from './client';
import type {
  OrgSummaryView,
  OrgMemberView,
  OrgInviteView,
  OrgDomainClaimView,
  OrgMembershipRole,
  OrgInviteRole,
} from '@ant/shared';

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
 * Substring + case-insensitive org search. The BE clamps `limit` at
 * 100 and rejects empty queries with an empty array — we still pass a
 * sensible default of 20 so the dropdown stays compact.
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

/**
 * Submit the onboarding choice. `organizationName` may be empty / omitted
 * — the BE then auto-resolves (consumer email → `personal-${userId}`,
 * business email → domain). On success the BE re-mints the JWT cookie
 * with the real `org` claim; callers should re-fetch `/auth/me` after.
 */
export async function submitOnboardingOrganization(
  organizationName?: string,
): Promise<OnboardingResponse> {
  const body =
    organizationName && organizationName.trim()
      ? { organizationName: organizationName.trim() }
      : {};
  return apiPost<OnboardingResponse>(`${API_BASE()}/auth/onboarding/organization`, body);
}
