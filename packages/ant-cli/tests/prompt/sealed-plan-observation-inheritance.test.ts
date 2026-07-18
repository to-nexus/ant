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
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FilePromptAdapter, initPartials } from '../../src/periphery/adapters/prompt/FilePromptAdapter';

const TEMPLATES_ROOT = path.resolve(__dirname, '../../src/core/prompt/templates');
const T = (p: string) => readFileSync(path.resolve(TEMPLATES_ROOT, p), 'utf8');

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

describe('sealed-plan-rules — observation inheritance (static)', () => {
  const rules = T(`${RULES_PARTIAL}.md`);

  it('states the inheritance principle', () => {
    expect(rules).toContain('Observation authority inherits across the phase boundary');
    expect(rules).toContain('treat plan-cited facts as facts YOU observed');
    expect(rules).toMatch(/without re-reading the cited files and without unverified-claim\s*markers/);
  });

  it('narrows Allowed reads to identifiers the plan does NOT record', () => {
    expect(rules).toMatch(/the document must reference but the sealed plan does NOT already record/);
  });

  it('forbids re-verifying plan-cited facts', () => {
    expect(rules).toMatch(/Re-verify facts the sealed plan cites with location evidence/);
  });

  it('RETENTION — blind-spot warning, search_web note, and empty-plan fallback survive', () => {
    expect(rules).toContain('Blind spot');
    expect(rules).toContain('plan ran with its own budget');
    expect(rules).toMatch(/`search_web` is not in your tool set/);
    expect(rules).toContain('Empty Plan Fallback');
  });
});

describe('sealed-plan-rules — render gates', () => {
  it('with planText: inheritance contract renders, fallback does not', async () => {
    const out = await adapter.render(RULES_PARTIAL, PLAN_VARS);
    expect(out).toContain('Observation authority inherits across the phase boundary');
    expect(out).toContain('exact import paths, function signatures, file conventions');
    expect(out).not.toContain('Empty Plan Fallback');
  });

  it('without planText: fallback renders, inheritance contract does not', async () => {
    const out = await adapter.render(RULES_PARTIAL, {});
    expect(out).toContain('Empty Plan Fallback');
    expect(out).not.toContain('Observation authority inherits');
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
