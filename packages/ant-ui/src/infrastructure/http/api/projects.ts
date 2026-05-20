import type { Session } from '@/domain/models/session';
import { API_BASE, authFetch, apiGet, apiPost, apiPut, apiDelete } from './client';

export function fetchProjects(): Promise<string[]> {
  return apiGet(`${API_BASE()}/projects`);
}

/**
 * Create a project. Pass `opts.force = true` to overwrite a stale existing
 * directory (server-side cascade deletes first). The 409 path returns an
 * `ApiError` with `canForceCleanup: true` so the wizard can prompt the user.
 */
export function createProject(
  projectId: string,
  opts?: { force?: boolean },
): Promise<void> {
  const url = `${API_BASE()}/projects${opts?.force ? '?force=true' : ''}`;
  return apiPost(url, { id: projectId });
}

export function renameProject(oldId: string, newId: string): Promise<{ success: boolean; oldId: string; newId: string }> {
  return apiPut(`${API_BASE()}/projects/${encodeURIComponent(oldId)}/rename`, { newId });
}

/**
 * Delete a project. Pass `opts.force = true` to opt out of strict
 * cascade gating — steps 1-4 (cancel jobs / IDE cleanup / preview ack /
 * Redis cleanup) tolerate failures with warn logs instead of throwing,
 * and the fs verification poll window extends from 10s to 20s. The
 * route returns 409 (with `canForceCleanup: true`) on the strict path
 * and 500 if force was already attempted.
 */
export function deleteProject(projectId: string, opts: { force?: boolean } = {}): Promise<void> {
  const qs = opts.force ? '?force=true' : '';
  return apiDelete(`${API_BASE()}/projects/${encodeURIComponent(projectId)}${qs}`);
}

export async function fetchSession(projectId: string): Promise<Session | null> {
  const response = await authFetch(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/session`,
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Failed to fetch session: ${response.statusText}`);
  return response.json();
}
