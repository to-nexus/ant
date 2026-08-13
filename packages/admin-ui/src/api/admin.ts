import type {
  AdminUserListResponse,
  AdminUserDetail,
  AdminConfig,
  ApprovalStatus,
  DefaultApprovalMode,
  BalanceSnapshot,
  SystemConfigResponse,
  AdminOrgSummary,
  AdminOrgDetail,
  OrgDomainClaimView,
} from '@ant/shared';

/** Same-origin API base — cookies ride automatically (`credentials: 'include'`). */
const API = '/api';

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j.error || j.code || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json();
}

const enc = encodeURIComponent;

let systemConfigPromise: Promise<SystemConfigResponse> | undefined;

/** Fetched once per page load — capability gates (refund exists only when billing is on). */
export function getSystemConfig(): Promise<SystemConfigResponse> {
  systemConfigPromise ??= req<SystemConfigResponse>('GET', '/system/config');
  return systemConfigPromise;
}

export const adminApi = {
  listUsers: (status?: ApprovalStatus) =>
    req<AdminUserListResponse>('GET', `/admin/users${status ? `?status=${status}` : ''}`),
  getUser: (userId: string) => req<AdminUserDetail>('GET', `/admin/users/${enc(userId)}`),
  setApproval: (userId: string, status: ApprovalStatus) =>
    req('POST', `/admin/users/${enc(userId)}/approval`, { status }),
  setTestLevel: (userId: string, testAccountLevel: number) =>
    req('POST', `/admin/users/${enc(userId)}/test-level`, { testAccountLevel }),
  refund: (userId: string, credits: number, reason: string, idempotencyKey: string) =>
    req<BalanceSnapshot>('POST', `/admin/users/${enc(userId)}/refund`, { credits, reason, idempotencyKey }),
  getConfig: () => req<AdminConfig>('GET', '/admin/config'),
  setConfig: (defaultApprovalMode: DefaultApprovalMode) =>
    req<AdminConfig>('PUT', '/admin/config', { defaultApprovalMode }),
  // Organizations (Phase 1)
  listOrganizations: () =>
    req<{ organizations: AdminOrgSummary[] }>('GET', '/admin/organizations'),
  getOrganization: (orgId: string) =>
    req<AdminOrgDetail>('GET', `/admin/organizations/${enc(orgId)}`),
  adminVerifyDomain: (orgId: string, domain: string) =>
    req<{ domain: OrgDomainClaimView }>('POST', `/admin/organizations/${enc(orgId)}/domains/${enc(domain)}/verify`),
  adminRejectDomain: (orgId: string, domain: string) =>
    req<{ domain: OrgDomainClaimView }>('POST', `/admin/organizations/${enc(orgId)}/domains/${enc(domain)}/reject`),
  adminForceDeleteOrg: (orgId: string) =>
    req<{ ok: boolean }>('DELETE', `/admin/organizations/${enc(orgId)}`),
};
