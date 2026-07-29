/**
 * KanbanBroadcaster — per-model anti-shrink guard.
 *
 * The per-model cache is fed job-CUMULATIVE maps from a single authoritative
 * owner per phase, so its input-side total is monotonic non-decreasing. A
 * SMALLER incoming map signals a partial/stale publisher — the class of bug
 * that let one task's map clobber the full job map and under-charge ~55×. The
 * guard rejects shrinking updates (and still ignores empty `{}`), while allowing
 * equal/growing cumulative updates through.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('ioredis', () => {
  class MockRedis {
    on() { return this; }
    async set() { return 'OK' as const; }
    async publish() { return 1; }
    async quit() { return 'OK' as const; }
  }
  return { Redis: MockRedis, default: MockRedis };
});

const { KanbanBroadcaster } = await import('../../src/core/realtime/KanbanBroadcaster');

function mkBroadcaster() {
  return new KanbanBroadcaster({
    redisUrl: 'redis://mock',
    jobId: 'job-1',
    projectId: 'proj-1',
    featureName: 'feat-1',
    jobType: 'code',
    userContext: { userId: 'u1', organizationId: 'org1' } as any,
  });
}

const u = (input: number, output: number, cacheRead = 0) => ({
  inputTokens: input,
  outputTokens: output,
  totalTokens: input + output,
  cacheReadTokens: cacheRead,
});

describe('KanbanBroadcaster — per-model anti-shrink guard', () => {
  let b: any;
  beforeEach(() => {
    b = mkBroadcaster();
  });

  it('accepts a growing cumulative update', () => {
    b.updateTokenUsageByModel({ 'deepseek-v4-pro': u(100, 1) });
    b.updateTokenUsageByModel({ 'deepseek-v4-pro': u(300, 4), 'claude-opus-5': u(147, 15) });
    expect(Object.keys(b.cachedTokenUsageByModel)).toEqual(['deepseek-v4-pro', 'claude-opus-5']);
    expect(b.cachedTokenUsageByModel['deepseek-v4-pro'].inputTokens).toBe(300);
  });

  it('rejects a shrinking update (partial/stale publisher)', () => {
    const full = { 'deepseek-v4-pro': u(12_000_000, 114_000, 10_800_000), 'claude-opus-5': u(147_000, 15_000) };
    b.updateTokenUsageByModel(full);
    // A single task's tiny map arrives late — must NOT clobber the full one.
    b.updateTokenUsageByModel({ 'deepseek-v4-pro': u(254_000, 4_600, 220_000) });
    expect(b.cachedTokenUsageByModel).toBe(full);
    expect(b.cachedTokenUsageByModel['claude-opus-5']).toBeDefined();
  });

  it('still ignores an empty {} update', () => {
    b.updateTokenUsageByModel({ 'deepseek-v4-pro': u(100, 1) });
    b.updateTokenUsageByModel({});
    expect(b.cachedTokenUsageByModel['deepseek-v4-pro'].inputTokens).toBe(100);
  });

  it('accepts an equal-total update (idempotent re-broadcast)', () => {
    const map = { 'deepseek-v4-pro': u(500, 5) };
    b.updateTokenUsageByModel({ ...map });
    b.updateTokenUsageByModel({ ...map });
    expect(b.cachedTokenUsageByModel['deepseek-v4-pro'].inputTokens).toBe(500);
  });
});
