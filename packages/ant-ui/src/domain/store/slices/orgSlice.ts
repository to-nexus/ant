/**
 * Org slice — team org settings resources (members / invites / domains /
 * join requests / removal rows) + the join-banner UI state.
 *
 * OSS-regular slice (NOT an optional/cloud slice): the org system is OSS
 * core, gated by data (`kind === 'team'`), never by overlay presence.
 * Resources are refetched on panel mount and after each mutation — no SSE,
 * v1 policy is "mutate → refetch own field" (409/404 ⇒ caller toasts and
 * refetches).
 */

import { StateCreator } from 'zustand';
import type {
  OrgMemberView,
  OrgInviteView,
  OrgDomainClaimView,
  OrgJoinRequestView,
  OrgRemovedMemberView,
} from '@ant/shared';
import {
  fetchOrgMembers,
  fetchOrgInvites,
  fetchOrgDomains,
  fetchJoinRequests,
  fetchRemovedMembers,
} from '@/infrastructure/http/api/organizations';

type OrgResourceStatus = 'idle' | 'loading' | 'ready' | 'error';

const DISMISSED_INVITES_KEY = 'ant-ui:org:dismissed-invites';
const DISMISSED_DOMAIN_KEY = 'ant-ui:org:dismissed-domain-banners';
const DISMISSED_AUTOJOIN_KEY = 'ant-ui:org:dismissed-autojoin-banners';

function loadDismissed(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function saveDismissed(key: string, ids: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(ids.slice(-50)));
  } catch {
    /* storage unavailable — banner re-appears next session, acceptable */
  }
}

export interface OrgState {
  orgMembers: OrgMemberView[];
  orgMembersStatus: OrgResourceStatus;
  orgInvites: OrgInviteView[];
  orgInvitesStatus: OrgResourceStatus;
  orgDomains: OrgDomainClaimView[];
  orgDomainsStatus: OrgResourceStatus;
  orgJoinRequests: OrgJoinRequestView[];
  orgJoinRequestsStatus: OrgResourceStatus;
  orgRemovedMembers: OrgRemovedMemberView[];
  orgRemovedMembersStatus: OrgResourceStatus;
  /** `?invite={token}` deep link, stashed until the banner consumes it. */
  inviteTokenFromUrl: string | null;
  /** Invite ids dismissed from the banner (rediscoverable via switcher dot). */
  dismissedInviteIds: string[];
  /** Domain-banner dismissals, keyed by orgId. */
  dismissedDomainOrgIds: string[];
  /** Auto-join (backfill) banner dismissals, keyed by orgId. */
  dismissedAutoJoinOrgIds: string[];
}

export interface OrgActions {
  loadOrgMembers: (orgId: string) => Promise<void>;
  loadOrgInvites: (orgId: string) => Promise<void>;
  loadOrgDomains: (orgId: string) => Promise<void>;
  loadOrgJoinRequests: (orgId: string) => Promise<void>;
  loadOrgRemovedMembers: (orgId: string) => Promise<void>;
  /** Drop loaded org resources (active-org switch / panel close). */
  resetOrgResources: () => void;
  setInviteTokenFromUrl: (token: string | null) => void;
  dismissInvite: (inviteId: string) => void;
  undismissAllInvites: () => void;
  dismissDomainBanner: (orgId: string) => void;
  dismissAutoJoinBanner: (orgId: string) => void;
}

export type OrgSlice = OrgState & OrgActions;

export const createOrgSlice: StateCreator<any, [], [], OrgSlice> = (set, get) => ({
  orgMembers: [],
  orgMembersStatus: 'idle',
  orgInvites: [],
  orgInvitesStatus: 'idle',
  orgDomains: [],
  orgDomainsStatus: 'idle',
  orgJoinRequests: [],
  orgJoinRequestsStatus: 'idle',
  orgRemovedMembers: [],
  orgRemovedMembersStatus: 'idle',
  inviteTokenFromUrl: null,
  dismissedInviteIds: loadDismissed(DISMISSED_INVITES_KEY),
  dismissedDomainOrgIds: loadDismissed(DISMISSED_DOMAIN_KEY),
  dismissedAutoJoinOrgIds: loadDismissed(DISMISSED_AUTOJOIN_KEY),

  loadOrgMembers: async (orgId) => {
    set({ orgMembersStatus: 'loading' });
    try {
      const { members } = await fetchOrgMembers(orgId);
      set({ orgMembers: members, orgMembersStatus: 'ready' });
    } catch (err) {
      console.warn('[Org] loadOrgMembers failed:', err);
      set({ orgMembersStatus: 'error' });
    }
  },

  loadOrgInvites: async (orgId) => {
    set({ orgInvitesStatus: 'loading' });
    try {
      const { invites } = await fetchOrgInvites(orgId);
      set({ orgInvites: invites, orgInvitesStatus: 'ready' });
    } catch (err) {
      console.warn('[Org] loadOrgInvites failed:', err);
      set({ orgInvitesStatus: 'error' });
    }
  },

  loadOrgDomains: async (orgId) => {
    set({ orgDomainsStatus: 'loading' });
    try {
      const { domains } = await fetchOrgDomains(orgId);
      set({ orgDomains: domains, orgDomainsStatus: 'ready' });
    } catch (err) {
      console.warn('[Org] loadOrgDomains failed:', err);
      set({ orgDomainsStatus: 'error' });
    }
  },

  loadOrgJoinRequests: async (orgId) => {
    set({ orgJoinRequestsStatus: 'loading' });
    try {
      const { joinRequests } = await fetchJoinRequests(orgId);
      set({ orgJoinRequests: joinRequests, orgJoinRequestsStatus: 'ready' });
    } catch (err) {
      console.warn('[Org] loadOrgJoinRequests failed:', err);
      set({ orgJoinRequestsStatus: 'error' });
    }
  },

  loadOrgRemovedMembers: async (orgId) => {
    set({ orgRemovedMembersStatus: 'loading' });
    try {
      const { removedMembers } = await fetchRemovedMembers(orgId);
      set({ orgRemovedMembers: removedMembers, orgRemovedMembersStatus: 'ready' });
    } catch (err) {
      console.warn('[Org] loadOrgRemovedMembers failed:', err);
      set({ orgRemovedMembersStatus: 'error' });
    }
  },

  resetOrgResources: () =>
    set({
      orgMembers: [],
      orgMembersStatus: 'idle',
      orgInvites: [],
      orgInvitesStatus: 'idle',
      orgDomains: [],
      orgDomainsStatus: 'idle',
      orgJoinRequests: [],
      orgJoinRequestsStatus: 'idle',
      orgRemovedMembers: [],
      orgRemovedMembersStatus: 'idle',
    }),

  setInviteTokenFromUrl: (token) => set({ inviteTokenFromUrl: token }),

  dismissInvite: (inviteId) => {
    const next = [...get().dismissedInviteIds, inviteId];
    saveDismissed(DISMISSED_INVITES_KEY, next);
    set({ dismissedInviteIds: next });
  },

  undismissAllInvites: () => {
    saveDismissed(DISMISSED_INVITES_KEY, []);
    set({ dismissedInviteIds: [] });
  },

  dismissDomainBanner: (orgId) => {
    const next = [...get().dismissedDomainOrgIds, orgId];
    saveDismissed(DISMISSED_DOMAIN_KEY, next);
    set({ dismissedDomainOrgIds: next });
  },

  dismissAutoJoinBanner: (orgId) => {
    const next = [...get().dismissedAutoJoinOrgIds, orgId];
    saveDismissed(DISMISSED_AUTOJOIN_KEY, next);
    set({ dismissedAutoJoinOrgIds: next });
  },
});
