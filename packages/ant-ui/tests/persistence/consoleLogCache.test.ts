/**
 * consoleLogCache — sessionStorage-backed preview/deploy log persistence.
 *
 * No jsdom in this workspace, so we stub a minimal `sessionStorage` + `window`
 * + `document` on globalThis and re-import the module fresh per test (it reads
 * `window.sessionStorage` and registers flush listeners at import time).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

type Cache = typeof import('../../src/infrastructure/persistence/consoleLogCache');
let cache: Cache;

function installStorage() {
  const map = new Map<string, string>();
  const sessionStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
  };
  (globalThis as any).window = globalThis;
  (globalThis as any).sessionStorage = sessionStorage;
  (globalThis as any).window.sessionStorage = sessionStorage;
  (globalThis as any).window.addEventListener = () => {};
  (globalThis as any).document = { addEventListener: () => {}, visibilityState: 'visible' };
}

beforeEach(async () => {
  vi.resetModules();
  installStorage();
  vi.useFakeTimers();
  cache = await import('../../src/infrastructure/persistence/consoleLogCache');
});

afterEach(() => {
  vi.useRealTimers();
});

const entry = (m: string) => ({ timestamp: 't', type: 'stdout' as const, message: m });

describe('consoleLogCache', () => {
  it('persists after the throttle window and reads back (roundtrip)', () => {
    const logs = [entry('hello'), entry('world')];
    cache.writeLogs('preview', 'proj:main', logs);
    // Throttled — nothing persisted yet.
    expect(cache.readLogs('preview', 'proj:main')).toBeNull();
    vi.advanceTimersByTime(500);
    expect(cache.readLogs('preview', 'proj:main')).toEqual(logs);
  });

  it('clearLogs removes persisted + pending entries', () => {
    cache.writeLogs('deploy', 'k', [entry('x')]);
    vi.advanceTimersByTime(500);
    expect(cache.readLogs('deploy', 'k')).not.toBeNull();
    cache.clearLogs('deploy', 'k');
    expect(cache.readLogs('deploy', 'k')).toBeNull();
  });

  it('caps the persisted buffer at the kind cap (preview=500), keeping newest', () => {
    const logs = Array.from({ length: 600 }, (_, i) => entry(`l${i}`));
    cache.writeLogs('preview', 'k', logs);
    vi.advanceTimersByTime(500);
    const read = cache.readLogs('preview', 'k')!;
    expect(read).toHaveLength(500);
    expect(read[read.length - 1].message).toBe('l599');
    expect(read[0].message).toBe('l100');
  });

  it('flushAll persists immediately without waiting for the throttle', () => {
    cache.writeLogs('preview', 'k', [entry('a')]);
    cache.flushAll();
    expect(cache.readLogs('preview', 'k')).toEqual([entry('a')]);
  });

  it('keys are isolated per (kind, featureKey)', () => {
    cache.writeLogs('preview', 'a:main', [entry('pa')]);
    cache.writeLogs('deploy', 'a:main', [entry('da')]);
    cache.writeLogs('preview', 'b:main', [entry('pb')]);
    vi.advanceTimersByTime(500);
    expect(cache.readLogs('preview', 'a:main')).toEqual([entry('pa')]);
    expect(cache.readLogs('deploy', 'a:main')).toEqual([entry('da')]);
    expect(cache.readLogs('preview', 'b:main')).toEqual([entry('pb')]);
  });
});
