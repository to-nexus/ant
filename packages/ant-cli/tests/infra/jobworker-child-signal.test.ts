import { describe, it, expect } from 'vitest';
import { classifyChildExit } from '../../src/infrastructure/worker/JobWorker.js';

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
