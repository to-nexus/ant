import type {
  AdminAccountListResponse,
  AdminAccountListQuery,
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
import { API_BASE } from './base';

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
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

function qs(query: AdminAccountListQuery): string {
  const p = new URLSearchParams();
  if (query.status) p.set('status', query.status);
  if (query.organizationId) p.set('organizationId', query.organizationId);
  if (query.limit) p.set('limit', String(query.limit));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const adminApi = {
  /** One row per (user × scope) — a user appears once per billing scope. */
  listAccounts: (query: AdminAccountListQuery = {}) =>
    req<AdminAccountListResponse>('GET', `/admin/users${qs(query)}`),
  getUser: (userId: string) => req<AdminUserDetail>('GET', `/admin/users/${enc(userId)}`),
  setApproval: (userId: string, status: ApprovalStatus) =>
    req('POST', `/admin/users/${enc(userId)}/approval`, { status }),
  setTestLevel: (userId: string, testAccountLevel: number) =>
    req('POST', `/admin/users/${enc(userId)}/test-level`, { testAccountLevel }),
  // organizationId is required: the ledger is keyed per (org, user).
  refund: (
    userId: string,
    organizationId: string,
    credits: number,
    reason: string,
    idempotencyKey: string,
  ) =>
    req<BalanceSnapshot>('POST', `/admin/users/${enc(userId)}/refund`, {
      organizationId,
      credits,
      reason,
      idempotencyKey,
    }),
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
  /** Purge a membership. Owners are refused — transfer or delete the org. */
  adminRemoveOrgMember: (orgId: string, userId: string) =>
    req<{ ok: boolean }>('DELETE', `/admin/organizations/${enc(orgId)}/members/${enc(userId)}`),
  /**
   * Purge an account. `confirmEmail` must match the record — the row list is a
   * dense table of near-identical emails, so the operator states which one.
   * Returns a per-step report; a partial purge is still a 200.
   */
  purgeUser: (userId: string, confirmEmail: string) =>
    req<AdminPurgeReport>(
      'DELETE',
      `/admin/users/${enc(userId)}?confirmEmail=${enc(confirmEmail)}`,
    ),
};

/** Mirrors `PurgeReport` in `core/account/purgeAccount.ts`. */
export interface AdminPurgeReport {
  userId: string;
  scopes: string[];
  ok: boolean;
  steps: Array<{ step: string; ok: boolean; detail?: string; error?: string }>;
}
