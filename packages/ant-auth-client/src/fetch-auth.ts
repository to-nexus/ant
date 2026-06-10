import type { AuthMeResult, AuthUser, OrgKind, OrgMembership } from './types';

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
      role: r.role === 'owner' ? 'owner' : 'member',
    });
  }
  return out;
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

  // Phase 3 envelope fields — tolerate missing/legacy responses by
  // defaulting to "settled session, no suggestion" so older servers
  // keep working.
  const envelope = data as {
    needsOnboarding?: unknown;
    suggestedOrganizationName?: unknown;
    activeOrg?: unknown;
    memberships?: unknown;
  };
  const needsOnboarding = envelope.needsOnboarding === true;
  const suggestedOrganizationName =
    typeof envelope.suggestedOrganizationName === 'string'
      ? envelope.suggestedOrganizationName
      : null;

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
    },
    activeOrg,
    memberships,
    needsOnboarding,
    suggestedOrganizationName,
  };
}

/** Binary signed-in / not-signed-in shim over `fetchAuthMeDetailed`. */
export async function fetchAuthMe(opts: FetchAuthOptions): Promise<AuthUser | null> {
  const result = await fetchAuthMeDetailed(opts);
  return result.kind === 'user' ? result.user : null;
}
