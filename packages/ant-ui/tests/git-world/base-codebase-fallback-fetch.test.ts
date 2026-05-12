/**
 * Regression — `runGitOperation` MUST trigger an explicit
 * `fetchGitWorldState` after success when the operation targets the
 * base codebase (op.feature === undefined). The SSE channel is
 * feature-scoped at the URL level, so base-codebase ops have no
 * `operationComplete` delivery path; without this fallback the
 * snapshot stays stale (Bug: pull at base codebase leaves
 * `ahead/behind` counters unchanged).
 *
 * Feature-codebase ops MUST NOT trigger the fallback — SSE delivers
 * the fresh snapshot for that surface and a duplicate fetch would
 * burn the cache.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create } from 'zustand';
import type { GitSnapshot, GitPatState } from '@ant/shared';

vi.mock('../../src/domain/git-world/infrastructure/api', () => ({
  fetchGitState: vi.fn(async (_projectId: string, _opts: any) => ({
    snapshot: makeSnapshot({ behind: 0 }),
    pat: { configured: true } as GitPatState,
  })),
  dispatchGitOp: vi.fn(async () => ({ success: true })),
  fetchPatState: vi.fn(),
  savePat: vi.fn(),
  deletePat: vi.fn(),
}));

import { createGitWorldSlice } from '../../src/domain/git-world/state';
import { fetchGitState, dispatchGitOp } from '../../src/domain/git-world/infrastructure/api';

function makeSnapshot(partial: Partial<GitSnapshot> = {}): GitSnapshot {
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
    ...partial,
  } as GitSnapshot;
}

function buildStore(initial: { selectedProject?: string; selectedFeature?: string } = {}) {
  return create<any>((set, get, store) => ({
    selectedProject: initial.selectedProject ?? 'P',
    selectedFeature: initial.selectedFeature,
    ...createGitWorldSlice(set as any, get as any, store as any),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runGitOperation base-codebase fallback fetch', () => {
  it('triggers fetchGitWorldState after pull success when feature is undefined', async () => {
    const useStore = buildStore({ selectedProject: 'P', selectedFeature: undefined });
    await useStore.getState().runGitOperation('P', { kind: 'pull', feature: undefined });

    // dispatched once, fallback fetched once
    expect(dispatchGitOp).toHaveBeenCalledTimes(1);
    expect(fetchGitState).toHaveBeenCalledTimes(1);
    expect(fetchGitState).toHaveBeenCalledWith('P', { feature: undefined });
  });

  it('does NOT trigger fallback fetch when feature is set (SSE handles it)', async () => {
    const useStore = buildStore({ selectedProject: 'P', selectedFeature: 'X' });
    await useStore.getState().runGitOperation('P', { kind: 'pull', feature: 'X' });

    expect(dispatchGitOp).toHaveBeenCalledTimes(1);
    expect(fetchGitState).not.toHaveBeenCalled();
  });

  it('triggers fallback for clone (variant has no `feature` field at runtime)', async () => {
    const useStore = buildStore({ selectedProject: 'P', selectedFeature: undefined });
    await useStore.getState().runGitOperation('P', { kind: 'clone' });

    expect(fetchGitState).toHaveBeenCalledTimes(1);
    expect(fetchGitState).toHaveBeenCalledWith('P', { feature: undefined });
  });

  it('does NOT trigger fallback on failure', async () => {
    vi.mocked(dispatchGitOp).mockResolvedValueOnce({
      success: false,
      error: { kind: 'unknown', message: 'boom', retryable: false, suggestedAction: null },
    });

    const useStore = buildStore({ selectedProject: 'P', selectedFeature: undefined });
    const result = await useStore.getState().runGitOperation('P', { kind: 'pull', feature: undefined });

    expect(result.success).toBe(false);
    expect(fetchGitState).not.toHaveBeenCalled();
  });
});
