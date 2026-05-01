/**
 * Design-Overlay PRD/GDD Citation — Invariant Test (Phase D).
 *
 * The plan job authors PRD/GDD as the SSOT for product surface (IA /
 * screen composition / content policy / mechanic catalog / entity
 * catalog / etc.). Design jobs MUST cite PRD/GDD sections by stable
 * identifier when a task elaborates that section, so MECE between plan
 * and design is enforced and downstream code consumers see a single
 * authoritative source.
 *
 * This test pins the "design overlay citation" wording into the
 * relevant prompt files. Wording can evolve; the canonical phrase
 * `PRD §X` / `GDD §X` and the symbolic ID prefixes (SC-, FL-, FR-, CP-,
 * EN-, RB-, MC-, RW-, ...) MUST be present so the LLM has a concrete
 * pattern to imitate.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const TEMPLATES_ROOT = path.resolve(
  __dirname,
  '../../src/core/prompt/templates',
);

function read(rel: string): string {
  return fs.readFileSync(path.join(TEMPLATES_ROOT, rel), 'utf-8');
}

// ──────────────────────────────────────────────────────────────────────
// Service-axis citations (design job consumes PRD)
// ──────────────────────────────────────────────────────────────────────

describe('Design overlay — service-axis PRD citation guidance', () => {
  it('jobs/design/domain/service.md publishes the PRD ↔ design hand-off table', () => {
    const src = read('jobs/design/domain/service.md');
    expect(src).toMatch(/PRD ↔ Design Responsibility Split/);
    expect(src).toMatch(/PRD §\d+/);
    expect(src).toMatch(/SC-/);
    expect(src).toMatch(/cite PRD/i);
  });

  it('system-design/base.md asks Step 1 Complexity Questions in PRD/GDD §X form', () => {
    const src = read('jobs/design/nodes/decompose/variants/system-design/base.md');
    expect(src).toMatch(/PRD §10|PRD §5|PRD §11|PRD §3/);
    expect(src).toMatch(/GDD §/);
    expect(src).toMatch(/Source missing: PRD/);
  });

  it('system-design/base.md adds the Content/UX Level column to Abstraction Level', () => {
    const src = read('jobs/design/nodes/decompose/variants/system-design/base.md');
    expect(src).toMatch(/Content \/ UX Level|Content\s*\/\s*UX Level/);
    expect(src).toMatch(/owned by PRD\/GDD|PRD\/GDD owns/);
  });

  it('system-design/base.md requires task descriptions to cite the PRD/GDD hook', () => {
    const src = read('jobs/design/nodes/decompose/variants/system-design/base.md');
    expect(src).toMatch(/PRD\/GDD hand-off citation/i);
    expect(src).toMatch(/Architectural — no direct PRD\/GDD hand-off/);
  });

  it('system-design/rules.md validates the PRD/GDD citation in task descriptions', () => {
    const src = read('jobs/design/nodes/decompose/variants/system-design/rules.md');
    expect(src).toMatch(/PRD\/GDD/);
    expect(src).toMatch(/Architectural — no direct PRD\/GDD hand-off/);
  });

  it('ui-design-by-desc/base.md derives page chapters from PRD §5 SC-XXX', () => {
    const src = read('jobs/design/nodes/decompose/variants/ui-design-by-desc/base.md');
    // Wording allows §5 in long form ("Information Architecture (§5)")
    // or short form ("PRD §5 IA"); both must reference §5 explicitly.
    expect(src).toMatch(/§5/);
    expect(src).toMatch(/SC-XXX/);
    expect(src).toMatch(/ui-spec-SC-/);
  });

  it('ui-design-by-desc/base.md grounds Component Ownership in PRD §6 + §7', () => {
    const src = read('jobs/design/nodes/decompose/variants/ui-design-by-desc/base.md');
    expect(src).toMatch(/Component Ownership Contract/);
    expect(src).toMatch(/PRD §6/);
    expect(src).toMatch(/PRD §7/);
  });

  it('ui-design-by-desc/rules.md validates PRD §6 / SC- citation per page chapter', () => {
    const src = read('jobs/design/nodes/decompose/variants/ui-design-by-desc/rules.md');
    expect(src).toMatch(/PRD §6 \/ SC-/);
    expect(src).toMatch(/PRD lacks SC- IDs/);
  });

  it('ui-design-by-figma/base.md aligns SC-XXX with Figma node-ids', () => {
    const src = read('jobs/design/nodes/decompose/variants/ui-design-by-figma/base.md');
    expect(src).toMatch(/PRD §5 IA/);
    expect(src).toMatch(/SC-XXX/);
    expect(src).toMatch(/Figma frames? \/ nodeIds?|Figma frames \/ nodeIds/i);
  });

  it('ui-design-by-figma/rules.md validates SC ↔ Figma alignment in page chapter descriptions', () => {
    const src = read('jobs/design/nodes/decompose/variants/ui-design-by-figma/rules.md');
    expect(src).toMatch(/PRD Hand-off Citation/);
    expect(src).toMatch(/SC ↔ Figma Alignment/);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Game-axis citations (design job consumes GDD)
// ──────────────────────────────────────────────────────────────────────

describe('Design overlay — game-axis GDD citation guidance', () => {
  it('jobs/design/domain/game.md publishes the GDD ↔ design hand-off table', () => {
    const src = read('jobs/design/domain/game.md');
    expect(src).toMatch(/GDD ↔ Design Responsibility Split/);
    expect(src).toMatch(/GDD §/);
    expect(src).toMatch(/MC-|EN-|CL-|LV-|RW-|GM-|MP-/);
    expect(src).toMatch(/cite GDD/i);
  });

  it('game-art-design-by-desc/base.md derives token derivation from GDD §4 Aesthetic / §6', () => {
    const src = read('jobs/design/nodes/decompose/variants/game-art-design-by-desc/base.md');
    expect(src).toMatch(/GDD §4 MDA Aesthetic/);
    expect(src).toMatch(/GDD §6 Reward & Feedback/);
    expect(src).toMatch(/GDD §8 Content Scope/);
  });

  it('game-art-design-by-desc/base.md derives asset categories from GDD §8 EN-/LV-', () => {
    const src = read('jobs/design/nodes/decompose/variants/game-art-design-by-desc/base.md');
    expect(src).toMatch(/EN-XXX/);
    expect(src).toMatch(/LV-XXX/);
    expect(src).toMatch(/game-art-assets-entities-hero|game-art-assets-/);
  });

  it('game-art-design-by-desc/base.md derives spec categories from GDD §4 MC- / §6 RW-', () => {
    const src = read('jobs/design/nodes/decompose/variants/game-art-design-by-desc/base.md');
    expect(src).toMatch(/MC-XXX|GDD §4 \/ MC-/);
    expect(src).toMatch(/RW-XXX|GDD §6 \/ RW-/);
  });

  it('game-art-design-by-desc/rules.md validates GDD §X citation per task', () => {
    const src = read('jobs/design/nodes/decompose/variants/game-art-design-by-desc/rules.md');
    expect(src).toMatch(/GDD Hand-off Citation/);
    expect(src).toMatch(/GDD §8|EN-/);
    expect(src).toMatch(/GDD §4|MC-/);
    expect(src).toMatch(/GDD absent — categories extracted from directive/);
  });

  it('game-art-design-by-figma/base.md aligns EN-XXX with Figma frames', () => {
    const src = read('jobs/design/nodes/decompose/variants/game-art-design-by-figma/base.md');
    expect(src).toMatch(/GDD §8 Content Scope/);
    expect(src).toMatch(/EN-XXX/);
    expect(src).toMatch(/figma node cited by GDD|frame name match/i);
  });

  it('game-art-design-by-figma/rules.md validates EN ↔ Figma alignment', () => {
    const src = read('jobs/design/nodes/decompose/variants/game-art-design-by-figma/rules.md');
    expect(src).toMatch(/GDD Hand-off Citation/);
    expect(src).toMatch(/EN ↔ Figma Alignment/);
  });
});

// ──────────────────────────────────────────────────────────────────────
// PRD/GDD ↔ Figma conflict policy (F2 follow-up)
//
// Pins the role-aware conflict matrix. Both figma decompose templates
// MUST cite the shared policy partial, the partial itself MUST publish
// the visual / behavior / ambiguous axes plus the role-asymmetric rule,
// and the plan-side external-asset-citation partial MUST cross-link
// downstream so plan and design have a single SSOT for resolving
// PRD/GDD-vs-Figma disagreements.
// ──────────────────────────────────────────────────────────────────────

describe('Asset conflict policy — partial + cross-links (F2)', () => {
  const POLICY_PARTIAL = 'jobs/design/shared/asset-conflict-policy.md';

  it('asset-conflict-policy partial publishes the visual / behavior / ambiguous axis matrix', () => {
    const src = read(POLICY_PARTIAL);
    expect(src).toMatch(/Figma wins for visual/);
    expect(src).toMatch(/PRD\/GDD wins for behavior/);
    expect(src).toMatch(/Ambiguous|cite-first/);
    expect(src).toMatch(/§Open Questions/);
  });

  it('asset-conflict-policy partial covers the role-asymmetric case (ref vs context)', () => {
    const src = read(POLICY_PARTIAL);
    // The role-aware matrix MUST tell the LLM that an explicit
    // user demotion (ref vs context) overrides the axis split.
    expect(src).toMatch(/role="ref"/);
    expect(src).toMatch(/role="context"/);
    expect(src).toMatch(/asymmetric|Asymmetric/i);
    // Ref must be authoritative over context regardless of axis.
    expect(src).toMatch(/(ref|`role="ref"`).*authoritative/i);
  });

  it('asset-conflict-policy partial provides refine-mode stale-source detection', () => {
    const src = read(POLICY_PARTIAL);
    expect(src).toMatch(/refine[- ]mode|rev-(?:ui|game-art)/i);
    expect(src).toMatch(/stale/i);
    expect(src).toMatch(/timestamp|commit|last_modified/i);
  });

  it('ui-design-by-figma/base.md cites the shared asset-conflict-policy partial', () => {
    const src = read('jobs/design/nodes/decompose/variants/ui-design-by-figma/base.md');
    expect(src).toMatch(
      /\{\{>\s*jobs\/design\/shared\/asset-conflict-policy/,
    );
  });

  it('game-art-design-by-figma/base.md cites the shared asset-conflict-policy partial', () => {
    const src = read('jobs/design/nodes/decompose/variants/game-art-design-by-figma/base.md');
    expect(src).toMatch(
      /\{\{>\s*jobs\/design\/shared\/asset-conflict-policy/,
    );
  });

  it('plan/shared/external-asset-citation.md cross-links the design conflict policy', () => {
    const src = read('jobs/plan/shared/external-asset-citation.md');
    expect(src).toMatch(/jobs\/design\/shared\/asset-conflict-policy/);
  });
});
