/**
 * Regression guard for the `plan.finalizeNudge` hook surface restored
 * by the sage-blessing-pixel fix.
 *
 * Background:
 *   `a71234c2 refactor(plan): drop DiagnosticTask concept from finalize
 *   path` (2026-04-22) collapsed `selectFinalizePrompt(task)` (which
 *   branched on `isVerificationTask(task) || isErrorTask(task)`) onto a
 *   single `FINALIZE_NUDGE` constant. That cleanup was correct (the
 *   inline branch was an R1 violation) but it removed the surface where
 *   per-task-type finalize guidance can live. When `f52f89ff feat(ant-
 *   cli): test-code at-plan batch split` (2026-04-25) introduced the
 *   test-code parent's Format-A / Format-B decision, the LLM started
 *   defaulting to Format A under finalize pressure — sage-blessing-pixel
 *   collapsed a 17-test-file slice into a single 13-minute serial run.
 *
 * Resolution:
 *   `TaskPlanHook.finalizeNudge?` (publishers: test-code) restores the
 *   per-type surface via the hook registry instead of an inline branch.
 *   Phase code stays a single-line dispatch in `planGeneration.ts`:
 *
 *     const nudge =
 *       hooksForTaskType(task.type)?.plan?.finalizeNudge?.({ task, state })
 *       ?? FINALIZE_NUDGE;
 *
 * What this file locks:
 *   1. `FINALIZE_NUDGE` is exported from `planGeneration.ts` so per-type
 *      nudges can assert "I am NOT this default".
 *   2. `test-code` is the only task type that publishes `finalizeNudge`
 *      today. Other task types (verification / error / ...) MUST stay on
 *      the default — their initial prompts present a single output format
 *      and re-stating it is unnecessary.
 *   3. The `planGeneration.ts` dispatch site contains exactly one
 *      `hooksForTaskType(...).plan?.finalizeNudge` call and zero inline
 *      `task.type === '...'` branches around finalize. Drift back into
 *      the R1-violating branch shape would fail this test.
 */

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';

import { hooks as testCodeHooks } from '../../src/agents/architect/graph/code/tasks/test-code';
import { hooks as verificationHooks } from '../../src/agents/architect/graph/code/tasks/verification';
import { hooks as errorHooks } from '../../src/agents/architect/graph/code/tasks/error';
import { hooks as docHooks } from '../../src/agents/architect/graph/code/tasks/doc';
import { hooks as designSystemHooks } from '../../src/agents/architect/graph/code/tasks/design-system';
import { FINALIZE_NUDGE } from '../../src/agents/architect/graph/code/nodes/plan/planGeneration';

const PLAN_GEN_PATH = join(
  __dirname,
  '../../src/agents/architect/graph/code/nodes/plan/planGeneration.ts',
);

describe('FINALIZE_NUDGE constant — default nudge for task types without override', () => {
  it('is exported and stays platform-/format-agnostic', () => {
    expect(typeof FINALIZE_NUDGE).toBe('string');
    expect(FINALIZE_NUDGE.length).toBeGreaterThan(40);
    // The default cannot recommend a specific format — its job is to
    // forward the LLM to "the format specified in the initial prompt".
    expect(FINALIZE_NUDGE).toMatch(/initial prompt/i);
    expect(FINALIZE_NUDGE).toMatch(/<plan>/);
    expect(FINALIZE_NUDGE).not.toMatch(/Format A|Format B|batches\[\]/);
  });
});

describe('plan.finalizeNudge — per-task-type override surface', () => {
  it('test-code publishes a tailored nudge that differs from the default', () => {
    const fn = testCodeHooks.plan?.finalizeNudge;
    expect(typeof fn).toBe('function');
    const body = fn!({ task: { type: 'test-code' } as any, state: {} as any });
    expect(typeof body).toBe('string');
    expect(body).not.toBe(FINALIZE_NUDGE);
    // The override exists precisely to reinforce Format B under pressure.
    expect(body).toMatch(/Format B/);
  });

  it('verification stays on the default (no override published)', () => {
    expect(verificationHooks.plan?.finalizeNudge).toBeUndefined();
  });

  it('error stays on the default (no override published)', () => {
    expect(errorHooks.plan?.finalizeNudge).toBeUndefined();
  });

  it('doc / design-system stay on the default (no override published)', () => {
    expect(docHooks.plan?.finalizeNudge).toBeUndefined();
    expect(designSystemHooks.plan?.finalizeNudge).toBeUndefined();
  });
});

describe('planGeneration.ts — dispatch shape (R1 invariant)', () => {
  // The dispatch must remain a single-line `??` chain to guarantee R1
  // (phase blind to task.type). Inline branches like `if (isXTask(task))`
  // around the nudge selection are exactly what `a71234c2` retired.
  it('dispatches the nudge through the hook registry', async () => {
    const source = await fs.readFile(PLAN_GEN_PATH, 'utf8');
    expect(source).toMatch(/\.plan\?\.finalizeNudge\?\.\(/);
    expect(source).toMatch(/\?\?\s*FINALIZE_NUDGE/);
  });

  it('contains no inline task-type branches around the finalize nudge', async () => {
    const source = await fs.readFile(PLAN_GEN_PATH, 'utf8');
    // Locate the finalizeNudge dispatch line and inspect the surrounding
    // window for any predicate / equality branches that would re-introduce
    // the R1 violation `a71234c2` removed. Strip line comments first so
    // legitimate "do NOT do this" reminders inside `// …` lines don't
    // false-match — only executable code is being audited.
    const idx = source.indexOf('finalizeNudge?.(');
    expect(idx).toBeGreaterThan(0);
    const rawWindow = source.slice(Math.max(0, idx - 400), idx + 200);
    const codeOnly = rawWindow
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n');
    expect(codeOnly).not.toMatch(/isVerificationTask\(|isErrorTask\(|isTestCodeTask\(/);
    expect(codeOnly).not.toMatch(/task\.type\s*===/);
  });
});
