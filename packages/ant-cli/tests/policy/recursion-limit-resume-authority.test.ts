/**
 * Locks the resume-time recursionLimit authority.
 *
 * RCA `west-beating-shelf`: the run carried recursionLimit=800 despite
 * `.env` RECURSION_LIMIT=200. Source: both resume sites in `code/runner.ts`
 * did `Math.max(session.state.recursionLimit || 0, finalLimit)`. That ratchet
 * only ever RAISES, so a stale-HIGH session value (800 from an older run)
 * stuck and overrode the lowered env on every resume.
 *
 * Fix: the env/job-derived `finalLimit` (re-derived each resume by
 * loadRecursionLimit) is authoritative — a stale LOW value still cannot cap a
 * raised env (finalLimit already reflects it), and a stale HIGH value no longer
 * sticks. This guard prevents the Math.max ratchet from returning.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const RUNNER = join(
  __dirname,
  '../../src/agents/architect/graph/code/runner.ts',
);

describe('code runner — env-authoritative recursionLimit on resume', () => {
  const src = readFileSync(RUNNER, 'utf8');

  it('does not ratchet recursionLimit via Math.max against the stored session value', () => {
    // Any Math.max(...) whose first arg is the stored session.state.recursionLimit
    // is the stale-high ratchet bug. Match across whitespace.
    const ratchet =
      /Math\.max\(\s*session\.state\.recursionLimit[\s\S]*?finalLimit\s*\)/;
    expect(src).not.toMatch(ratchet);
  });

  it('assigns the env/job-derived finalLimit on resume', () => {
    // Both resume sites must take finalLimit directly.
    expect(src).toMatch(/initial\.recursionLimit\s*=\s*finalLimit/);
    expect(src).toMatch(/recursionLimit:\s*finalLimit/);
  });
});
