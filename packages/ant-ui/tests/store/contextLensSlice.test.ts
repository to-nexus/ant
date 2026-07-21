/**
 * Context Lens FE state (E2-4) — featureLog slice extension.
 *
 * Locks:
 *  - estimate/lens load transitions (AsyncFields, ui-async-policy §2.1)
 *  - feature-scoped key guard: a stale response from a previous feature
 *    never overwrites the current feature's data
 *  - lens 'empty' derivation when no band content exists
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create } from 'zustand';

const getContextEstimateMock = vi.fn();
const getContextLensMock = vi.fn();

vi.mock('@/infrastructure/http/api/featureLog', () => ({
  getFeatureBreadcrumbs: vi.fn(async () => []),
  getContextEstimate: (...args: unknown[]) => getContextEstimateMock(...args),
  getContextLens: (...args: unknown[]) => getContextLensMock(...args),
  resetFeatureContext: vi.fn(),
}));

import { createFeatureLogSlice, type FeatureLogSlice } from '../../src/domain/store/slices/featureLogSlice';

function makeStore() {
  return create<FeatureLogSlice>()((set, get, store) =>
    createFeatureLogSlice(set as any, get as any, store as any),
  );
}

const ESTIMATE = {
  exchanges: 4, digests: 7, ledger: ['rule A'], summaryPresent: true,
  estimatedTokens: 3120, capTokens: 12000,
};
const LENS = {
  exchanges: [{ turnId: 't1', ts: '2026-07-21T00:00:00.000Z', userText: 'u', assistantFinalText: 'a' }],
  digests: [],
  ledger: ['rule A'],
  summary: null,
};

beforeEach(() => {
  getContextEstimateMock.mockReset().mockResolvedValue(ESTIMATE);
  getContextLensMock.mockReset().mockResolvedValue(LENS);
});

describe('loadContextEstimate', () => {
  it('loads into AsyncFields ready state', async () => {
    const store = makeStore();
    await store.getState().loadContextEstimate('p1', 'f1');
    const s = store.getState();
    expect(s.contextEstimate.status).toBe('ready');
    expect(s.contextEstimate.data).toEqual(ESTIMATE);
  });

  it('drops a stale response after a feature switch', async () => {
    const store = makeStore();
    let resolveFirst!: (v: unknown) => void;
    getContextEstimateMock
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
      .mockResolvedValueOnce({ ...ESTIMATE, estimatedTokens: 999 });

    const first = store.getState().loadContextEstimate('p1', 'f-old');
    const second = store.getState().loadContextEstimate('p1', 'f-new');
    resolveFirst({ ...ESTIMATE, estimatedTokens: 111 });
    await Promise.all([first, second]);

    expect(store.getState().contextEstimate.data?.estimatedTokens).toBe(999);
  });

  it('surfaces errors as status=error', async () => {
    const store = makeStore();
    getContextEstimateMock.mockRejectedValueOnce(new Error('boom'));
    await store.getState().loadContextEstimate('p1', 'f1');
    expect(store.getState().contextEstimate.status).toBe('error');
    expect(store.getState().contextEstimate.error?.message).toBe('boom');
  });
});

describe('loadContextLens', () => {
  it('marks a content-less lens as empty', async () => {
    const store = makeStore();
    getContextLensMock.mockResolvedValueOnce({ exchanges: [], digests: [], ledger: [], summary: null });
    await store.getState().loadContextLens('p1', 'f1');
    expect(store.getState().contextLens.status).toBe('empty');
  });

  it('marks a lens with any band content as ready', async () => {
    const store = makeStore();
    await store.getState().loadContextLens('p1', 'f1');
    expect(store.getState().contextLens.status).toBe('ready');
    expect(store.getState().contextLens.data).toEqual(LENS);
  });
});

describe('clearFeatureLog', () => {
  it('resets the context resources to idle', async () => {
    const store = makeStore();
    await store.getState().loadContextEstimate('p1', 'f1');
    store.getState().clearFeatureLog();
    expect(store.getState().contextEstimate.status).toBe('idle');
    expect(store.getState().contextLens.status).toBe('idle');
    expect(store.getState().contextLensKey).toBeUndefined();
  });
});
