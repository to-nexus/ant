/**
 * Unit tests for the `run_command` stall watchdog helpers.
 *
 * The watchdog terminates commands that keep printing but stop making
 * progress — canonical case: Next.js `Static page generation for / is
 * still timing out after 3 attempts` looping for ~9 minutes. The helpers
 * are pure so we test them directly; the promise-race integration sits
 * inside `executeCommandLogic` and is exercised by higher-level flows.
 */

import { describe, it, expect } from 'vitest';
import {
  detectOutputStall,
  normalizeStderrLineSig,
  STALL_GRACE_MS,
  STALL_REPEAT_THRESHOLD,
} from '../src/agents/common/tool/handlers/runCommand';

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

  it('returns an empty string for whitespace-only input (callers skip these)', () => {
    expect(normalizeStderrLineSig('   ')).toBe('');
    expect(normalizeStderrLineSig('\n')).toBe('');
  });
});

describe('detectOutputStall', () => {
  const now = 1_000_000_000_000;

  it('returns null while the command is still within the grace period', () => {
    const sigs = Array(10).fill('static page generation timing out');
    const startedAt = now - (STALL_GRACE_MS - 1_000);
    expect(detectOutputStall(sigs, startedAt, { now })).toBeNull();
  });

  it('fires once the grace elapsed AND the dominant signature crossed the threshold', () => {
    const sigs = Array(STALL_REPEAT_THRESHOLD + 1).fill('static page generation timing out');
    const startedAt = now - (STALL_GRACE_MS + 10_000);
    const stall = detectOutputStall(sigs, startedAt, { now });
    expect(stall).not.toBeNull();
    expect(stall?.repeat).toBe(STALL_REPEAT_THRESHOLD + 1);
    expect(stall?.signature).toBe('static page generation timing out');
  });

  it('does not fire when output is varied even past the grace period', () => {
    const sigs = [
      'Compiling page A',
      'Compiling page B',
      'Optimizing chunks',
      'Emitting output',
      'Done',
    ];
    const startedAt = now - (STALL_GRACE_MS * 2);
    expect(detectOutputStall(sigs, startedAt, { now })).toBeNull();
  });

  it('picks the dominant signature when multiple errors compete', () => {
    const sigs = [
      'warning X',
      'warning X',
      'error Y',
      'error Y',
      'error Y',
      'error Y',
      'error Y',
      'error Y',
    ];
    const startedAt = now - (STALL_GRACE_MS * 2);
    const stall = detectOutputStall(sigs, startedAt, { now });
    expect(stall?.signature).toBe('error Y');
    expect(stall?.repeat).toBe(6);
  });

  it('respects custom graceMs / repeatThreshold for test harnesses', () => {
    const sigs = Array(3).fill('same line');
    const startedAt = now - 2_000;
    expect(detectOutputStall(sigs, startedAt, { now, graceMs: 1_000, repeatThreshold: 3 })).toEqual({
      signature: 'same line',
      repeat: 3,
    });
  });
});
