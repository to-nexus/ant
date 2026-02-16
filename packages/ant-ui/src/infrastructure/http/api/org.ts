import { API_BASE, authFetch, apiGet, apiPut } from './client';

export interface OrgConfig {
  github?: {
    /** Default GitHub owner (user or organization) for new projects */
    owner?: string;
  };
}

export interface UserConfig {
  github?: {
    /** User-level override for default GitHub owner. null = clear override. */
    ownerOverride?: string | null;
  };
}

export function fetchOrgConfig(): Promise<OrgConfig> {
  return apiGet<OrgConfig>(`${API_BASE()}/org/config`).catch(() => ({}));
}

export function updateOrgConfig(config: Partial<OrgConfig>): Promise<OrgConfig> {
  return apiPut(`${API_BASE()}/org/config`, config);
}

export function fetchUserConfig(): Promise<UserConfig> {
  return apiGet<UserConfig>(`${API_BASE()}/user/config`).catch(() => ({}));
}

export function updateUserConfig(config: Partial<UserConfig>): Promise<UserConfig> {
  return apiPut(`${API_BASE()}/user/config`, config);
}

/**
 * Reset user account: delete all workspaces, sessions, and user config.
 * Git repositories are preserved.
 */
export async function resetUserAccount(): Promise<{
  success: boolean;
  message?: string;
  error?: string;
}> {
  try {
    const response = await authFetch(`${API_BASE()}/user/reset`, { method: 'POST' });
    const result = await response.json();
    if (!response.ok) return { success: false, error: result.error || `HTTP ${response.status}` };
    return { success: true, message: result.message };
  } catch (error: any) {
    return { success: false, error: error.message || 'Network error' };
  }
}

export function fetchOrgMembers(): Promise<{
  members: Array<{ userId: string; isSelf: boolean }>;
}> {
  return apiGet(`${API_BASE()}/org/members`);
}

export function fetchMemberProjects(
  userId: string,
): Promise<{ projects: Array<{ projectId: string }> }> {
  return apiGet(`${API_BASE()}/org/members/${userId}/projects`);
}

export function fetchMemberFeatures(
  userId: string,
  projectId: string,
): Promise<{ features: Array<{ featureId: string }> }> {
  return apiGet(`${API_BASE()}/org/members/${userId}/projects/${projectId}/features`);
}

export function fetchMemberDirectories(
  userId: string,
  projectId: string,
  featureId: string,
): Promise<{ directories: string[] }> {
  return apiGet(
    `${API_BASE()}/org/members/${userId}/projects/${projectId}/features/${featureId}/directories`,
  );
}
