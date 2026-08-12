import type { Domain } from '@ant/shared';
import type { Session } from '@/domain/models/session';
import { API_BASE, authFetch, apiGet, apiPost, apiPut, apiDelete } from './client';

export function fetchProjects(): Promise<string[]> {
  return apiGet(`${API_BASE()}/projects`);
}

export interface ReferenceCatalogEntry {
  project: string;
  branches: string[];
}

/**
 * Reference-codebase catalog for the current tenant: sibling projects (and their
 * selectable git refs) that can be attached to an action as cross-project code
 * references. `exclude` drops the current project from the list.
 */
export function fetchReferenceCatalog(exclude?: string): Promise<ReferenceCatalogEntry[]> {
  const qs = exclude ? `?exclude=${encodeURIComponent(exclude)}` : '';
  return apiGet(`${API_BASE()}/projects/reference-catalog${qs}`);
}

/**
 * Create a project. Pass `opts.force = true` to overwrite a stale existing
 * directory (server-side cascade deletes first). The 409 path returns an
 * `ApiError` with `canForceCleanup: true` so the wizard can prompt the user.
 *
 * `opts.domain` is the workspace domain, sent in the SAME request rather than a
 * follow-up config PUT: domain is the SSOT every job's triage reads, so a project
 * must never exist without one. Omitting it defaults to `'service'` server-side.
 */
export function createProject(
  projectId: string,
  opts?: { force?: boolean; domain?: Domain },
): Promise<void> {
  const url = `${API_BASE()}/projects${opts?.force ? '?force=true' : ''}`;
  return apiPost(url, { id: projectId, ...(opts?.domain ? { domain: opts.domain } : {}) });
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
