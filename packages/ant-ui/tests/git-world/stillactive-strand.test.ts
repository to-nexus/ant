/**
 * Regression — `fetchGitWorldState` MUST clear its own `refreshing`
 * flag on `stillActive` failure (= user navigated mid-request) so the
 * status button doesn't get stranded at "확인중" forever.
 *
 * BUT the clear must be guarded by a fetch-sequence check: if a newer
 * fetch has already started after us, that newer fetch's
 * `refreshing=true` must NOT be clobbered by our stale cleanup —
 * otherwise the spinner flickers and the newer fetch's response
 * shows up against a "not refreshing" state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create } from 'zustand';
import type { GitSnapshot, GitPatState } from '@ant/shared';

vi.mock('../../src/domain/git-world/infrastructure/api', () => ({
  fetchGitState: vi.fn(),
  dispatchGitOp: vi.fn(),
  fetchPatState: vi.fn(),
  savePat: vi.fn(),
  deletePat: vi.fn(),
}));

import { createGitWorldSlice } from '../../src/domain/git-world/state';
import { fetchGitState } from '../../src/domain/git-world/infrastructure/api';

function makeSnapshot(): GitSnapshot {
  return {
    hasGit: true,
    hasRemote: true,
    hasUpstream: true,
    hasFeatures: false,
    remoteExists: true,
    currentBranch: 'main',
    staged: [],
    unstaged: [],
    untracked: [],
    ahead: 0,
    behind: 0,
  } as GitSnapshot;
}

function buildStore(initial: { selectedProject?: string; selectedFeature?: string } = {}) {
  return create<any>((set, get, store) => ({
    selectedProject: initial.selectedProject ?? 'P',
    selectedFeature: initial.selectedFeature,
    ...createGitWorldSlice(set as any, get as any, store as any),
  }));
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fetchGitWorldState stillActive failure clears own refreshing', () => {
  it('clears refreshing when the user navigates mid-request (no newer fetch)', async () => {
    let resolveFetch: (v: any) => void = () => undefined;
    vi.mocked(fetchGitState)
      .mockImplementationOnce(() => new Promise((res) => { resolveFetch = res; }))
      // Nothing else fetched for project Q, so the bail converges. Distinct
      // branch names let us prove WHICH response was applied.
      .mockResolvedValue({
        snapshot: { ...makeSnapshot(), currentBranch: 'live' },
        pat: { configured: true } as GitPatState,
      });

    const useStore = buildStore({ selectedProject: 'P', selectedFeature: undefined });

    // Kick off the first fetch — refreshing becomes true.
    const inflight = useStore.getState().fetchGitWorldState('P', { feature: undefined });
    expect(useStore.getState().snapshot.refreshing).toBe(true);

    // User navigates to another project mid-flight.
    useStore.setState({ selectedProject: 'Q' });

    // Stale response arrives — stillActive must fail, so the STALE payload is
    // never applied; the convergence hop then fills in the live identity.
    resolveFetch({
      snapshot: { ...makeSnapshot(), currentBranch: 'stale' },
      pat: { configured: true } as GitPatState,
    });
    await inflight;
    await flush();

    expect(vi.mocked(fetchGitState).mock.calls[1][0]).toBe('Q');
    expect(useStore.getState().snapshot.data?.currentBranch).toBe('live');
    expect(useStore.getState().snapshot.refreshing).toBe(false);
  });

  it('does NOT clobber a newer fetch that started after us', async () => {
    let resolveOld: (v: any) => void = () => undefined;
    let resolveNew: (v: any) => void = () => undefined;

    vi.mocked(fetchGitState)
      .mockImplementationOnce(() => new Promise((res) => { resolveOld = res; }))
      .mockImplementationOnce(() => new Promise((res) => { resolveNew = res; }));

    const useStore = buildStore({ selectedProject: 'P', selectedFeature: undefined });

    // Old fetch in flight (for project P)
    const oldInflight = useStore.getState().fetchGitWorldState('P', { feature: undefined });
    expect(useStore.getState().snapshot.refreshing).toBe(true);

    // User navigates → newer fetch fires for Q
    useStore.setState({ selectedProject: 'Q' });
    const newInflight = useStore.getState().fetchGitWorldState('Q', { feature: undefined });
    expect(useStore.getState().snapshot.refreshing).toBe(true);

    // Old fetch's stale response arrives — stillActive fails, BUT a newer
    // reqId is in flight: must NOT clear refreshing.
    resolveOld({ snapshot: makeSnapshot(), pat: { configured: true } as GitPatState });
    await oldInflight;
    expect(useStore.getState().snapshot.refreshing).toBe(true); // newer fetch still pending

    // New fetch resolves — refreshing must finalize to false with data.
    resolveNew({ snapshot: makeSnapshot(), pat: { configured: true } as GitPatState });
    await newInflight;
    expect(useStore.getState().snapshot.refreshing).toBe(false);
    expect(useStore.getState().snapshot.data).not.toBeNull();
  });

  // The bail above is ABSORBING on a zero-feature surface: the SSE stream is
  // feature-scoped, so no `reconnectRefill` / `workingTreeChange` can heal it,
  // and the lifecycle effect only re-runs on an identity change. Without a
  // convergence re-dispatch the status button sits on a dead "확인중" chip
  // until the user reloads the page.
  it('converges once against the live identity when the bail leaves no data', async () => {
    let resolveStale: (v: any) => void = () => undefined;
    vi.mocked(fetchGitState)
      .mockImplementationOnce(() => new Promise((res) => { resolveStale = res; }))
      .mockResolvedValueOnce({
        snapshot: makeSnapshot(),
        pat: { configured: true } as GitPatState,
      });

    const useStore = buildStore({ selectedProject: 'P', selectedFeature: 'A' });

    const inflight = useStore.getState().fetchGitWorldState('P', { feature: 'A' });
    // Feature deleted mid-flight → identity flips to the project-level surface.
    useStore.setState({ selectedFeature: undefined });

    resolveStale({ snapshot: makeSnapshot(), pat: { configured: true } as GitPatState });
    await inflight;
    await flush();

    // Re-dispatched with the LIVE identity (no feature) and applied.
    expect(vi.mocked(fetchGitState)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetchGitState).mock.calls[1][1]).toMatchObject({ feature: undefined });
    expect(useStore.getState().snapshot.data).not.toBeNull();
    expect(useStore.getState().snapshot.refreshing).toBe(false);
  });

  it('does not converge when data is already displayed', async () => {
    vi.mocked(fetchGitState).mockResolvedValue({
      snapshot: makeSnapshot(),
      pat: { configured: true } as GitPatState,
    });

    const useStore = buildStore({ selectedProject: 'P', selectedFeature: undefined });
    await useStore.getState().fetchGitWorldState('P', { feature: undefined });
    expect(useStore.getState().snapshot.data).not.toBeNull();
    vi.mocked(fetchGitState).mockClear();

    // A stale fetch bails, but there is a good snapshot on screen — nothing
    // to converge for.
    const inflight = useStore.getState().fetchGitWorldState('P', { feature: 'gone' });
    await inflight;
    await flush();

    expect(vi.mocked(fetchGitState)).toHaveBeenCalledTimes(1);
  });

  it('convergence retry never re-dispatches (single hop)', async () => {
    const useStore = buildStore({ selectedProject: 'P', selectedFeature: 'A' });
    let flips = 0;

    vi.mocked(fetchGitState).mockImplementation(async () => {
      // Every response lands on a stale identity: the store keeps moving.
      useStore.setState({ selectedFeature: `f${++flips}` });
      return { snapshot: makeSnapshot(), pat: { configured: true } as GitPatState };
    });

    await useStore.getState().fetchGitWorldState('P', { feature: 'A' });
    await flush();

    // original + exactly one convergence hop — no unbounded loop.
    expect(vi.mocked(fetchGitState)).toHaveBeenCalledTimes(2);
  });

  it('catch-path still clears refreshing on fetch error (unchanged)', async () => {
    vi.mocked(fetchGitState).mockRejectedValueOnce(new Error('boom'));

    const useStore = buildStore({ selectedProject: 'P', selectedFeature: undefined });
    await useStore.getState().fetchGitWorldState('P', { feature: undefined });
    await flush();

    expect(useStore.getState().snapshot.refreshing).toBe(false);
    expect(useStore.getState().snapshot.error).toBe('boom');
  });
});
