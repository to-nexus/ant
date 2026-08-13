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
