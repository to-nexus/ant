/**
 * orgSlice — org resource loaders (members / invites / domains), banner
 * dismissal persistence, and the join-surface visibility selectors
 * (dismissed invites hide from the banner but stay counted for the dot).
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
};
vi.mock('@/infrastructure/http/api/organizations', () => ({
  fetchOrgMembers: (...a: unknown[]) => apiMock.fetchOrgMembers(...a),
  fetchOrgInvites: (...a: unknown[]) => apiMock.fetchOrgInvites(...a),
  fetchOrgDomains: (...a: unknown[]) => apiMock.fetchOrgDomains(...a),
}));

import { createOrgSlice, type OrgSlice } from '../../src/domain/store/slices/orgSlice';
import {
  selectVisiblePendingInvites,
  selectVisibleDomainJoinableOrgs,
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

  it('resetOrgResources drops rows and statuses back to idle', async () => {
    apiMock.fetchOrgDomains.mockResolvedValue({ domains: [{ domain: 'x.io' }] });
    const store = makeStore();
    await store.getState().loadOrgDomains('acme');
    store.getState().resetOrgResources();
    expect(store.getState().orgDomains).toEqual([]);
    expect(store.getState().orgDomainsStatus).toBe('idle');
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
