import type { Session } from '@/domain/models/session';
import { API_BASE, authFetch, apiGet, apiPost, apiDelete } from './client';

export function fetchProjects(): Promise<string[]> {
  return apiGet(`${API_BASE()}/projects`);
}

export function createProject(projectId: string): Promise<void> {
  return apiPost(`${API_BASE()}/projects`, { id: projectId });
}

export function deleteProject(projectId: string): Promise<void> {
  return apiDelete(`${API_BASE()}/projects/${encodeURIComponent(projectId)}`);
}

export async function fetchSession(projectId: string): Promise<Session | null> {
  const response = await authFetch(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/session`,
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Failed to fetch session: ${response.statusText}`);
  return response.json();
}
