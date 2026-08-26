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

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { FilePromptAdapter, initPartials } from '../../src/periphery/adapters/prompt/FilePromptAdapter';

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

// ─────────────────────────────────────────────────────────────
// runTests gate truth table (navy-dropping-crowd residual of the
// static-html tier): a toolchain-free verification must not receive
// the type-check/build/test gate list, install/cache/build-discovery
// blocks, or an inverted Step numbering.
// ─────────────────────────────────────────────────────────────

describe('verification prompt — runTests gate truth table', () => {
  const TEMPLATES_DIR = join(__dirname, '../../src/core/prompt/templates');
  const BASE = 'jobs/code/nodes/plan/variants/verification/base';
  let adapter: FilePromptAdapter;

  beforeAll(async () => {
    adapter = new FilePromptAdapter(TEMPLATES_DIR);
    await initPartials(TEMPLATES_DIR);
  });

  const render = (vars: Record<string, unknown>) =>
    adapter.render(BASE, {
      taskId: 't-1',
      taskName: 'verify',
      taskDescription: 'verify the project',
      directive: '',
      userLanguage: 'en',
      hasTools: true,
      ...vars,
    });

  it('runTests=true renders the toolchain gate set', async () => {
    const out = await render({ runTests: true });
    expect(out).toMatch(/every required gate \(type-check, build, test\)/);
    expect(out).toMatch(/Install Decision Principle/);
    expect(out).toMatch(/Cache Replay Detection/);
    expect(out).toMatch(/Build Command Discovery/);
    expect(out).toMatch(/### Step 2: Run Tests/);
    expect(out).not.toMatch(/run_command` serves observation only/);
  });

  it('runTests=false suppresses every toolchain-gate block and swaps in the static gate-ordering', async () => {
    const out = await render({ runTests: false });
    expect(out).not.toMatch(/every required gate \(type-check, build, test\)/);
    expect(out).not.toMatch(/Install Decision Principle/);
    expect(out).not.toMatch(/Cache Replay Detection/);
    expect(out).not.toMatch(/Build Command Discovery/);
    expect(out).not.toMatch(/### Step 2: Run Tests/);
    expect(out).not.toMatch(/PRIMARY use of `run_command` is to execute build and test commands/);
    expect(out).toMatch(/static gates defined by the language-specific hints/);
    expect(out).toMatch(/run_command` serves observation only/);
  });

  it('Diagnostic Efficiency (batched reads, plan-as-soon-as) renders in BOTH modes', async () => {
    for (const runTests of [true, false]) {
      const out = await render({ runTests });
      expect(out).toMatch(/Diagnostic Efficiency/);
      expect(out).toMatch(/issue ALL reads in ONE response/);
    }
  });

  it('step numbering: runTests=false + acceptance source → AC is Step 2, Analyze is Step 3 (no inverted 2.5-before-2)', async () => {
    const out = await render({ runTests: false, hasAcceptanceSource: true, acceptanceSource: 'AC-DOC' });
    expect(out).toMatch(/### Step 2: Check Acceptance Criteria/);
    expect(out).toMatch(/### Step 3: Analyze Errors/);
    expect(out).toMatch(/### Step 4: Produce Remediation Plan/);
    expect(out).not.toMatch(/Step 2\.5/);
    expect(out).toMatch(/alongside the static gates/);
  });

  it('step numbering: runTests=true + acceptance source keeps the 2 / 2.5 / 3 / 4 ladder', async () => {
    const out = await render({ runTests: true, hasAcceptanceSource: true, acceptanceSource: 'AC-DOC' });
    expect(out).toMatch(/### Step 2: Run Tests/);
    expect(out).toMatch(/### Step 2\.5: Check Acceptance Criteria/);
    expect(out).toMatch(/### Step 3: Analyze Errors/);
    expect(out).toMatch(/### Step 4: Produce Remediation Plan/);
    expect(out).toMatch(/alongside build\/typecheck\/test/);
  });

  it('step numbering: no acceptance source → Analyze/Produce collapse to 2/3 (runTests=false) and 3/4 (runTests=true)', async () => {
    const nofToolchain = await render({ runTests: false, hasAcceptanceSource: false });
    expect(nofToolchain).toMatch(/### Step 2: Analyze Errors/);
    expect(nofToolchain).toMatch(/### Step 3: Produce Remediation Plan/);
    const toolchain = await render({ runTests: true, hasAcceptanceSource: false });
    expect(toolchain).toMatch(/### Step 3: Analyze Errors/);
    expect(toolchain).toMatch(/### Step 4: Produce Remediation Plan/);
  });
});
