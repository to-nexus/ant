/**
 * Sealed plan = observation ledger — observation authority inherits across
 * the plan→execute phase boundary (sandy-building-dryad RCA).
 *
 * The [VERIFY] discipline ("assertive statements are reserved for facts you
 * actually observed", f7ad2e84) interacted pathologically with the sealed-plan
 * pipeline: plan-phase observations are not in execute's conversation, so the
 * execute model treated every plan citation as unobserved and re-verified the
 * plan's entire citation list with read tools instead of writing — 26-375
 * explore-only turns ending in the no-output breaker. The contradiction is
 * removed by declaring plan-cited facts OBSERVED for the execute phase:
 *
 *   1. sealed-plan-rules narrows confirmation reads to identifiers the plan
 *      does NOT record, forbids re-verifying plan-cited facts, and states the
 *      inheritance principle.
 *   2. The spec base [VERIFY] paragraph carries the plan-gated clause (facts
 *      the sealed plan records count as observed) ONLY when a plan is sealed.
 *   3. RETENTION — the blind-spot warning and the empty-plan fallback branch
 *      survive.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { FilePromptAdapter, initPartials } from '../../src/periphery/adapters/prompt/FilePromptAdapter';

const TEMPLATES_ROOT = path.resolve(__dirname, '../../src/core/prompt/templates');

const RULES_PARTIAL = 'jobs/design/nodes/execute/injections/sealed-plan-rules';
const SPEC_BASE = 'jobs/design/nodes/execute/variants/spec/base';

const PLAN_VARS = {
  planText: '{"task":{"goal":"g"},"documentOutline":[{"section":"Overview","content":"c"}]}',
  verificationAxis: 'exact import paths, function signatures, file conventions',
};

let adapter: FilePromptAdapter;

beforeAll(async () => {
  await initPartials(TEMPLATES_ROOT);
  adapter = new FilePromptAdapter(TEMPLATES_ROOT);
});

// Assertions live on RENDERED output, gated both ways, rather than on the raw
// `.md`. A static text match on the template cannot fail differently from the
// rendered one when the phrase is deleted, but it also cannot catch a broken
// Handlebars gate — so the rendered form is strictly stronger, and the
// sealed/unsealed pair is what makes each phrase falsifiable. (The previous
// `(static)` describe asserted the same strings a second time by reading the
// file directly.)
describe('sealed-plan-rules — observation inheritance gate', () => {
  it('with planText: the inheritance contract renders and the fallback does not', async () => {
    const out = await adapter.render(RULES_PARTIAL, PLAN_VARS);
    // The inheritance principle itself.
    expect(out).toContain('Observation authority inherits across the phase boundary');
    expect(out).toContain('treat plan-cited facts as facts YOU observed');
    expect(out).toMatch(/without re-reading the cited files and without unverified-claim\s*markers/);
    // Confirmation reads are narrowed to what the plan does NOT record, and
    // re-verifying plan-cited facts is forbidden — the two clauses that stop the
    // explore-only loop this file exists for.
    expect(out).toMatch(/the document must reference but the sealed plan does NOT already record/);
    expect(out).toMatch(/Re-verify facts the sealed plan cites with location evidence/);
    // The caller's axis is interpolated, not hardcoded.
    expect(out).toContain('exact import paths, function signatures, file conventions');
    expect(out).not.toContain('Empty Plan Fallback');
  });

  it('without planText: the fallback renders and the inheritance contract does not', async () => {
    const out = await adapter.render(RULES_PARTIAL, {});
    expect(out).toContain('Empty Plan Fallback');
    expect(out).not.toContain('Observation authority inherits');
    expect(out).not.toMatch(/Re-verify facts the sealed plan cites/);
  });

  it('RETENTION — blind-spot warning and search_web note survive in the sealed branch', async () => {
    // All three live INSIDE `{{#if planText}}` (verified against the template),
    // so they are asserted on the sealed render only. A compression pass that
    // drops them would otherwise be invisible: the contract assertions above
    // don't touch them.
    const out = await adapter.render(RULES_PARTIAL, PLAN_VARS);
    expect(out).toContain('Blind spot');
    expect(out).toContain('plan ran with its own budget');
    expect(out).toMatch(/`search_web` is not in your tool set/);
    // And the unsealed branch swaps in the exploration heuristic instead.
    const fallback = await adapter.render(RULES_PARTIAL, {});
    expect(fallback).toContain('Codebase Exploration heuristic');
    expect(fallback).not.toContain('Blind spot');
  });
});

describe('spec base [VERIFY] paragraph — plan-gated observed clause', () => {
  it('with planText: plan-cited facts count as observed', async () => {
    const out = await adapter.render(SPEC_BASE, { ...PLAN_VARS, targetFile: 'x.md', title: 'X' });
    expect(out).toContain('facts the sealed plan records count as observed');
    expect(out).toMatch(/state them assertively without re-reading and without a marker/);
  });

  it('without planText: the clause is absent, base [VERIFY] contract retained', async () => {
    const out = await adapter.render(SPEC_BASE, { targetFile: 'x.md', title: 'X' });
    expect(out).not.toContain('facts the sealed plan records count as observed');
    expect(out).toContain('Unverified-claim marking');
    expect(out).toContain('facts you actually observed');
  });
});
