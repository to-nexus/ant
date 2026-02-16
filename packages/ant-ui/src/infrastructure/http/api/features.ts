import type { Session } from '@/domain/models/session';
import { API_BASE, authFetch, apiGet, apiDelete } from './client';

export interface Feature {
  name: string;
  path: string;
  createdAt?: string;
}

export function fetchFeatures(projectId: string): Promise<Feature[]> {
  return apiGet(`${API_BASE()}/projects/${encodeURIComponent(projectId)}/features`);
}

/**
 * Create a feature. Has custom error handling for error codes.
 */
export async function createFeature(
  projectId: string,
  featureName: string,
  language?: string,
): Promise<void> {
  const response = await authFetch(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features`,
    {
      method: 'POST',
      body: JSON.stringify({ featureName, language }),
    },
  );

  if (!response.ok) {
    const errBody = await response.json().catch(() => null as any);
    const message =
      errBody?.error ||
      errBody?.message ||
      `Failed to create feature: ${response.statusText}`;
    const err: any = new Error(message);
    if (errBody?.code) err.code = errBody.code;
    throw err;
  }
}

export function deleteFeature(projectId: string, featureName: string): Promise<void> {
  return apiDelete(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}`,
  );
}

export async function fetchFeatureSession(
  projectId: string,
  featureName: string,
  job: string = 'code',
): Promise<Session | null> {
  const url = `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/session?job=${job}`;
  const response = await authFetch(url);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Failed to fetch feature session: ${response.statusText}`);
  return response.json();
}
