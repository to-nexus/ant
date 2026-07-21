import { API_BASE, apiGet, apiPost, featureSeg } from './client';
import type {
  ContextCarryoverEstimate,
  ContextLensResponse,
  FeatureBreadcrumbLine,
} from '@ant/shared';

/**
 * Fetch all breadcrumb lines from feature.jsonl (timeline view).
 */
export async function getFeatureBreadcrumbs(
  projectId: string,
  featureName: string,
): Promise<FeatureBreadcrumbLine[]> {
  const url = `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${featureSeg(featureName)}/breadcrumbs`;
  const data = await apiGet<{ breadcrumbs: FeatureBreadcrumbLine[] }>(url);
  return data.breadcrumbs ?? [];
}

/**
 * Context Lens (E2-4) — carry-over estimate: band sizes + rough token
 * estimate of the memory that will transfer to the NEXT job (cross-job),
 * as opposed to the per-call token ring.
 */
export async function getContextEstimate(
  projectId: string,
  featureName: string,
): Promise<ContextCarryoverEstimate> {
  const url = `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${featureSeg(featureName)}/context/estimate`;
  return apiGet<ContextCarryoverEstimate>(url);
}

/**
 * Context Lens (E2-4) — band bodies for the Context panel
 * (Recent Exchanges / Digests / Standing Constraints + rolling summary).
 */
export async function getContextLens(
  projectId: string,
  featureName: string,
): Promise<ContextLensResponse> {
  const url = `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${featureSeg(featureName)}/context/lens`;
  return apiGet<ContextLensResponse>(url);
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
 * Collapses every prior line in `feature.jsonl` and `chat.jsonl` and appends
 * a `user_reset` boundary line to `feature.jsonl`. Original lines stay on
 * disk with `collapsed=true` for audit / recovery; the UI reads them as
 * empty after reset.
 */
export async function resetFeatureContext(
  projectId: string,
  featureName: string,
  reason?: string,
): Promise<ResetFeatureContextResponse> {
  const url = `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${featureSeg(featureName)}/context/reset`;
  return apiPost<ResetFeatureContextResponse>(url, reason ? { reason } : {});
}
