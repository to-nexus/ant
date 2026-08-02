import { PREVIEW_BASE, apiGet, apiPost, apiDelete } from './client';
import type {
  DeployStatus,
  DeployVisibility,
  CustomDomain,
  CustomDomainDnsInstructions,
  CustomDomainTarget,
} from '@ant/shared';
export type { DeployStatus, DeployLogEntry, DeployPhase, DeployFramework, DeployVisibility } from '@ant/shared';
export type { CustomDomain, CustomDomainStatus, CustomDomainCertStatus, CustomDomainTarget, CustomDomainDnsInstructions } from '@ant/shared';

export function startDeploy(
  projectId: string,
  feature: string,
  visibility: DeployVisibility = 'public',
): Promise<{ success: boolean; url?: string; message: string }> {
  return apiPost(
    `${PREVIEW_BASE()}/projects/${encodeURIComponent(projectId)}/deploy`,
    { feature, visibility },
  );
}

export function stopDeploy(
  projectId: string,
  feature: string,
): Promise<{ success: boolean; message: string }> {
  return apiPost(
    `${PREVIEW_BASE()}/projects/${encodeURIComponent(projectId)}/deploy/stop`,
    { feature },
  );
}

export function getDeployStatus(
  projectId: string,
  feature: string,
): Promise<DeployStatus> {
  return apiGet(
    `${PREVIEW_BASE()}/projects/${encodeURIComponent(projectId)}/deploy/status?feature=${encodeURIComponent(feature)}`,
  );
}

// ── Custom domains (deploy-only) ──

export interface CustomDomainWithDns extends CustomDomain {
  dns: CustomDomainDnsInstructions;
}

export function registerCustomDomain(
  projectId: string,
  feature: string,
  hostname: string,
  target: CustomDomainTarget,
  slug?: string,
  wildcard?: boolean,
): Promise<{ success: boolean; domain?: CustomDomain; dns?: CustomDomainDnsInstructions; reason?: string; message?: string }> {
  return apiPost(
    `${PREVIEW_BASE()}/projects/${encodeURIComponent(projectId)}/custom-domain`,
    { feature, hostname, target, slug, wildcard },
  );
}

export function listCustomDomains(
  projectId: string,
  feature: string,
): Promise<{ success: boolean; enabled: boolean; domains: CustomDomainWithDns[] }> {
  return apiGet(
    `${PREVIEW_BASE()}/projects/${encodeURIComponent(projectId)}/custom-domain/status?feature=${encodeURIComponent(feature)}`,
  );
}

export function verifyCustomDomain(
  projectId: string,
  feature: string,
  hostname: string,
): Promise<{ success: boolean; domain?: CustomDomain; reason?: string; message?: string }> {
  return apiPost(
    `${PREVIEW_BASE()}/projects/${encodeURIComponent(projectId)}/custom-domain/verify`,
    { feature, hostname },
  );
}

export function deleteCustomDomain(
  projectId: string,
  feature: string,
  hostname: string,
): Promise<{ success: boolean; reason?: string; message?: string }> {
  return apiDelete(
    `${PREVIEW_BASE()}/projects/${encodeURIComponent(projectId)}/custom-domain?feature=${encodeURIComponent(feature)}&hostname=${encodeURIComponent(hostname)}`,
  );
}
