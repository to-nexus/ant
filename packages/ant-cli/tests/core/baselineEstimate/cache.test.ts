/**
 * Baseline cache tenant + fingerprint isolation — regression guard.
 *
 * Locks the SSOT-scoped cache key shape so cross-tenant leakage is
 * impossible and stale entries auto-evict when RAC bodies / draft text
 * change. O1 in the plan: cache key MUST include orgId/userId/projectId
 * — every other ant:* namespace already does.
 */

import { describe, it, expect } from 'vitest';
import type { BaselineEstimate, ResolvedArtifact } from '@ant/shared';
import type { StateStorePort } from '../../../src/core/ports/stateStore';
import {
  buildCacheKey,
  fingerprintDraft,
  fingerprintRac,
  getCached,
  setCached,
  type BaselineCacheScope,
} from '../../../src/core/baselineEstimate/cache';

function makeArtifact(path: string, body: string): ResolvedArtifact {
  return { path, role: 'ref', content: body };
}

function makeFakeStore(): StateStorePort {
  const map = new Map<string, { value: string; ttl: number }>();
  const store: any = {
    setKeyWithTTL: async (key: string, value: string, ttl: number) => {
      map.set(key, { value, ttl });
    },
    getKey: async (key: string) => map.get(key)?.value ?? null,
    deleteKey: async (key: string) => { map.delete(key); },
  };
  // Surface the internal map for assertions.
  store._map = map;
  return store as StateStorePort;
}

const baseScope = (): BaselineCacheScope => ({
  orgId: 'org-A',
  userId: 'user-1',
  projectId: 'proj-X',
  featureName: 'feat-Y',
  intent: 'gen-code-spec' as any,
  modelId: 'claude-opus-4-7',
  racFingerprint: 'abc',
  draftHash: 'def',
});

const sampleEstimate: BaselineEstimate = {
  heaviestNode: { job: 'code', node: 'decompose', reason: 'static-max' },
  staticFloor: { tokens: 0 },
  dynamic: { racBodyTokens: 0, userMessageTokens: 0 },
  total: 12_345,
  contextWindow: 200_000,
  modelId: 'claude-opus-4-7',
  timing: 'T0',
};

describe('baseline cache — key shape', () => {
  it('embeds every tenant + RAC + draft segment under the ant:baseline namespace', () => {
    const key = buildCacheKey(baseScope());
    expect(key).toBe(
      'ant:baseline:org-A:user-1:proj-X:feat-Y:gen-code-spec:claude-opus-4-7:abc:def',
    );
  });
});

describe('baseline cache — round-trip + isolation', () => {
  it('roundtrips through setCached / getCached', async () => {
    const store = makeFakeStore();
    const scope = baseScope();
    expect(await getCached(store, scope)).toBeUndefined();
    await setCached(store, scope, sampleEstimate);
    const hit = await getCached(store, scope);
    expect(hit).toEqual(sampleEstimate);
  });

  it('orgId change → cache miss (cross-tenant isolation)', async () => {
    const store = makeFakeStore();
    await setCached(store, baseScope(), sampleEstimate);
    const other = { ...baseScope(), orgId: 'org-B' };
    expect(await getCached(store, other)).toBeUndefined();
  });

  it('userId change → cache miss (cross-user isolation)', async () => {
    const store = makeFakeStore();
    await setCached(store, baseScope(), sampleEstimate);
    const other = { ...baseScope(), userId: 'user-2' };
    expect(await getCached(store, other)).toBeUndefined();
  });

  it('projectId change → cache miss', async () => {
    const store = makeFakeStore();
    await setCached(store, baseScope(), sampleEstimate);
    const other = { ...baseScope(), projectId: 'proj-Z' };
    expect(await getCached(store, other)).toBeUndefined();
  });

  it('modelId change → cache miss (model swap forces recompute)', async () => {
    const store = makeFakeStore();
    await setCached(store, baseScope(), sampleEstimate);
    const other = { ...baseScope(), modelId: 'claude-sonnet-4-6' };
    expect(await getCached(store, other)).toBeUndefined();
  });

  it('racFingerprint change → cache miss', async () => {
    const store = makeFakeStore();
    await setCached(store, baseScope(), sampleEstimate);
    const other = { ...baseScope(), racFingerprint: 'xyz' };
    expect(await getCached(store, other)).toBeUndefined();
  });

  it('draftHash change → cache miss', async () => {
    const store = makeFakeStore();
    await setCached(store, baseScope(), sampleEstimate);
    const other = { ...baseScope(), draftHash: 'qqq' };
    expect(await getCached(store, other)).toBeUndefined();
  });

  it('TTL is 300s (5 min cap)', async () => {
    const store = makeFakeStore();
    await setCached(store, baseScope(), sampleEstimate);
    const internal = (store as any)._map as Map<string, { value: string; ttl: number }>;
    const [entry] = internal.values();
    expect(entry.ttl).toBe(300);
  });
});

describe('baseline cache — fingerprint stability', () => {
  it('fingerprintRac is order-stable across path permutations', () => {
    const a = makeArtifact('a.md', 'hello');
    const b = makeArtifact('b.md', 'world');
    const fpAB = fingerprintRac([a, b]);
    const fpBA = fingerprintRac([b, a]);
    expect(fpAB).toBe(fpBA);
  });

  it('fingerprintRac changes when body length changes', () => {
    const before = fingerprintRac([makeArtifact('a.md', 'small')]);
    const after = fingerprintRac([makeArtifact('a.md', 'small + extra')]);
    expect(after).not.toBe(before);
  });

  it('fingerprintRac changes when path set changes', () => {
    const before = fingerprintRac([makeArtifact('a.md', 'x')]);
    const after = fingerprintRac([
      makeArtifact('a.md', 'x'),
      makeArtifact('b.md', 'x'),
    ]);
    expect(after).not.toBe(before);
  });

  it('fingerprintDraft is deterministic and ignores empty strings', () => {
    expect(fingerprintDraft('hello')).toBe(fingerprintDraft('hello'));
    expect(fingerprintDraft('')).toBe('empty');
    expect(fingerprintDraft(undefined)).toBe('empty');
  });
});
