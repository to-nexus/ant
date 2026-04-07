import { PREVIEW_BASE, apiGet, apiPost } from './client';
import type { DeployStatus } from '@ant/shared';
export type { DeployStatus, DeployLogEntry, DeployPhase, DeployFramework } from '@ant/shared';

export function startDeploy(
  projectId: string,
  feature?: string,
): Promise<{ success: boolean; url?: string; message: string }> {
  return apiPost(
    `${PREVIEW_BASE()}/projects/${encodeURIComponent(projectId)}/deploy`,
    { feature: feature || 'main' },
  );
}

export function stopDeploy(
  projectId: string,
  feature?: string,
): Promise<{ success: boolean; message: string }> {
  return apiPost(
    `${PREVIEW_BASE()}/projects/${encodeURIComponent(projectId)}/deploy/stop`,
    { feature: feature || 'main' },
  );
}

export function getDeployStatus(
  projectId: string,
  feature?: string,
): Promise<DeployStatus> {
  const featureParam = feature ? `?feature=${encodeURIComponent(feature)}` : '';
  return apiGet(
    `${PREVIEW_BASE()}/projects/${encodeURIComponent(projectId)}/deploy/status${featureParam}`,
  );
}
