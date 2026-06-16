import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Guards the Design Document Authority model in `system-design-guide.md`.
 *
 * Background (warm-inherited-meerkat RCA): the guide previously taught a LINEAR
 * layer hierarchy (api-contract = Layer 0 immutable > system-design = Layer 1
 * guide; "Layer 0 wins on conflict"). That collapse made the code job treat a
 * system-design port-boundary decision (e.g. a dedicated OAuth/identity port,
 * separate from the data-API port) as an overridable Layer-1 "preference", and
 * fold identity endpoints onto the general backend-API port because the
 * api-contract listed them beside data endpoints — producing a duplicated,
 * dead-code port. The fix splits the single ladder into TWO ORTHOGONAL
 * authorities: api-contract owns wire shape; system-design owns the port
 * partition. This test locks that split and both injection sites.
 */

const TEMPLATES = join(__dirname, '../../src/core/prompt/templates');
const GUIDE = join(TEMPLATES, 'jobs/code/base/injections/system-design-guide.md');
const PLAN_BASE = join(TEMPLATES, 'jobs/code/nodes/plan/base.md');
const DECOMPOSE_RULES = join(TEMPLATES, 'jobs/code/nodes/decompose/variants/default/rules.md');
const DECOMPOSE_INDEX = join(
  __dirname,
  '../../src/agents/architect/graph/code/nodes/decompose/index.ts',
);

const read = (p: string) => readFileSync(p, 'utf8');

describe('Design Document Authority — two orthogonal axes', () => {
  const guide = read(GUIDE);

  it('declares the two questions as independent authorities (not a linear ladder)', () => {
    expect(guide).toMatch(/orthogonal/i);
    expect(guide).toMatch(/Neither outranks the other/i);
    // Axis 1 — api-contract owns wire shape, immutable.
    expect(guide).toMatch(/api-contract/i);
    expect(guide).toMatch(/immutable/i);
    // Axis 2 — system-design owns the code partition / port boundary.
    expect(guide).toMatch(/system-design/i);
    expect(guide).toMatch(/port/i);
    expect(guide).toMatch(/partition/i);
  });

  it('locks the boundary-axis constraints that kill the duplicate-port bug', () => {
    // contract grouping is NOT a port partition
    expect(guide).toMatch(/section ?\/ ?resource grouping is documentation organization/i);
    // a system-design-named port stays singly owned
    expect(guide).toMatch(/stays its own port/i);
    expect(guide).toMatch(/exactly one port/i);
    // identity-vs-data blind spot
    expect(guide).toMatch(/identity/i);
    expect(guide).toMatch(/blind spot/i);
  });

  it('does NOT reintroduce the linear-hierarchy supremacy wording', () => {
    expect(guide).not.toMatch(/Layer 0 wins/i);
    expect(guide).not.toMatch(/Higher layer = higher authority/i);
    expect(guide).not.toMatch(/LAYER 0: SOURCE OF TRUTH/i);
    // No "system-design cannot override api-contract" blanket statement —
    // it may only lose on the WIRE axis, never on the boundary axis.
    expect(guide).not.toMatch(/Cannot override or omit Layer 0/i);
  });

  it('is FPOP-clean: no concrete value/endpoint examples', () => {
    expect(guide).not.toMatch(/userId|user_id/);
    expect(guide).not.toMatch(/POST \/rooms/i);
  });

  it('is injected at BOTH plan and decompose, gated on hasSystemDesign', () => {
    const planBase = read(PLAN_BASE);
    const decomposeRules = read(DECOMPOSE_RULES);
    const INCLUDE = '{{> jobs/code/base/injections/system-design-guide}}';

    expect(planBase).toContain(INCLUDE);
    expect(planBase).toMatch(/\{\{#if hasSystemDesign\}\}/);

    expect(decomposeRules).toContain(INCLUDE);
    expect(decomposeRules).toMatch(/\{\{#if hasSystemDesign\}\}/);
  });

  it('decompose supplies the hasSystemDesign gate variable', () => {
    const index = read(DECOMPOSE_INDEX);
    expect(index).toMatch(/hasSystemDesign:\s*pool\.hasSystemDesign\(\)/);
  });
});
