import { describe, it, expect } from 'vitest';
import { classifyChildExit, resolveChildNodeOptions } from '../../src/infrastructure/worker/JobWorker.js';

const GiB = 1024 * 1024 * 1024;

// Regression guard for `tight-drafting-lever`: a cgroup OOM-kill arrives as
// SIGKILL + code=null with no JS heap-OOM error. classifyChildExit names it so
// the silent failure becomes an actionable error line.
describe('classifyChildExit', () => {
  it('flags SIGKILL+code=null as a probable OOM at error level', () => {
    const r = classifyChildExit(null, 'SIGKILL');
    expect(r?.level).toBe('error');
    expect(r?.message).toContain('probable OOM');
    expect(r?.message).toContain('SIGKILL');
  });

  it('logs other signal kills at warn without the OOM wording', () => {
    const r = classifyChildExit(null, 'SIGTERM');
    expect(r?.level).toBe('warn');
    expect(r?.message).toContain('SIGTERM');
    expect(r?.message).not.toContain('probable OOM');
  });

  it('returns null for a normal/known-code exit (existing logs cover it)', () => {
    expect(classifyChildExit(0, null)).toBeNull();
    expect(classifyChildExit(1, null)).toBeNull();
    // code present wins even if a signal is also reported.
    expect(classifyChildExit(0, 'SIGTERM')).toBeNull();
  });
});

// Companion to classifyChildExit: cap the child heap so the OOM becomes a
// catchable JS error instead of the silent SIGKILL classifyChildExit reports.
describe('resolveChildNodeOptions', () => {
  it('appends a cgroup-derived --max-old-space-size when the limit is readable', () => {
    const opts = resolveChildNodeOptions(undefined, 8 * GiB, 2);
    expect(opts).toMatch(/--max-old-space-size=\d+/);
  });

  it('returns the inherited value unchanged when no cgroup limit is readable', () => {
    expect(resolveChildNodeOptions(undefined, undefined, 2)).toBeUndefined();
    expect(resolveChildNodeOptions('--enable-source-maps', undefined, 2)).toBe('--enable-source-maps');
  });

  it('preserves an inherited --max-old-space-size (operator override wins)', () => {
    const opts = resolveChildNodeOptions('--max-old-space-size=256', 8 * GiB, 2);
    expect(opts).toBe('--max-old-space-size=256');
  });

  it('merges the derived cap after other inherited NODE_OPTIONS', () => {
    const opts = resolveChildNodeOptions('--enable-source-maps', 8 * GiB, 2);
    expect(opts).toMatch(/^--enable-source-maps --max-old-space-size=\d+$/);
  });
});
