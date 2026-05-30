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
  options?: { skipPrdTemplate?: boolean },
): Promise<void> {
  const response = await authFetch(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features`,
    {
      method: 'POST',
      body: JSON.stringify({ featureName, language, skipPrdTemplate: options?.skipPrdTemplate }),
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

/**
 * Delete a feature. Pass `opts.force = true` to opt out of strict
 * cascade gating — steps 1-4 (cancel jobs / IDE cleanup / preview ack /
 * Redis cleanup) tolerate failures with warn logs instead of throwing,
 * and the fs verification poll window extends from 10s to 20s. The
 * route returns 409 (with `canForceCleanup: true`) on the strict path
 * and 500 if force was already attempted.
 */
export function deleteFeature(
  projectId: string,
  featureName: string,
  opts: { force?: boolean } = {},
): Promise<void> {
  const qs = opts.force ? '?force=true' : '';
  return apiDelete(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}${qs}`,
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
