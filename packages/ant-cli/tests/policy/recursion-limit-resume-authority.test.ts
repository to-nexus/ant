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

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { loadRecursionLimit } from '../../src/agents/common/graph/runnerHelpers';

const RUNNER = join(
  __dirname,
  '../../src/agents/architect/graph/code/runner.ts',
);
const TASK_WORKER = join(
  __dirname,
  '../../src/agents/architect/graph/code/parallel/TaskWorker.ts',
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

/**
 * RCA `icy-landing-glade`: the tool-call file-authoring migration doubled the
 * graph-step cost of every write round (execute + tool), but RECURSION_LIMIT
 * stayed at its pre-migration calibration — a healthy multi-edit task hit the
 * hard GraphRecursionError mid-work. The rows below lock the recalibrated
 * budget resolution: one env-interpretation owner (loadRecursionLimit), a
 * job-scoped knob for the code job, and the post-migration default floor.
 */
describe('recursionLimit resolution — single owner, job-scoped knob, calibrated default', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('CODE_RECURSION_LIMIT overrides the global RECURSION_LIMIT for the code job', () => {
    vi.stubEnv('RECURSION_LIMIT', '100');
    vi.stubEnv('CODE_RECURSION_LIMIT', '450');
    expect(loadRecursionLimit('code')).toBe(450);
  });

  it('falls back to the global RECURSION_LIMIT when no job-scoped key is set', () => {
    vi.stubEnv('RECURSION_LIMIT', '150');
    vi.stubEnv('CODE_RECURSION_LIMIT', '');
    expect(loadRecursionLimit('code')).toBe(150);
  });

  it('defaults to the tool-call-authoring calibration (≥300) when env is unset', () => {
    // Floor, not equality: each write round costs 2 super-steps under the
    // tool-call protocol, so any future default below 300 re-opens the
    // icy-landing-glade regression (100 ≈ only ~45 execute rounds).
    vi.stubEnv('RECURSION_LIMIT', '');
    vi.stubEnv('CODE_RECURSION_LIMIT', '');
    expect(loadRecursionLimit('code')).toBeGreaterThanOrEqual(300);
  });

  it('code runner resolves its limit through the job-scoped loader', () => {
    const src = readFileSync(RUNNER, 'utf8');
    expect(src).toMatch(/loadRecursionLimit\(\s*'code'\s*\)/);
  });

  it('TaskWorker does not re-parse RECURSION_LIMIT from process.env (single owner)', () => {
    const src = readFileSync(TASK_WORKER, 'utf8');
    expect(src).not.toMatch(/parseInt\(\s*process\.env\.RECURSION_LIMIT/);
    expect(src).toMatch(/loadRecursionLimit\(\s*'code'\s*\)/);
  });
});

/**
 * Budget visibility gate — the execute phase must surface the remaining
 * recursion budget to the model (plan already does via plan-tools-batch.md).
 * Without it the model has no incentive to batch independent tool calls, and
 * under the 2-steps-per-write-round cost model a one-call-per-turn cadence
 * burns the budget twice as fast. Gate-level assertions only: the variable is
 * exposed and consumed — never pin the surrounding prose.
 */
describe('execute phase — recursion-budget surfacing gate', () => {
  const BUILD_MESSAGES = join(
    __dirname,
    '../../src/agents/architect/graph/code/nodes/execute/buildMessages.ts',
  );
  const CHUNKED_EMISSION = join(
    __dirname,
    '../../src/core/prompt/templates/jobs/code/nodes/execute/injections/chunked-emission.md',
  );

  it('buildMessages exposes remainingRecursionBudget in the template vars', () => {
    const src = readFileSync(BUILD_MESSAGES, 'utf8');
    expect(src).toMatch(/remainingRecursionBudget:/);
  });

  it('the execute injection consumes {{remainingRecursionBudget}}', () => {
    const tpl = readFileSync(CHUNKED_EMISSION, 'utf8');
    expect(tpl).toContain('{{remainingRecursionBudget}}');
  });
});
