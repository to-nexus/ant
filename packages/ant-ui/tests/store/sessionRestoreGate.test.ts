/**
 * Session-restore admission axis: WHEN may restore run, and WHAT does it
 * conclude about the saved project?
 *
 * The gate used to be `connectionStatus === 'connected'`, which is wrong in
 * both directions and produced two live bugs:
 *
 *   - too early — the auth-blocked boot branch reports 'connected' while the
 *     project list is still empty, so the one-shot burned against `projects:
 *     []`, concluded the saved project was gone, and deleted the stored
 *     selection on EVERY cloud reload;
 *   - unrecoverable — it cleared the storage keys but left the hydrated
 *     `selectedProject` in the store, so after an org switch the unified SSE
 *     opened against a cross-tenant project, 404'd, and reconnect-looped
 *     forever behind the "connecting" placeholder.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create } from 'zustand';

import {
  sessionRestoreGateOpen,
  verifySavedProject,
} from '../../src/application/hooks/ui/sessionRestoreGate';
import { selectProjectsSettled, selectProjectsLoaded } from '../../src/domain/store/selectors/projects';
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

type Status = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

// ── Admission ────────────────────────────────────────────────────────────────

describe('sessionRestoreGateOpen', () => {
  const rows: Array<[Status, boolean, boolean, string]> = [
    // status,     authBlocked, open,  why
    ['idle',       false, false, 'the auth-blocked boot writes projects:[] without moving the status'],
    ['loading',    false, false, 'fetch in flight'],
    ['error',      false, false, 'a transient server error must not look like "your project was deleted"'],
    ['ready',      false, true,  'the tenant list actually loaded'],
    ['empty',      false, true,  'the tenant genuinely has no projects'],
    ['ready',      true,  false, 'auth gate wins'],
    ['empty',      true,  false, 'a signed-out cloud boot also settles at empty'],
  ];

  it.each(rows)('%s + authBlocked=%s → %s (%s)', (status, authBlocked, open) => {
    expect(
      sessionRestoreGateOpen({ authBlocked, projectsSettled: selectProjectsSettled({ projectsStatus: status }) }),
    ).toBe(open);
  });

  it('is stricter than selectProjectsLoaded, which counts error as loaded', () => {
    expect(selectProjectsLoaded({ projectsStatus: 'error' })).toBe(true);
    expect(selectProjectsSettled({ projectsStatus: 'error' })).toBe(false);
  });
});

// ── Verdict ──────────────────────────────────────────────────────────────────

describe('verifySavedProject', () => {
  const rows: Array<[string, string | null, string[], string]> = [
    ['nothing saved',                    null,      ['p1'],       'none'],
    ['saved but list is empty',          'p1',      [],           'stale'],
    ['saved but belongs to another org', 'p1',      ['p2', 'p3'], 'stale'],
    ['saved and present',                'p1',      ['p1', 'p2'], 'restore'],
  ];
  it.each(rows)('%s → %s', (_label, saved, projects, expected) => {
    expect(verifySavedProject(saved, projects)).toBe(expected);
  });
});

// ── The stale branch delegates to the identity SSOT ──────────────────────────

describe('stale saved project clears the STORE identity, not just storage', () => {
  beforeEach(() => {
    disconnectAll.mockClear();
    sessionStorage.clear();
    localStorage.clear();
  });

  it('setSelectedProject(undefined) tears down everything the wedge needed', () => {
    const s = create<any>((set, get, store) => ({
      ...createProjectSlice(set as any, get as any, store as any),
      ...createFileSlice(set as any, get as any, store as any),
      ...createUISlice(set as any, get as any, store as any),
      ...createPreviewSlice(set as any, get as any, store as any),
      ...createDeploySlice(set as any, get as any, store as any),
      ...createTransferSlice(set as any, get as any, store as any),
      ...createResetSlice(set as any, get as any, store as any),
    }));

    // A cross-org selection that survived the switch reload.
    s.setState({
      selectedProject: 'old-org-proj',
      selectedFeature: 'feat',
      projects: ['new-a'],
      projectsStatus: 'ready',
      connectionStatus: 'disconnected',
    });
    sessionStorage.setItem(STORAGE_KEYS.SELECTED_PROJECT, JSON.stringify('old-org-proj'));
    localStorage.setItem(STORAGE_KEYS.SELECTED_PROJECT, JSON.stringify('old-org-proj'));
    sessionStorage.setItem(STORAGE_KEYS.PROJECT_LAST_FEATURES, JSON.stringify({ 'old-org-proj': 'feat' }));

    expect(verifySavedProject('old-org-proj', s.getState().projects)).toBe('stale');
    s.getState().setSelectedProject(undefined);

    const st = s.getState();
    expect(st.selectedProject).toBeUndefined();
    expect(st.selectedFeature).toBeUndefined();
    // This is what repaints the main panel away from the placeholder.
    expect(st.connectionStatus).toBe('connected');
    expect(disconnectAll).toHaveBeenCalled();
    expect(sessionStorage.getItem(STORAGE_KEYS.SELECTED_PROJECT)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.SELECTED_PROJECT)).toBeNull();
    expect(sessionStorage.getItem(STORAGE_KEYS.PROJECT_LAST_FEATURES)).toBeNull();
  });
});
