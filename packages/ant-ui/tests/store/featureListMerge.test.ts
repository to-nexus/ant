/**
 * Non-regressing feature-list merge (projectSlice).
 *
 * Locks the SSOT fix for the cloud symptom "created feature doesn't appear
 * until refresh + the 'flesh out idea' badge lingers": the sole list writer
 * `fetchFeatures` must not let a stale cross-pod GET drop a just-created
 * (optimistically-added) feature, and a failed GET must not wipe the list.
 *
 * Reconcile state (`pendingFeatures`) lives ONLY in `addFeatureOptimistic`
 * (writer) and `fetchFeatures` (consumer). Per-project tag + grace window make
 * it self-clearing — no cleanup in setSelectedProject / delete / QuickStart.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { create } from 'zustand';

import { createProjectSlice } from '../../src/domain/store/slices/projectSlice';

const apiMock = vi.hoisted(() => ({ fetchFeatures: vi.fn() }));

// projectSlice's `fetchFeatures` dynamically imports this module.
vi.mock('@/infrastructure/http/api', () => apiMock);

// projectSlice imports the SSEManager singleton (touches `window` at load).
vi.mock('@/infrastructure/sse/SSEManager', () => ({
  sseManager: {
    disconnectAll: vi.fn(),
    connectWorkflow: vi.fn(),
    disconnectWorkflow: vi.fn(),
  },
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

const P = 'proj-1';
const OTHER = 'proj-2';

function buildStore() {
  const useStore = create<any>((set, get, store) => ({
    ...createProjectSlice(set as any, get as any, store as any),
  }));
  // `local` server mode → not auth-blocked, so fetchFeatures runs its body.
  useStore.setState({ serverMode: { status: 'ready', data: 'local' } });
  return useStore;
}

beforeEach(() => {
  apiMock.fetchFeatures.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('projectSlice — non-regressing feature merge', () => {
  it('keeps an optimistic feature when a stale GET omits it', async () => {
    const s = buildStore();
    s.getState().addFeatureOptimistic('new-feat', P);
    expect(s.getState().features.map((f: any) => f.name)).toEqual(['new-feat']);

    // Stale cross-pod GET: server dir-cache hasn't caught up yet.
    apiMock.fetchFeatures.mockResolvedValueOnce([]);
    const returned = await s.getState().fetchFeatures(P);

    expect(returned.map((f: any) => f.name)).toEqual(['new-feat']);
    expect(s.getState().features.map((f: any) => f.name)).toEqual(['new-feat']);
    // Still pending — server never confirmed it.
    expect(s.getState().pendingFeatures.map((p: any) => p.name)).toEqual(['new-feat']);
  });

  it('reconciles (drops pending) once the server lists the feature', async () => {
    const s = buildStore();
    s.getState().addFeatureOptimistic('new-feat', P);

    apiMock.fetchFeatures.mockResolvedValueOnce([{ name: 'new-feat', path: 'feature/new-feat' }]);
    await s.getState().fetchFeatures(P);

    expect(s.getState().features.map((f: any) => f.name)).toEqual(['new-feat']);
    // No duplicate, and pending cleared.
    expect(s.getState().pendingFeatures).toEqual([]);
  });

  it('drops a pending feature after the grace window expires (trusts server)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const s = buildStore();
    s.getState().addFeatureOptimistic('ghost', P);

    // 31s later — beyond the 30s grace. A still-empty server list now wins.
    vi.setSystemTime(new Date('2026-01-01T00:00:31Z'));
    apiMock.fetchFeatures.mockResolvedValueOnce([]);
    await s.getState().fetchFeatures(P);

    expect(s.getState().features).toEqual([]);
    expect(s.getState().pendingFeatures).toEqual([]);
  });

  it('never merges another project\'s pending into this list', async () => {
    const s = buildStore();
    s.getState().addFeatureOptimistic('other-feat', OTHER);

    apiMock.fetchFeatures.mockResolvedValueOnce([{ name: 'existing', path: 'feature/existing' }]);
    const returned = await s.getState().fetchFeatures(P);

    expect(returned.map((f: any) => f.name)).toEqual(['existing']);
    // OTHER's pending is preserved (untouched), not leaked into P's list.
    expect(s.getState().pendingFeatures.map((p: any) => p.name)).toEqual(['other-feat']);
  });

  it('preserves the existing list when the GET fails (no wipe to [])', async () => {
    const s = buildStore();
    s.setState({ features: [{ name: 'keep', path: 'feature/keep' }] });

    apiMock.fetchFeatures.mockRejectedValueOnce(new Error('network blip'));
    const returned = await s.getState().fetchFeatures(P);

    expect(returned.map((f: any) => f.name)).toEqual(['keep']);
    expect(s.getState().features.map((f: any) => f.name)).toEqual(['keep']);
  });
});
