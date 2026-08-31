/**
 * orgSlice — org resource loaders (members / invites / domains / join
 * requests / removal rows), banner dismissal persistence, and the
 * join-surface visibility selectors (dismissed invites hide from the banner
 * but stay counted for the dot; the auto-join notice hides once it IS the
 * active org).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create } from 'zustand';

// Node test env has no Web Storage — install an in-memory stand-in BEFORE the
// slice module loads (its initial state reads localStorage at import time).
vi.hoisted(() => {
  const make = () => {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
      setItem: (k: string, v: string) => void map.set(k, String(v)),
      removeItem: (k: string) => void map.delete(k),
      clear: () => map.clear(),
      key: (i: number) => Array.from(map.keys())[i] ?? null,
      get length() { return map.size; },
    };
  };
  (globalThis as any).localStorage = make();
  (globalThis as any).sessionStorage = make();
});

const apiMock = {
  fetchOrgMembers: vi.fn(),
  fetchOrgInvites: vi.fn(),
  fetchOrgDomains: vi.fn(),
  fetchJoinRequests: vi.fn(),
  fetchRemovedMembers: vi.fn(),
};
vi.mock('@/infrastructure/http/api/organizations', () => ({
  fetchOrgMembers: (...a: unknown[]) => apiMock.fetchOrgMembers(...a),
  fetchOrgInvites: (...a: unknown[]) => apiMock.fetchOrgInvites(...a),
  fetchOrgDomains: (...a: unknown[]) => apiMock.fetchOrgDomains(...a),
  fetchJoinRequests: (...a: unknown[]) => apiMock.fetchJoinRequests(...a),
  fetchRemovedMembers: (...a: unknown[]) => apiMock.fetchRemovedMembers(...a),
}));

import { createOrgSlice, type OrgSlice } from '../../src/domain/store/slices/orgSlice';
import {
  selectVisiblePendingInvites,
  selectVisibleDomainJoinableOrgs,
  selectVisibleAutoJoinedOrg,
  selectMyPendingJoinRequestByOrg,
  selectRoleForOrg,
  selectIsAdminOfOrg,
  selectTeamMemberships,
} from '../../src/domain/store/selectors/auth';

function makeStore(seed?: Partial<OrgSlice>) {
  return create<OrgSlice>()((set, get, store) => ({
    ...createOrgSlice(set as any, get as any, store as any),
    ...seed,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('org resource loaders', () => {
  it('loadOrgMembers: loading → ready with rows', async () => {
    apiMock.fetchOrgMembers.mockResolvedValue({
      members: [{ userId: 'a@x.io', email: 'a@x.io', role: 'owner', joinedAt: '2026-01-01' }],
    });
    const store = makeStore();
    await store.getState().loadOrgMembers('acme');
    expect(apiMock.fetchOrgMembers).toHaveBeenCalledWith('acme');
    expect(store.getState().orgMembersStatus).toBe('ready');
    expect(store.getState().orgMembers).toHaveLength(1);
  });

  it('loader failure lands on error status without throwing', async () => {
    apiMock.fetchOrgInvites.mockRejectedValue(new Error('403'));
    const store = makeStore();
    await store.getState().loadOrgInvites('acme');
    expect(store.getState().orgInvitesStatus).toBe('error');
    expect(store.getState().orgInvites).toEqual([]);
  });

  it('loadOrgJoinRequests: loading → ready with rows', async () => {
    apiMock.fetchJoinRequests.mockResolvedValue({
      joinRequests: [{ id: 'req-1', organizationId: 'acme', status: 'pending' }],
    });
    const store = makeStore();
    await store.getState().loadOrgJoinRequests('acme');
    expect(apiMock.fetchJoinRequests).toHaveBeenCalledWith('acme');
    expect(store.getState().orgJoinRequestsStatus).toBe('ready');
    expect(store.getState().orgJoinRequests).toHaveLength(1);
  });

  it('loadOrgRemovedMembers: loading → ready with rows', async () => {
    apiMock.fetchRemovedMembers.mockResolvedValue({
      removedMembers: [{ userId: 'lee@acme.com', email: 'lee@acme.com', reason: 'removed' }],
    });
    const store = makeStore();
    await store.getState().loadOrgRemovedMembers('acme');
    expect(store.getState().orgRemovedMembersStatus).toBe('ready');
    expect(store.getState().orgRemovedMembers).toHaveLength(1);
  });

  it('resetOrgResources drops EVERY resource back to idle', async () => {
    apiMock.fetchOrgDomains.mockResolvedValue({ domains: [{ domain: 'x.io' }] });
    apiMock.fetchJoinRequests.mockResolvedValue({ joinRequests: [{ id: 'r' }] });
    apiMock.fetchRemovedMembers.mockResolvedValue({ removedMembers: [{ userId: 'u' }] });
    const store = makeStore();
    await store.getState().loadOrgDomains('acme');
    await store.getState().loadOrgJoinRequests('acme');
    await store.getState().loadOrgRemovedMembers('acme');
    store.getState().resetOrgResources();
    expect(store.getState().orgDomains).toEqual([]);
    expect(store.getState().orgDomainsStatus).toBe('idle');
    expect(store.getState().orgJoinRequests).toEqual([]);
    expect(store.getState().orgJoinRequestsStatus).toBe('idle');
    expect(store.getState().orgRemovedMembers).toEqual([]);
    expect(store.getState().orgRemovedMembersStatus).toBe('idle');
  });
});

describe('banner dismissal', () => {
  it('dismissInvite persists to localStorage and undismissAllInvites clears', () => {
    const store = makeStore();
    store.getState().dismissInvite('inv-1');
    expect(store.getState().dismissedInviteIds).toContain('inv-1');
    expect(JSON.parse(localStorage.getItem('ant-ui:org:dismissed-invites') ?? '[]')).toContain('inv-1');
    store.getState().undismissAllInvites();
    expect(store.getState().dismissedInviteIds).toEqual([]);
  });

  it('dismissDomainBanner is keyed by orgId', () => {
    const store = makeStore();
    store.getState().dismissDomainBanner('acme');
    expect(store.getState().dismissedDomainOrgIds).toContain('acme');
  });

  it('dismissAutoJoinBanner is keyed by orgId and persists separately', () => {
    const store = makeStore();
    store.getState().dismissAutoJoinBanner('acme');
    expect(store.getState().dismissedAutoJoinOrgIds).toContain('acme');
    expect(
      JSON.parse(localStorage.getItem('ant-ui:org:dismissed-autojoin-banners') ?? '[]'),
    ).toContain('acme');
    // the three dismissal sets are independent
    expect(store.getState().dismissedDomainOrgIds).toEqual([]);
    expect(store.getState().dismissedInviteIds).toEqual([]);
  });
});

describe('join-surface visibility selectors', () => {
  const invite = (id: string) => ({
    id,
    token: `t-${id}`,
    organizationId: 'acme',
    organizationName: 'Acme',
    role: 'member' as const,
    invitedBy: 'kim@acme.com',
    expiresAt: '2099-01-01',
  });

  it('dismissed invites hide from the banner list but pendingInvites keeps them (dot)', () => {
    const state = {
      pendingInvites: [invite('a'), invite('b')],
      dismissedInviteIds: ['a'],
      domainJoinableOrgs: [],
      dismissedDomainOrgIds: [],
    } as any;
    expect(selectVisiblePendingInvites(state).map((i: any) => i.id)).toEqual(['b']);
    expect(state.pendingInvites).toHaveLength(2);
  });

  it('domain banner respects per-org dismissal', () => {
    const state = {
      pendingInvites: [],
      dismissedInviteIds: [],
      domainJoinableOrgs: [
        { organizationId: 'acme', organizationName: 'Acme', domain: 'acme.com', autoJoinRole: 'member' },
        { organizationId: 'beta', organizationName: 'Beta', domain: 'beta.io', autoJoinRole: 'member' },
      ],
      dismissedDomainOrgIds: ['acme'],
    } as any;
    expect(selectVisibleDomainJoinableOrgs(state).map((d: any) => d.organizationId)).toEqual(['beta']);
  });
});

describe('auto-join notice visibility', () => {
  const autoJoined = { organizationId: 'acme', organizationName: 'Acme', domain: 'acme.com' };

  it('shows while the team is not the active org', () => {
    const state = { autoJoinedOrg: autoJoined, userOrganization: 'individual', dismissedAutoJoinOrgIds: [] } as any;
    expect(selectVisibleAutoJoinedOrg(state)).toEqual(autoJoined);
  });

  it('hides once it IS the active org (nothing left to switch to)', () => {
    const state = { autoJoinedOrg: autoJoined, userOrganization: 'acme', dismissedAutoJoinOrgIds: [] } as any;
    expect(selectVisibleAutoJoinedOrg(state)).toBeNull();
  });

  it('hides when dismissed', () => {
    const state = { autoJoinedOrg: autoJoined, userOrganization: 'individual', dismissedAutoJoinOrgIds: ['acme'] } as any;
    expect(selectVisibleAutoJoinedOrg(state)).toBeNull();
  });

  it('is null when the login granted nothing', () => {
    const state = { autoJoinedOrg: null, userOrganization: 'individual', dismissedAutoJoinOrgIds: [] } as any;
    expect(selectVisibleAutoJoinedOrg(state)).toBeNull();
  });
});

describe('own join requests', () => {
  it('indexes only PENDING requests by org id', () => {
    const state = {
      myJoinRequests: [
        { id: 'r1', organizationId: 'acme', status: 'pending' },
        { id: 'r2', organizationId: 'beta', status: 'rejected' },
        { id: 'r3', organizationId: 'gamma', status: 'pending' },
      ],
    } as any;
    const byOrg = selectMyPendingJoinRequestByOrg(state);
    expect([...byOrg.keys()].sort()).toEqual(['acme', 'gamma']);
    expect(byOrg.get('acme')?.id).toBe('r1');
  });
});

describe('org-hub membership selectors', () => {
  /**
   * The hub manages a team the user is NOT active in, so these must read the
   * membership row for the given org — never `userOrganization`.
   */
  const state = {
    userOrganization: 'individual',
    memberships: [
      { organizationId: 'individual', kind: 'individual', name: 'Individual', role: 'member' },
      { organizationId: 'acme', kind: 'team', name: 'Acme', role: 'owner' },
      { organizationId: 'beta', kind: 'team', name: 'Beta', role: 'admin' },
      { organizationId: 'gamma', kind: 'team', name: 'Gamma', role: 'member' },
    ],
  } as any;

  it.each([
    ['acme', 'owner', true],
    ['beta', 'admin', true],
    ['gamma', 'member', false],
    ['unknown', undefined, false],
    [null, undefined, false],
  ])('org %s → role %s, admin %s', (orgId, role, isAdmin) => {
    expect(selectRoleForOrg(state, orgId as any)).toBe(role);
    expect(selectIsAdminOfOrg(state, orgId as any)).toBe(isAdmin);
  });

  it('resolves a non-active org, so the active org is not the authority', () => {
    expect(state.userOrganization).toBe('individual');
    expect(selectRoleForOrg(state, 'acme')).toBe('owner');
  });

  it('lists team memberships only — individual is not a manageable org', () => {
    expect(selectTeamMemberships(state).map((m: any) => m.organizationId)).toEqual([
      'acme',
      'beta',
      'gamma',
    ]);
  });
});
