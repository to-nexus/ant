import { describe, it, expect } from 'vitest';
import {
  detectOutputStall,
  normalizeStderrLineSig,
  pushLineSig,
  STALL_GRACE_MS,
  STALL_REPEAT_THRESHOLD,
} from '../src/agents/common/tool/handlers/runCommand';

function buildMap(lines: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const line of lines) pushLineSig(m, line);
  return m;
}

describe('normalizeStderrLineSig', () => {
  it('collapses numeric tokens so progress counters match', () => {
    expect(normalizeStderrLineSig('Generating static pages (1/4)')).toBe(
      normalizeStderrLineSig('Generating static pages (3/4)'),
    );
  });

  it('trims to 80 chars so long suffixes do not defeat the counter', () => {
    const long = 'Error: '.padEnd(200, 'x');
    expect(normalizeStderrLineSig(long).length).toBeLessThanOrEqual(80);
  });

  it('returns an empty string for whitespace-only input', () => {
    expect(normalizeStderrLineSig('   ')).toBe('');
    expect(normalizeStderrLineSig('\n')).toBe('');
  });
});

describe('pushLineSig', () => {
  it('increments count for repeat signatures', () => {
    const m = buildMap([
      'Error: Event handlers cannot be passed',
      'Error: Event handlers cannot be passed',
      'Error: Event handlers cannot be passed',
    ]);
    expect(m.size).toBe(1);
    expect([...m.values()][0]).toBe(3);
  });

  it('skips package-manager banner lines so they do not act as new signatures', () => {
    const m = buildMap([
      '> pulse-landing@1.0.0 build /codebase',
      '> next build',
      'Error: something',
    ]);
    expect(m.has('Error: something')).toBe(true);
    expect([...m.keys()].some(k => k.startsWith('>'))).toBe(false);
  });

  it('skips empty/whitespace lines', () => {
    const m = buildMap(['', '   ', 'real line']);
    expect(m.size).toBe(1);
  });
});

describe('detectOutputStall', () => {
  const now = 1_000_000_000_000;

  it('returns null while the command is still within the grace period', () => {
    const m = buildMap(Array(10).fill('static page generation timing out'));
    const startedAt = now - (STALL_GRACE_MS - 1_000);
    expect(detectOutputStall(m, startedAt, { now })).toBeNull();
  });

  it('fires once the grace elapsed AND the dominant signature crossed the threshold', () => {
    const m = buildMap(Array(STALL_REPEAT_THRESHOLD).fill('static page generation timing out'));
    const startedAt = now - (STALL_GRACE_MS + 10_000);
    const stall = detectOutputStall(m, startedAt, { now });
    expect(stall).not.toBeNull();
    expect(stall?.repeat).toBe(STALL_REPEAT_THRESHOLD);
    expect(stall?.signature).toBe('static page generation timing out');
  });

  it('does not fire when output is varied even past the grace period', () => {
    const m = buildMap([
      'Compiling page A',
      'Compiling page B',
      'Optimizing chunks',
      'Emitting output',
      'Done',
    ]);
    const startedAt = now - (STALL_GRACE_MS * 2);
    expect(detectOutputStall(m, startedAt, { now })).toBeNull();
  });

  it('picks the dominant signature when multiple errors compete', () => {
    const m = buildMap([
      'warning X',
      'warning X',
      'error Y',
      'error Y',
      'error Y',
      'error Y',
      'error Y',
      'error Y',
    ]);
    const startedAt = now - (STALL_GRACE_MS * 2);
    const stall = detectOutputStall(m, startedAt, { now });
    expect(stall?.signature).toBe('error Y');
    expect(stall?.repeat).toBe(6);
  });

  it('fires when Next-style progress counters collapse to a single normalized signature (stuck retry loop)', () => {
    // Real slim-burning-melon symptom: stdout prints "Generating static pages (N/4)" for each
    // retry attempt; digits normalize so all 4 iterations share one signature.
    const m = buildMap([
      'Generating static pages (0/4)',
      'Generating static pages (1/4)',
      'Generating static pages (2/4)',
      'Generating static pages (3/4)',
    ]);
    const startedAt = now - (STALL_GRACE_MS + 5_000);
    const stall = detectOutputStall(m, startedAt, { now });
    expect(stall).not.toBeNull();
    expect(stall?.repeat).toBeGreaterThanOrEqual(STALL_REPEAT_THRESHOLD);
  });

  it('respects custom graceMs / repeatThreshold for test harnesses', () => {
    const m = buildMap(Array(3).fill('same line'));
    const startedAt = now - 2_000;
    expect(detectOutputStall(m, startedAt, { now, graceMs: 1_000, repeatThreshold: 3 })).toEqual({
      signature: 'same line',
      repeat: 3,
    });
  });

  it('a new Map instance starts with count 0 — re-entry must not leak (verification retry contract)', () => {
    // Cycle 1: threshold reached, watchdog fires.
    const cycle1 = buildMap(Array(STALL_REPEAT_THRESHOLD).fill('pnpm build error'));
    const past = now - (STALL_GRACE_MS + 1_000);
    expect(detectOutputStall(cycle1, past, { now })).not.toBeNull();

    // Cycle 2: verification re-entry creates a fresh Map; same signature, same wall clock,
    // but the fresh Map is empty until the new command prints anything.
    const cycle2 = new Map<string, number>();
    pushLineSig(cycle2, 'pnpm build error');
    expect(detectOutputStall(cycle2, past, { now })).toBeNull();
  });
});
