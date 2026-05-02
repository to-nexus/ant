/**
 * detectCacheReplay — verification gate cache replay marker detector.
 *
 * Locks in the markers consumed by the plan-side prompt rule
 * "Cache Replay Detection" (plan/variants/verification/rules.md). A new
 * marker added here MUST be mirrored to that rule so the LLM knows the
 * cache-bypass argument that bypasses it.
 */

import { describe, it, expect } from 'vitest';
import { detectCacheReplay } from '../../../src/agents/architect/graph/code/tasks/_shared/verify/cacheReplay';

describe('detectCacheReplay', () => {
  describe('turbo', () => {
    it('detects "cache hit, replaying logs"', () => {
      const stdout = `@gamehub/console:typecheck: cache hit, replaying logs c7d610a5d272a220
@gamehub/console:typecheck: 
@gamehub/console:typecheck: > tsc --noEmit`;
      expect(detectCacheReplay(stdout)).toEqual({ replayed: true, tool: 'turbo' });
    });

    it('is case-insensitive', () => {
      expect(detectCacheReplay('Cache Hit, REPLAYING Logs xyz')).toEqual({
        replayed: true,
        tool: 'turbo',
      });
    });
  });

  describe('nx', () => {
    it.each([
      'app:build  [local cache]',
      'lib:test [remote cache]',
      'Existing outputs match the cache, left as is.',
    ])('detects %j', input => {
      expect(detectCacheReplay(input)).toEqual({ replayed: true, tool: 'nx' });
    });
  });

  describe('lerna', () => {
    it('detects "lerna info from cache"', () => {
      expect(detectCacheReplay('lerna info from cache pkg-a')).toEqual({
        replayed: true,
        tool: 'lerna',
      });
    });

    it('detects bare "cache hit" as lerna (turbo pattern includes comma)', () => {
      expect(detectCacheReplay('lerna cache hit pkg-a')).toEqual({
        replayed: true,
        tool: 'lerna',
      });
    });
  });

  describe('non-replay output', () => {
    it.each([
      '> tsc --noEmit\nDone in 1.2s',
      'PASS  tests/foo.test.ts',
      'pnpm install completed',
      '',
    ])('returns replayed=false for %j', input => {
      expect(detectCacheReplay(input)).toEqual({ replayed: false, tool: null });
    });
  });

  describe('null / undefined safety', () => {
    it('returns replayed=false for undefined / null', () => {
      expect(detectCacheReplay(undefined)).toEqual({ replayed: false, tool: null });
      expect(detectCacheReplay(null)).toEqual({ replayed: false, tool: null });
    });
  });

  describe('first-match wins', () => {
    it('reports the first matching tool when multiple markers appear', () => {
      const stdout = `cache hit, replaying logs abc\n[local cache]`;
      expect(detectCacheReplay(stdout)).toEqual({ replayed: true, tool: 'turbo' });
    });
  });

  describe('regression — gleam-growing-grace turbo cache hit', () => {
    it('detects the original turbo cache-hit log replay', () => {
      const stdout = `@gamehub/hub:build: cache hit, replaying logs 51e0ef0f2c48a9a3
@gamehub/console:build: cache hit, replaying logs c7d610a5d272a220
 Tasks:    2 successful, 2 total
Cached:    2 cached, 2 total
  Time:    689ms`;
      expect(detectCacheReplay(stdout)).toEqual({ replayed: true, tool: 'turbo' });
    });
  });
});
