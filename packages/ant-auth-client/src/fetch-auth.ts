import type {
  AuthMeResult,
  AuthUser,
  OrgKind,
  OrgMembership,
  PendingInvite,
  DomainJoinableOrg,
  MyJoinRequest,
  JoinRequestStatus,
  AutoJoinedOrg,
} from './types';

const ORG_KINDS: ReadonlySet<string> = new Set(['local', 'individual', 'team']);

function asOrgKind(v: unknown): OrgKind | undefined {
  return typeof v === 'string' && ORG_KINDS.has(v) ? (v as OrgKind) : undefined;
}

function parseMemberships(v: unknown): OrgMembership[] {
  if (!Array.isArray(v)) return [];
  const out: OrgMembership[] = [];
  for (const m of v) {
    if (typeof m !== 'object' || m === null) continue;
    const r = m as Record<string, unknown>;
    const kind = asOrgKind(r.kind);
    if (typeof r.organizationId !== 'string' || !kind) continue;
    out.push({
      organizationId: r.organizationId,
      kind,
      name: typeof r.name === 'string' ? r.name : r.organizationId,
      role: r.role === 'owner' ? 'owner' : r.role === 'admin' ? 'admin' : 'member',
    });
  }
  return out;
}

function parsePendingInvites(v: unknown): PendingInvite[] {
  if (!Array.isArray(v)) return [];
  const out: PendingInvite[] = [];
  for (const m of v) {
    if (typeof m !== 'object' || m === null) continue;
    const r = m as Record<string, unknown>;
    if (
      typeof r.id !== 'string' ||
      typeof r.token !== 'string' ||
      typeof r.organizationId !== 'string'
    ) {
      continue;
    }
    out.push({
      id: r.id,
      token: r.token,
      organizationId: r.organizationId,
      organizationName:
        typeof r.organizationName === 'string' ? r.organizationName : r.organizationId,
      role: r.role === 'admin' ? 'admin' : 'member',
      invitedBy: typeof r.invitedBy === 'string' ? r.invitedBy : '',
      expiresAt: typeof r.expiresAt === 'string' ? r.expiresAt : '',
    });
  }
  return out;
}

function parseDomainJoinableOrgs(v: unknown): DomainJoinableOrg[] {
  if (!Array.isArray(v)) return [];
  const out: DomainJoinableOrg[] = [];
  for (const m of v) {
    if (typeof m !== 'object' || m === null) continue;
    const r = m as Record<string, unknown>;
    if (typeof r.organizationId !== 'string' || typeof r.domain !== 'string') continue;
    out.push({
      organizationId: r.organizationId,
      organizationName:
        typeof r.organizationName === 'string' ? r.organizationName : r.organizationId,
      domain: r.domain,
      autoJoinRole: r.autoJoinRole === 'admin' ? 'admin' : 'member',
    });
  }
  return out;
}

function parseMyJoinRequests(v: unknown): MyJoinRequest[] {
  if (!Array.isArray(v)) return [];
  const out: MyJoinRequest[] = [];
  for (const m of v) {
    if (typeof m !== 'object' || m === null) continue;
    const r = m as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.organizationId !== 'string') continue;
    out.push({
      id: r.id,
      organizationId: r.organizationId,
      organizationName:
        typeof r.organizationName === 'string' ? r.organizationName : r.organizationId,
      status: asJoinRequestStatus(r.status),
      createdAt: typeof r.createdAt === 'string' ? r.createdAt : '',
      expiresAt: typeof r.expiresAt === 'string' ? r.expiresAt : '',
    });
  }
  return out;
}

function asJoinRequestStatus(v: unknown): JoinRequestStatus {
  return v === 'approved' || v === 'rejected' || v === 'canceled' || v === 'expired'
    ? v
    : 'pending';
}

function parseAutoJoinedOrg(v: unknown): AutoJoinedOrg | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  if (typeof r.organizationId !== 'string' || typeof r.domain !== 'string') return null;
  return {
    organizationId: r.organizationId,
    organizationName:
      typeof r.organizationName === 'string' ? r.organizationName : r.organizationId,
    domain: r.domain,
  };
}

export interface FetchAuthOptions {
  /** Absolute API base, e.g. `https://ant-server.crosstoken.io/api` or `/api`. */
  apiBase: string;
}

/**
 * Detailed `/auth/me` fetch — returns a 5-mode discriminated result. Both
 * ant-site and ant-ui consume this; `App.tsx` uses every branch for
 * stale-session vs network-hiccup disambiguation.
 *
 * The endpoint always responds 200 with `{ user: User | null }`. Non-2xx is
 * reserved for genuine server faults (503 = JWT misconfigured).
 */
export async function fetchAuthMeDetailed(
  opts: FetchAuthOptions,
): Promise<AuthMeResult> {
  let response: Response;
  try {
    response = await fetch(`${opts.apiBase}/auth/me`, {
      credentials: 'include',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: 'network', message };
  }

  if (!response.ok) {
    if (response.status === 503) return { kind: 'misconfigured' };
    return { kind: 'http-error', status: response.status };
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return { kind: 'shape', raw: undefined };
  }

  if (typeof data !== 'object' || data === null || !('user' in data)) {
    return { kind: 'shape', raw: data };
  }

  const user = (data as { user: unknown }).user;
  if (user === null) return { kind: 'no-session' };
  if (typeof user !== 'object') return { kind: 'shape', raw: data };

  const u = user as Partial<AuthUser>;
  if (!u.email || !u.userId || !u.organization) {
    return { kind: 'shape', raw: data };
  }

  // Envelope fields — every one is tolerated as missing so an older server
  // keeps working (empty join surface, no active-org context).
  const envelope = data as {
    activeOrg?: unknown;
    memberships?: unknown;
    pendingInvites?: unknown;
    domainJoinableOrgs?: unknown;
    myJoinRequests?: unknown;
    autoJoinedOrg?: unknown;
  };

  const orgKind = asOrgKind((u as { kind?: unknown }).kind);
  const memberships = parseMemberships(envelope.memberships);

  let activeOrg: { id: string; kind: OrgKind; name: string } | null = null;
  const ao = envelope.activeOrg;
  if (typeof ao === 'object' && ao !== null) {
    const r = ao as Record<string, unknown>;
    const kind = asOrgKind(r.kind);
    if (typeof r.id === 'string' && kind) {
      activeOrg = { id: r.id, kind, name: typeof r.name === 'string' ? r.name : r.id };
    }
  }

  return {
    kind: 'user',
    user: {
      email: u.email,
      userId: u.userId,
      organization: u.organization,
      orgKind,
      name: u.name,
      picture: u.picture,
      // Legacy servers omit these — default to approved / non-admin / level 0.
      approvalStatus:
        u.approvalStatus === 'pending' || u.approvalStatus === 'denied' || u.approvalStatus === 'approved'
          ? u.approvalStatus
          : 'approved',
      isAdmin: u.isAdmin === true,
      testAccountLevel: typeof u.testAccountLevel === 'number' ? u.testAccountLevel : 0,
    },
    activeOrg,
    memberships,
    pendingInvites: parsePendingInvites(envelope.pendingInvites),
    domainJoinableOrgs: parseDomainJoinableOrgs(envelope.domainJoinableOrgs),
    myJoinRequests: parseMyJoinRequests(envelope.myJoinRequests),
    autoJoinedOrg: parseAutoJoinedOrg(envelope.autoJoinedOrg),
  };
}

/** Binary signed-in / not-signed-in shim over `fetchAuthMeDetailed`. */
export async function fetchAuthMe(opts: FetchAuthOptions): Promise<AuthUser | null> {
  const result = await fetchAuthMeDetailed(opts);
  return result.kind === 'user' ? result.user : null;
}
