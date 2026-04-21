import { API_BASE, apiGet, apiPost } from './client';
import type {
  TraceLine,
  FeatureBreadcrumbLine,
  FeatureUserTurnLine,
  FeatureUserTurnMetaLine,
  LogJobType,
} from '@ant/shared';

/**
 * Fetch all trace.jsonl lines for a feature (initial load SSOT for chat / activity feed).
 * Live updates continue via the SSE workflow/chat streams.
 */
export async function getFeatureTrace(
  projectId: string,
  featureName: string,
  opts: { sinceTs?: string; jobTypes?: LogJobType[] } = {},
): Promise<TraceLine[]> {
  const params = new URLSearchParams();
  if (opts.sinceTs) params.set('sinceTs', opts.sinceTs);
  if (opts.jobTypes && opts.jobTypes.length > 0) params.set('jobTypes', opts.jobTypes.join(','));
  const qs = params.toString();
  const url = `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/trace${qs ? `?${qs}` : ''}`;
  const data = await apiGet<{ lines: TraceLine[] }>(url);
  return data.lines ?? [];
}

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

/**
 * Fetch user_turn + user_turn_meta lines from feature.jsonl (tier badge — §18).
 * Collapsed lines are excluded. The UI merges the two arrays by turnId to
 * render `mode · executionTier · reason` badges on each turn.
 */
export async function getFeatureTurnMeta(
  projectId: string,
  featureName: string,
): Promise<{ userTurns: FeatureUserTurnLine[]; userTurnMetas: FeatureUserTurnMetaLine[] }> {
  const url = `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/user-turn-meta`;
  const data = await apiGet<{ userTurns: FeatureUserTurnLine[]; userTurnMetas: FeatureUserTurnMetaLine[] }>(url);
  return {
    userTurns: data.userTurns ?? [],
    userTurnMetas: data.userTurnMetas ?? [],
  };
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
