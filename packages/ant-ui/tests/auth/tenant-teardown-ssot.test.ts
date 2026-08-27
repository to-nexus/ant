/**
 * Tenant-scoped teardown SSOT.
 *
 * One axis, two triggers:
 *
 *   T1 — `clearUser` (sign-out / stale-session). Regression guard for plan
 *        `stale-session-lifecycle-cascade`: the cleanup was once partial, so
 *        lifecycle hooks kept firing protected requests under a half-cleared
 *        identity.
 *
 *   T2 — `setUser` observing a DIFFERENT organization than the one the store
 *        hydrated with (org switch, cross-tab switch, re-login as another
 *        account). Without it the previous tenant's `selectedProject` survived
 *        the switch reload, the unified SSE opened against a project absent
 *        from the new workspace root, and the backend's 404 became a permanent
 *        reconnect loop pinned on the "connecting" placeholder.
 *
 * Both consume `slices/auth/tenantScrub`, so the assertions here are
 * behavioral — the point is that the two paths cannot drift, not that a
 * particular literal appears in a particular file.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';
import { create } from 'zustand';

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

// ── T2: setUser ──────────────────────────────────────────────────────────────

describe('setUser tenant-change scrub', () => {
  it('cross-org: drops the previous tenant\'s project identity, lists and storage', () => {
    const s = buildStore();
    seed(s, 'org-a');

    s.getState().setUser('u@example.com', 'org-b', 'U', undefined, 'uid', 'team', [], undefined, 0);

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

  it('same-org reload: PRESERVES the selection (the every-mount re-setUser path)', () => {
    const s = buildStore();
    seed(s, 'org-a');

    s.getState().setUser('u@example.com', 'org-a', 'U', undefined, 'uid', 'team', [], undefined, 0);

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

    s.getState().setUser('u@example.com', 'org-a', 'U', undefined, 'uid', 'individual', [], undefined, 0);

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

    s.getState().setUser('u@example.com', 'org-b', 'U', undefined, 'uid', 'team', [], undefined, 0);
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
  it('handleSignOut does not duplicate the cleanup inline', () => {
    const src = readFileSync(APP_NAVBAR, 'utf-8');
    const match = src.match(/const\s+handleSignOut\s*=\s*async\s*\([\s\S]*?\)\s*=>\s*\{([\s\S]*?)\n\s\s\};/);
    expect(match, 'handleSignOut function should exist').toBeTruthy();
    const body = match![1];
    expect(body).toMatch(/clearUser\(\)/);
    expect(body).not.toMatch(/setProjects\(\[\]\)/);
    expect(body).not.toMatch(/setSelectedProject\(undefined\)/);
    expect(body).not.toMatch(/setSelectedFeature\(undefined\)/);
    expect(body).not.toMatch(/\breset\(\)/);
  });

  it('handleSwitchOrg goes through switchActiveOrg, not an inline reload', () => {
    const src = readFileSync(APP_NAVBAR, 'utf-8');
    const match = src.match(/const\s+handleSwitchOrg\s*=\s*async\s*\([\s\S]*?\)\s*=>\s*\{([\s\S]*?)\n\s\s\};/);
    expect(match, 'handleSwitchOrg function should exist').toBeTruthy();
    const body = match![1];
    expect(body).toMatch(/switchActiveOrg\(/);
    expect(body).not.toMatch(/window\.location\.reload\(\)/);
  });
});
