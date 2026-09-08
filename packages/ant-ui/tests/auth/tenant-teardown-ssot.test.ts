/**
 * The store identity SSOT — one writer applies it whole, two triggers tear it
 * down.
 *
 *   W  — `applyAuthMe` takes the ENTIRE `/auth/me` success envelope. It used
 *        to be two actions split by field group (`setUser` for the user +
 *        `memberships`, `setJoinSurface` for invites / domain candidates /
 *        join requests / auto-join notice) held together only by a comment
 *        saying to call them together. The two sites that gain a membership
 *        mid-session — invite accept and domain join — called only the
 *        join-surface half, so a freshly joined org never reached the account
 *        switcher (or the org panel's own team list) until a page refresh.
 *
 *   T1 — `clearUser` (sign-out / stale-session). Regression guard for plan
 *        `stale-session-lifecycle-cascade`: the cleanup was once partial, so
 *        lifecycle hooks kept firing protected requests under a half-cleared
 *        identity.
 *
 *   T2 — `applyAuthMe` observing a DIFFERENT organization than the one the
 *        store hydrated with (org switch, cross-tab switch, re-login as
 *        another account). Without it the previous tenant's `selectedProject`
 *        survived the switch reload, the unified SSE opened against a project
 *        absent from the new workspace root, and the backend's 404 became a
 *        permanent reconnect loop pinned on the "connecting" placeholder.
 *
 * T1 and T2 consume `slices/auth/tenantScrub`, so the assertions here are
 * behavioral — the point is that the paths cannot drift, not that a particular
 * literal appears in a particular file. `setUser` / `setJoinSurface` need no
 * grep guard: they no longer exist on `AuthSlice`, so `pnpm typecheck` is what
 * refuses the old spellings.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import * as path from 'path';
import { create } from 'zustand';
import type { AuthMeEnvelope } from '@ant/auth-client/types';

import { isTenantChange } from '../../src/domain/store/slices/auth/tenantScrub';
import { createAuthSlice } from '../../src/domain/store/slices/authSlice';
import { createProjectSlice } from '../../src/domain/store/slices/projectSlice';
import { createFileSlice } from '../../src/domain/store/slices/fileSlice';
import { createUISlice } from '../../src/domain/store/slices/uiSlice';
import { createPreviewSlice } from '../../src/domain/store/slices/previewSlice';
import { createDeploySlice } from '../../src/domain/store/slices/deploySlice';
import { createTransferSlice } from '../../src/domain/store/slices/transferSlice';
import { createResetSlice } from '../../src/domain/store/slices/resetSlice';
import { STORAGE_KEYS } from '../../src/domain/store/storage';

const disconnectAll = vi.fn();
vi.mock('@/infrastructure/sse/SSEManager', () => ({
  sseManager: {
    disconnectAll: (...a: unknown[]) => disconnectAll(...a),
    connectWorkflow: vi.fn(),
    disconnectWorkflow: vi.fn(),
    updateJobParam: vi.fn(),
  },
}));

vi.mock('@/infrastructure/http/api', () => ({
  fetchFeatureSession: vi.fn().mockResolvedValue(null),
  fetchFeatures: vi.fn().mockResolvedValue([]),
}));

function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
  } as Storage;
}
vi.stubGlobal('sessionStorage', memStorage());
vi.stubGlobal('localStorage', memStorage());

const APP_NAVBAR = path.resolve(__dirname, '..', '..', 'src', 'presentation', 'components', 'AppNavBar.tsx');
const USE_SIGN_OUT = path.resolve(__dirname, '..', '..', 'src', 'application', 'hooks', 'ui', 'useSignOut.ts');
const ORG_SETTINGS_PANEL = path.resolve(__dirname, '..', '..', 'src', 'presentation', 'components', 'org', 'OrgSettingsPanel.tsx');
const SRC = path.resolve(__dirname, '..', '..', 'src');
const PRESENTATION = path.join(SRC, 'presentation');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(full) ? [full] : [];
  });
}

function buildStore() {
  return create<any>((set, get, store) => ({
    ...createProjectSlice(set as any, get as any, store as any),
    ...createFileSlice(set as any, get as any, store as any),
    ...createUISlice(set as any, get as any, store as any),
    ...createPreviewSlice(set as any, get as any, store as any),
    ...createDeploySlice(set as any, get as any, store as any),
    ...createTransferSlice(set as any, get as any, store as any),
    ...createResetSlice(set as any, get as any, store as any),
    ...createAuthSlice(set as any, get as any, store as any),
  }));
}

/**
 * A `/auth/me` success envelope. Every row builds one through here so no test
 * hand-spells a subset — hand-spelling is the shape the production bug took.
 */
function envelope(over: Partial<AuthMeEnvelope> = {}): AuthMeEnvelope {
  const { user, ...rest } = over as any;
  return {
    kind: 'user',
    user: {
      email: 'u@example.com',
      organization: 'org-a',
      name: 'U',
      picture: undefined,
      userId: 'uid',
      orgKind: 'team',
      approvalStatus: 'approved',
      testAccountLevel: 0,
      ...(user ?? {}),
    },
    activeOrg: null,
    memberships: [],
    pendingInvites: [],
    domainJoinableOrgs: [],
    myJoinRequests: [],
    autoJoinedOrg: null,
    ...rest,
  } as AuthMeEnvelope;
}

/** Seed a signed-in tenant with a live project selection. */
function seed(s: any, org: string) {
  s.setState({
    userEmail: 'u@example.com',
    userOrganization: org,
    authStatus: 'verifying',
    selectedProject: 'proj-old',
    selectedFeature: 'feat-old',
    features: [{ name: 'feat-old' }],
    projects: ['proj-old'],
    projectsStatus: 'ready',
    accountAgents: [{ id: 'a1' }],
    selectedCustomAgentId: 'a1',
  });
  sessionStorage.setItem(STORAGE_KEYS.SELECTED_PROJECT, JSON.stringify('proj-old'));
  localStorage.setItem(STORAGE_KEYS.SELECTED_PROJECT, JSON.stringify('proj-old'));
  sessionStorage.setItem(STORAGE_KEYS.PROJECT_LAST_FEATURES, JSON.stringify({ 'proj-old': 'feat-old' }));
  localStorage.setItem(STORAGE_KEYS.PROJECT_LAST_FEATURES, JSON.stringify({ 'proj-old': 'feat-old' }));
}

function storedSelection() {
  return {
    session: sessionStorage.getItem(STORAGE_KEYS.SELECTED_PROJECT),
    local: localStorage.getItem(STORAGE_KEYS.SELECTED_PROJECT),
    lastFeatures: sessionStorage.getItem(STORAGE_KEYS.PROJECT_LAST_FEATURES),
  };
}

beforeEach(() => {
  disconnectAll.mockClear();
  sessionStorage.clear();
  localStorage.clear();
});

// ── The predicate ────────────────────────────────────────────────────────────

describe('isTenantChange', () => {
  const rows: Array<[string, string | undefined, string | undefined, boolean]> = [
    ['first sign-in (no previous org) is not a switch', undefined, 'org-a', false],
    ['same-org reload is not a switch',                 'org-a',   'org-a', false],
    ['different org is a switch',                       'org-a',   'org-b', true],
    ['personal → team is a switch',                     'personal-1', 'team-9', true],
    ['org disappearing is a switch',                    'org-a',   undefined, true],
  ];
  it.each(rows)('%s', (_label, prev, next, expected) => {
    expect(isTenantChange(prev, next)).toBe(expected);
  });
});

// ── T2: applyAuthMe tenant change ────────────────────────────────────────────

describe('applyAuthMe tenant-change scrub', () => {
  it('cross-org: drops the previous tenant\'s project identity, lists and storage', () => {
    const s = buildStore();
    seed(s, 'org-a');

    s.getState().applyAuthMe(envelope({ user: { organization: 'org-b' } }));

    const st = s.getState();
    expect(st.userOrganization).toBe('org-b');
    expect(st.selectedProject).toBeUndefined();
    expect(st.selectedFeature).toBeUndefined();
    expect(st.features).toEqual([]);
    expect(st.projects).toEqual([]);
    // 'idle', not 'empty' — the new tenant's fetch has not happened yet, so the
    // boot gate and the session-restore gate must both stay closed.
    expect(st.projectsStatus).toBe('idle');
    expect(st.accountAgents).toEqual([]);
    expect(st.selectedCustomAgentId).toBeUndefined();
    expect(disconnectAll).toHaveBeenCalled();

    const stored = storedSelection();
    expect(stored.session).toBeNull();
    expect(stored.local).toBeNull();
    expect(stored.lastFeatures).toBeNull();
  });

  it('same-org reload: PRESERVES the selection (the every-mount re-apply path)', () => {
    const s = buildStore();
    seed(s, 'org-a');

    s.getState().applyAuthMe(envelope());

    const st = s.getState();
    expect(st.selectedProject).toBe('proj-old');
    expect(st.selectedFeature).toBe('feat-old');
    expect(st.projects).toEqual(['proj-old']);
    expect(st.projectsStatus).toBe('ready');
    expect(disconnectAll).not.toHaveBeenCalled();
    expect(storedSelection().session).not.toBeNull();
  });

  it('first sign-in (no previous org): does not scrub', () => {
    const s = buildStore();
    s.setState({ userOrganization: undefined, projects: [], projectsStatus: 'idle' });
    sessionStorage.setItem(STORAGE_KEYS.SELECTED_PROJECT, JSON.stringify('proj-x'));

    s.getState().applyAuthMe(envelope({ user: { orgKind: 'individual' } }));

    expect(disconnectAll).not.toHaveBeenCalled();
    expect(storedSelection().session).not.toBeNull();
  });

  it('never publishes an intermediate "verified + stale project" snapshot', () => {
    // The invariant behind the single set(): useProjectLifecycle wakes on
    // (selectedProject, selectedFeature, authStatus) and would fire
    // initializeSSE() for the old tenant if it ever observed that pair.
    const s = buildStore();
    seed(s, 'org-a');

    const offenders: Array<{ authStatus: string; selectedProject?: string }> = [];
    const unsub = s.subscribe((st: any) => {
      if (st.authStatus === 'verified' && st.selectedProject !== undefined) {
        offenders.push({ authStatus: st.authStatus, selectedProject: st.selectedProject });
      }
    });

    s.getState().applyAuthMe(envelope({ user: { organization: 'org-b' } }));
    unsub();

    expect(offenders).toEqual([]);
  });
});

// ── W: the whole envelope, or nothing ────────────────────────────────────────

describe('applyAuthMe publishes the whole envelope', () => {
  const INDIVIDUAL = { organizationId: 'org-a', kind: 'individual', name: 'Individual', role: 'owner' };
  const TEAM = { organizationId: 'team-9', kind: 'team', name: 'Team Nine', role: 'member' };

  it('a same-org re-apply that adds a membership publishes it and does not scrub', () => {
    // The reported bug, as behaviour: joining by domain (or accepting an
    // invite) leaves the active org alone and only grows `memberships`. The
    // switcher must see it immediately, and nothing may be torn down.
    const s = buildStore();
    seed(s, 'org-a');
    s.setState({ memberships: [INDIVIDUAL] });

    s.getState().applyAuthMe(envelope({ memberships: [INDIVIDUAL, TEAM] as any }));

    const st = s.getState();
    expect(st.memberships).toHaveLength(2);
    expect(st.memberships[1].organizationId).toBe('team-9');
    expect(st.selectedProject).toBe('proj-old');
    expect(disconnectAll).not.toHaveBeenCalled();
  });

  // One row per envelope field: a field added to `/auth/me` and forgotten in
  // the writer fails here rather than reaching a screen as stale data.
  const fields: Array<[string, Partial<AuthMeEnvelope>, unknown]> = [
    ['memberships', { memberships: [TEAM] as any }, [TEAM]],
    ['pendingInvites', { pendingInvites: [{ id: 'i1' }] as any }, [{ id: 'i1' }]],
    ['domainJoinableOrgs', { domainJoinableOrgs: [{ organizationId: 'o1' }] as any }, [{ organizationId: 'o1' }]],
    ['myJoinRequests', { myJoinRequests: [{ id: 'r1' }] as any }, [{ id: 'r1' }]],
    ['autoJoinedOrg', { autoJoinedOrg: { organizationId: 'o2' } as any }, { organizationId: 'o2' }],
    ['userPicture', { user: { picture: 'pic.png' } } as any, 'pic.png'],
    ['approvalStatus', { user: { approvalStatus: 'pending' } } as any, 'pending'],
  ];
  const storeKey: Record<string, string> = { userPicture: 'userPicture', approvalStatus: 'approvalStatus' };

  it.each(fields)('carries %s through from the envelope', (field, over, expected) => {
    const s = buildStore();
    seed(s, 'org-a');
    // Populate every field first, so a writer that simply never touches the
    // field cannot pass by leaving an initial value that happens to match.
    s.getState().applyAuthMe(envelope({
      memberships: [INDIVIDUAL] as any,
      pendingInvites: [{ id: 'stale' }] as any,
      domainJoinableOrgs: [{ organizationId: 'stale' }] as any,
      myJoinRequests: [{ id: 'stale' }] as any,
      autoJoinedOrg: { organizationId: 'stale' } as any,
      user: { picture: 'stale.png', approvalStatus: 'approved' } as any,
    }));

    s.getState().applyAuthMe(envelope(over));

    expect((s.getState() as any)[storeKey[field] ?? field]).toEqual(expected);
  });

  it('never publishes half an envelope alongside the verified flip', () => {
    // The atomicity statement. Split back into two set() calls, a subscriber
    // observes 'verified' with the previous tenant's membership list — which
    // is precisely how the account switcher rendered stale rows.
    const s = buildStore();
    seed(s, 'org-a');
    s.getState().applyAuthMe(envelope({ memberships: [INDIVIDUAL] as any }));

    const offenders: Array<{ memberships: number; invites: number }> = [];
    const unsub = s.subscribe((st: any) => {
      if (st.authStatus === 'verified' && (st.memberships.length !== 2 || st.pendingInvites.length !== 1)) {
        offenders.push({ memberships: st.memberships.length, invites: st.pendingInvites.length });
      }
    });

    s.getState().applyAuthMe(envelope({
      memberships: [INDIVIDUAL, TEAM] as any,
      pendingInvites: [{ id: 'i1' }] as any,
    }));
    unsub();

    expect(offenders).toEqual([]);
  });
});

// ── T1: clearUser ────────────────────────────────────────────────────────────

describe('clearUser cascade', () => {
  it('clears the identity, the tenant-scoped state and the stored selection', () => {
    const s = buildStore();
    seed(s, 'org-a');
    s.setState({ authStatus: 'verified' });

    s.getState().clearUser();

    const st = s.getState();
    expect(st.userEmail).toBeUndefined();
    expect(st.userOrganization).toBeUndefined();
    expect(st.authStatus).toBe('expired');
    expect(st.selectedProject).toBeUndefined();
    expect(st.selectedFeature).toBeUndefined();
    expect(st.projects).toEqual([]);
    expect(st.projectsStatus).toBe('idle');
    expect(st.accountAgents).toEqual([]);
    expect(storedSelection().session).toBeNull();
    expect(storedSelection().lastFeatures).toBeNull();
  });

  it('invokes reset() so kanban/job/feature state is cascaded', () => {
    const s = buildStore();
    seed(s, 'org-a');
    s.setState({ isRunning: true, currentJobId: 'job-1' });

    s.getState().clearUser();

    expect(s.getState().isRunning).toBe(false);
    expect(s.getState().currentJobId).toBeUndefined();
  });
});

// ── No inline duplication at the call sites ──────────────────────────────────

describe('AppNavBar delegates to the SSOTs', () => {
  // The teardown itself moved into `useSignOut` when `AccountApprovalGate`
  // gained a sign-out button (that screen mounts no nav bar). What must hold is
  // unchanged: `clearUser()` is the whole cleanup, and no call site re-derives
  // its cascade inline.
  const NO_INLINE_CASCADE = [
    /setProjects\(\[\]\)/,
    /setSelectedProject\(undefined\)/,
    /setSelectedFeature\(undefined\)/,
    /\breset\(\)/,
  ];

  it('the sign-out procedure calls clearUser and nothing else', () => {
    const src = readFileSync(USE_SIGN_OUT, 'utf-8');
    expect(src).toMatch(/clearUser\(\)/);
    for (const pattern of NO_INLINE_CASCADE) expect(src).not.toMatch(pattern);
  });

  it('handleSignOut delegates and duplicates no cleanup inline', () => {
    const src = readFileSync(APP_NAVBAR, 'utf-8');
    const match = src.match(/const\s+handleSignOut\s*=\s*async\s*\([\s\S]*?\)\s*=>\s*\{([\s\S]*?)\n\s\s\};/);
    expect(match, 'handleSignOut function should exist').toBeTruthy();
    const body = match![1];
    expect(body).toMatch(/signOut\(\)/);
    for (const pattern of NO_INLINE_CASCADE) expect(body).not.toMatch(pattern);
  });

  // Both switchers, not just the one that was remembered: the org panel grew a
  // second copy that called `switchOrg` + reload directly and so skipped
  // `removeTenantScopedStorage`.
  const switchers: Array<[string, string, string]> = [
    ['AppNavBar', APP_NAVBAR, 'handleSwitchOrg'],
    ['OrgSettingsPanel', ORG_SETTINGS_PANEL, 'handleSwitch'],
  ];
  it.each(switchers)('%s.%s goes through switchActiveOrg, not an inline reload', (_label, file, fn) => {
    const src = readFileSync(file, 'utf-8');
    const match = src.match(new RegExp(`const\\s+${fn}\\s*=\\s*async\\s*\\([\\s\\S]*?\\)\\s*=>\\s*\\{([\\s\\S]*?)\\n\\s\\s\\};`));
    expect(match, `${fn} function should exist`).toBeTruthy();
    const body = match![1];
    expect(body).toMatch(/switchActiveOrg\(/);
    expect(body).not.toMatch(/window\.location\.reload\(\)/);
  });
});

// ── Adoption, by SET rather than by remembered call site ─────────────────────

describe('the /auth/me seams have one owner each', () => {
  it('nothing under presentation/ reads /auth/me directly', () => {
    // Five components used to, and each decided for itself which half of the
    // envelope to apply. The rule enumerates the directory, not the five.
    const offenders = walk(PRESENTATION).filter((f) =>
      /fetchAuthMeDetailed\s*\(/.test(readFileSync(f, 'utf-8')),
    );
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it('switchOrg is imported by exactly one file', () => {
    const importers = walk(SRC).filter((f) => {
      const src = readFileSync(f, 'utf-8');
      return /import\s*\{[^}]*\bswitchOrg\b[^}]*\}/.test(src);
    });
    expect(importers.map((f) => path.relative(SRC, f))).toEqual([
      path.join('application', 'auth', 'switchActiveOrg.ts'),
    ]);
  });
});
