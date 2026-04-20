import { API_BASE, apiGet } from './client';
import type { TraceLine, FeatureBreadcrumbLine, LogJobType } from '@ant/shared';

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
