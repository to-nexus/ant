import { API_BASE, apiGet, apiPost } from './client';
import type { FeatureBreadcrumbLine } from '@ant/shared';

/**
 * Fetch all breadcrumb lines from feature.jsonl (timeline view).
 */
export async function getFeatureBreadcrumbs(
  projectId: string,
  featureName: string,
): Promise<FeatureBreadcrumbLine[]> {
  const url = `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/breadcrumbs`;
  const data = await apiGet<{ breadcrumbs: FeatureBreadcrumbLine[] }>(url);
  return data.breadcrumbs ?? [];
}

export interface ResetFeatureContextResponse {
  success: boolean;
  reason: string;
  jobId: string;
  turnId: string;
}

/**
 * Hard Reset the feature context (§17 hard_reset).
 *
 * Collapses every prior line in `feature.jsonl` and `trace.jsonl` and appends
 * a `user_reset` boundary line to `feature.jsonl`. Original lines stay on
 * disk with `collapsed=true` for audit / recovery; the UI reads them as
 * empty after reset.
 */
export async function resetFeatureContext(
  projectId: string,
  featureName: string,
  reason?: string,
): Promise<ResetFeatureContextResponse> {
  const url = `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/context/reset`;
  return apiPost<ResetFeatureContextResponse>(url, reason ? { reason } : {});
}
