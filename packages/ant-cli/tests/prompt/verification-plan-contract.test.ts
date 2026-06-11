/**
 * Verification plan output contract — diagnose-only, fan-out-only.
 *
 * The verification task has NO execute phase: it diagnoses gate failures and
 * emits `batches[]` so the system spawns dedicated error sub-tasks that own the
 * edits. The template must therefore offer EXACTLY two output shapes — a
 * `batches[]` Fix Plan (≥ 1 batch) or the empty no-errors sentinel — and must
 * NOT offer a non-empty flat `implementation` plan.
 *
 * Regression guard for `grim-padding-grove`: the variant previously carried a
 * "Format A: Single Plan" with a non-empty flat `implementation` block plus a
 * "single-root-cause investigation belongs in a flat plan" instruction. When the
 * LLM judged a single root cause it emitted that flat plan, which `finalize.ts`
 * had nowhere to route except the (forbidden) inline execute loop — the loop
 * then thrashed to the LangGraph recursion limit (200) and aborted the job.
 * Removing the flat fix-shape makes the leak unreachable by construction; this
 * test fails if it is reintroduced.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const VARIANT_DIR = join(
  __dirname,
  '../../src/core/prompt/templates/jobs/code/nodes/plan/variants/verification',
);

const base = readFileSync(join(VARIANT_DIR, 'base.md'), 'utf8');
const rules = readFileSync(join(VARIANT_DIR, 'rules.md'), 'utf8');

describe('verification plan output contract', () => {
  it('does not offer a "Format A" / flat single-plan output shape', () => {
    expect(base).not.toMatch(/Format A/i);
    expect(base).not.toMatch(/Single Plan/i);
    // The old line-28 instruction that routed single root causes to a flat plan.
    expect(base).not.toMatch(/belongs in a flat plan/i);
  });

  it('exposes batches[] as the only fix-plan format', () => {
    expect(base).toMatch(/"batches"\s*:/);
    // The one batch boundary rule survives.
    expect(base).toMatch(/one batch per root cause/i);
  });

  it('keeps the empty no-errors sentinel (its empty implementation block is the success signal)', () => {
    // The sentinel still uses an EMPTY implementation block — that is how
    // finalize converts it to '' → noOpComplete → done. Empty is allowed; only
    // a NON-empty flat implementation fix shape is removed.
    expect(base).toMatch(/"implementation"\s*:\s*\{\s*"modify"\s*:\s*\[\s*\]/);
    expect(base).toMatch(/"totalErrors"\s*:\s*0/);
  });

  it('rules.md names the non-empty flat plan as a protocol violation', () => {
    expect(rules).toMatch(/flat\s+`?implementation`?\s+plan is a protocol violation/i);
  });
});
