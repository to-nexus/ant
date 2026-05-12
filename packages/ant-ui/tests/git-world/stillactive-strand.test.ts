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
    vi.mocked(fetchGitState).mockImplementationOnce(
      () => new Promise((res) => { resolveFetch = res; }),
    );

    const useStore = buildStore({ selectedProject: 'P', selectedFeature: undefined });

    // Kick off the first fetch — refreshing becomes true.
    const inflight = useStore.getState().fetchGitWorldState('P', { feature: undefined });
    expect(useStore.getState().snapshot.refreshing).toBe(true);

    // User navigates to another project mid-flight.
    useStore.setState({ selectedProject: 'Q' });

    // Stale response arrives — stillActive must fail and clear refreshing.
    resolveFetch({ snapshot: makeSnapshot(), pat: { configured: true } as GitPatState });
    await inflight;

    expect(useStore.getState().snapshot.refreshing).toBe(false);
    // data must NOT be applied (wrong project).
    expect(useStore.getState().snapshot.data).toBeNull();
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

  it('catch-path still clears refreshing on fetch error (unchanged)', async () => {
    vi.mocked(fetchGitState).mockRejectedValueOnce(new Error('boom'));

    const useStore = buildStore({ selectedProject: 'P', selectedFeature: undefined });
    await useStore.getState().fetchGitWorldState('P', { feature: undefined });
    await flush();

    expect(useStore.getState().snapshot.refreshing).toBe(false);
    expect(useStore.getState().snapshot.error).toBe('boom');
  });
});
