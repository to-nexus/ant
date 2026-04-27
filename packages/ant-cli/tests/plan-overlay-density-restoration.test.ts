/**
 * Plan Overlay Density Restoration — Invariant Test (Phase 0 / A / C / E).
 *
 * Pins the contract that:
 *
 *   1. The four shared partials under `jobs/plan/shared/` exist and are
 *      authored as framework guidance (not domain-specific content).
 *   2. Both domain overlays (`jobs/plan/domain/{service,game}.md`)
 *      compose those shared partials via `{{> jobs/plan/shared/...}}`
 *      includes — so adding a shared rule reaches both domains without
 *      colocation.
 *   3. The service overlay carries the Required-core / Conditional /
 *      Always-on partition that closed the "shallow PRD" gap, plus the
 *      stable identifier prefixes (`SC-`, `FL-`, `FR-`, `CP-`, `EN-`,
 *      `RB-`) that downstream design jobs cite.
 *   4. The game overlay carries the matching partition + game-specific
 *      stable prefixes (`CL-`, `MC-`, `EN-`, `LV-`, `RW-`, `GM-`,
 *      `MP-`).
 *   5. The plan rules (`jobs/plan/nodes/plan/variants/default/rules.md`)
 *      explicitly forbid the periphery chapters that were inflating PRDs
 *      (test scenarios / operational runbooks / threat models / etc.).
 *   6. The matrix-level domain split (`gen-plan` outputs both prd.md
 *      and gdd.md as candidates; `excludeFiles` hides both from
 *      sources/* listings; `getPlanOutputs` collapses to the single
 *      domain-canonical filename).
 *
 * The shape of these checks is intentionally text-presence — the prompts
 * themselves are the contract, not their generated output. Renaming a
 * heading is fine; deleting the section's vocabulary is the regression
 * this test catches.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  getPlanOutputs,
  getCanonicalPlanFilename,
  getCanonicalPlanPath,
  pickExistingPlanFilename,
  PLAN_OUTPUT_FILENAMES,
  getDefaultTargetPaths,
  getConfigSlots,
} from '@ant/shared';

const TEMPLATES_ROOT = path.resolve(
  __dirname,
  '../src/core/prompt/templates',
);

const SHARED_DIR = path.join(TEMPLATES_ROOT, 'jobs/plan/shared');
const SERVICE_FILE = path.join(TEMPLATES_ROOT, 'jobs/plan/domain/service.md');
const GAME_FILE = path.join(TEMPLATES_ROOT, 'jobs/plan/domain/game.md');
const RULES_FILE = path.join(
  TEMPLATES_ROOT,
  'jobs/plan/nodes/plan/variants/default/rules.md',
);

function read(p: string): string {
  return fs.readFileSync(p, 'utf-8');
}

// ──────────────────────────────────────────────────────────────────────
// 1) Shared partials — file presence + framework wording
// ──────────────────────────────────────────────────────────────────────

const SHARED_PARTIALS = [
  'identifier-convention.md',
  'design-handoff-table.md',
  'pipeline-input-sufficiency.md',
  'external-asset-citation.md',
] as const;

describe('Plan-overlay shared partials (Phase 0)', () => {
  for (const filename of SHARED_PARTIALS) {
    it(`${filename} exists under jobs/plan/shared/`, () => {
      const p = path.join(SHARED_DIR, filename);
      expect(
        fs.existsSync(p),
        `Phase 0 shared partial missing: ${p}`,
      ).toBe(true);
    });
  }

  it('identifier-convention partial frames the cross-document anchor rule', () => {
    const src = read(path.join(SHARED_DIR, 'identifier-convention.md'));
    expect(src).toMatch(/Stable identifier convention/i);
    expect(src).toMatch(/cross-document anchor/i);
    // The partial should describe the rule generically (mentioning that
    // each domain overlay owns its prefix family) rather than embedding
    // an exhaustive prefix list. A small number of illustrative
    // examples is fine — but we want the canonical hand-off table to
    // live in each domain overlay, NOT here. Sanity check: the partial
    // does not contain a full hand-off matrix table.
    expect(
      src,
      'identifier-convention.md should NOT contain the design-handoff table — that lives in design-handoff-table.md and per-domain overlays.',
    ).not.toMatch(/System Design picks up|Game-System Design picks up/);
  });

  it('design-handoff-table partial frames the hand-off table rule', () => {
    const src = read(path.join(SHARED_DIR, 'design-handoff-table.md'));
    expect(src).toMatch(/Design hand-off mapping/i);
    expect(src).toMatch(/Content\/UX Level/i);
  });

  it('pipeline-input-sufficiency partial frames the self-check protocol', () => {
    const src = read(path.join(SHARED_DIR, 'pipeline-input-sufficiency.md'));
    expect(src).toMatch(/Pipeline input sufficiency/i);
    expect(src).toMatch(/yes\/no question/i);
  });

  it('external-asset-citation partial frames the asset citation pattern', () => {
    const src = read(path.join(SHARED_DIR, 'external-asset-citation.md'));
    expect(src).toMatch(/External design asset citation/i);
    expect(src).toMatch(/figma|concept art|reference/i);
  });
});

// ──────────────────────────────────────────────────────────────────────
// 2) Domain overlays compose the shared partials
// ──────────────────────────────────────────────────────────────────────

describe('Domain overlays compose shared partials (Phase A / C)', () => {
  for (const filename of SHARED_PARTIALS) {
    const partialName = filename.replace(/\.md$/, '');
    it(`service.md includes jobs/plan/shared/${partialName}`, () => {
      const src = read(SERVICE_FILE);
      expect(src).toMatch(
        new RegExp(`\\{\\{>\\s*jobs/plan/shared/${partialName}\\b`),
      );
    });

    it(`game.md includes jobs/plan/shared/${partialName}`, () => {
      const src = read(GAME_FILE);
      expect(src).toMatch(
        new RegExp(`\\{\\{>\\s*jobs/plan/shared/${partialName}\\b`),
      );
    });
  }
});

// ──────────────────────────────────────────────────────────────────────
// 3) Service overlay — Required core / Conditional / Always-on partition
// ──────────────────────────────────────────────────────────────────────

describe('Service plan overlay — required-core / conditional / always-on', () => {
  let src: string;
  beforeAll(() => {
    src = read(SERVICE_FILE);
  });

  it('classifies sections as Required core, Conditional, and Always-on', () => {
    expect(src).toMatch(/Required core/);
    expect(src).toMatch(/Conditional/);
    expect(src).toMatch(/Always-on/);
  });

  it('lists the four content-planning chapters that closed the shallow-PRD gap', () => {
    expect(src).toMatch(/Information Architecture/);
    expect(src).toMatch(/Screen Composition & States/);
    expect(src).toMatch(/Content & Domain Policy/);
    expect(src).toMatch(/User Scenarios & Core Flows/);
  });

  it('exposes the full identifier prefix family for downstream design citation', () => {
    expect(src).toMatch(/`SC-`/);
    expect(src).toMatch(/`FL-`/);
    expect(src).toMatch(/`FR-`/);
    expect(src).toMatch(/`CP-`/);
    expect(src).toMatch(/`EN-`/);
    expect(src).toMatch(/`RB-`/);
  });

  it('publishes the System Design / UI Design hand-off columns', () => {
    expect(src).toMatch(/System Design picks up/);
    expect(src).toMatch(/UI Design picks up/);
  });

  it('forbids periphery chapters from being added without explicit directive', () => {
    expect(src).toMatch(/forbidden|FORBIDDEN/);
    expect(src).toMatch(/test scenarios|QA/i);
    expect(src).toMatch(/operational|deployment/i);
    expect(src).toMatch(/security threat/i);
  });
});

// Vitest setup helper — pulled from the global vitest module so the
// test file does not pollute the top-level `it`/`expect` namespace.
import { beforeAll } from 'vitest';

// ──────────────────────────────────────────────────────────────────────
// 4) Game overlay — partition + game-specific identifiers
// ──────────────────────────────────────────────────────────────────────

describe('Game plan overlay — required-core / conditional / optional partition', () => {
  let src: string;
  beforeAll(() => {
    src = read(GAME_FILE);
  });

  it('classifies sections as Required core / Conditional / Optional', () => {
    expect(src).toMatch(/Required core/);
    expect(src).toMatch(/Conditional/);
    expect(src).toMatch(/Optional sections/);
  });

  it('lists the seven game-specific stable identifier prefixes', () => {
    expect(src).toMatch(/`CL-`/);
    expect(src).toMatch(/`MC-`/);
    expect(src).toMatch(/`EN-`/);
    expect(src).toMatch(/`LV-`/);
    expect(src).toMatch(/`RW-`/);
    expect(src).toMatch(/`GM-`/);
    expect(src).toMatch(/`MP-`/);
  });

  it('publishes the Game-System / Game-Art / Game-Content hand-off columns', () => {
    expect(src).toMatch(/Game-System Design picks up/);
    expect(src).toMatch(/Game-Art Design picks up/);
    expect(src).toMatch(/Game-Content/);
  });

  it('preserves the Optional sections (Narrative / Economy / Multiplayer / Accessibility)', () => {
    expect(src).toMatch(/Narrative & World-building/);
    expect(src).toMatch(/Economy/);
    expect(src).toMatch(/Multiplayer Pacing/);
    expect(src).toMatch(/Accessibility Modes/);
  });
});

// ──────────────────────────────────────────────────────────────────────
// 5) Plan rules.md — periphery chapters explicitly forbidden
// ──────────────────────────────────────────────────────────────────────

describe('Plan rules.md (Phase B) — periphery chapter discipline', () => {
  let src: string;
  beforeAll(() => {
    src = read(RULES_FILE);
  });

  it('removes the 7-chapter "Standard PRD Structure" template', () => {
    expect(src).not.toMatch(/^## Standard PRD Structure\s*$/m);
  });

  it('redefines the slogan: PRD/GDD owns content; design owns implementation', () => {
    // The old "WHAT, not HOW" line is gone or rewritten with the
    // explicit boundary clarification. Either way the file must talk
    // about the content / implementation distinction.
    expect(src).toMatch(/Content/);
    expect(src).toMatch(/implementation/i);
  });

  it('forbids periphery chapters from being added without explicit directive', () => {
    expect(src).toMatch(/test scenarios|QA/i);
    expect(src).toMatch(/operational|deployment/i);
    expect(src).toMatch(/threat model/i);
  });

  it('names the Required core / Conditional / Optional discipline', () => {
    expect(src).toMatch(/Required core/);
    expect(src).toMatch(/Conditional/);
  });
});

// ──────────────────────────────────────────────────────────────────────
// 6) Matrix-level domain split — gen-plan outputs + helpers
// ──────────────────────────────────────────────────────────────────────

describe('gen-plan domain-aware filename split (Phase E)', () => {
  it('PLAN_OUTPUT_FILENAMES contains both prd.md and gdd.md', () => {
    expect(PLAN_OUTPUT_FILENAMES).toContain('prd.md');
    expect(PLAN_OUTPUT_FILENAMES).toContain('gdd.md');
    expect(PLAN_OUTPUT_FILENAMES.length).toBe(2);
  });

  it('getCanonicalPlanFilename routes service → prd.md, game → gdd.md, undefined → prd.md', () => {
    expect(getCanonicalPlanFilename('service')).toBe('prd.md');
    expect(getCanonicalPlanFilename('game')).toBe('gdd.md');
    expect(getCanonicalPlanFilename(undefined)).toBe('prd.md');
  });

  it('getCanonicalPlanPath prefixes inputs/sources/ for either domain', () => {
    expect(getCanonicalPlanPath('service')).toBe('inputs/sources/prd.md');
    expect(getCanonicalPlanPath('game')).toBe('inputs/sources/gdd.md');
  });

  it('getPlanOutputs returns a single domain-canonical OutputSpec', () => {
    const service = getPlanOutputs('service');
    expect(service).toHaveLength(1);
    expect(service[0].prefix).toBe('prd');
    expect(service[0].ext).toBe('.md');

    const game = getPlanOutputs('game');
    expect(game).toHaveLength(1);
    expect(game[0].prefix).toBe('gdd');
    expect(game[0].ext).toBe('.md');
  });

  it('pickExistingPlanFilename prefers domain-canonical, falls back to the other plan filename', () => {
    expect(pickExistingPlanFilename(['gdd.md', 'tech.md'], 'game')).toBe('gdd.md');
    expect(pickExistingPlanFilename(['prd.md', 'tech.md'], 'service')).toBe('prd.md');
    // Cross-domain leftover (legacy game project with prd.md authored
    // before the gdd.md split): the helper still resolves so detect /
    // resolve do not lose track of an existing plan document.
    expect(pickExistingPlanFilename(['prd.md', 'tech.md'], 'game')).toBe('prd.md');
    expect(pickExistingPlanFilename(['gdd.md', 'tech.md'], 'service')).toBe('gdd.md');
    // No plan file at all — undefined.
    expect(pickExistingPlanFilename(['tech.md'], 'service')).toBeUndefined();
    expect(pickExistingPlanFilename(undefined, 'game')).toBeUndefined();
  });

  it('getDefaultTargetPaths(gen-plan, domain) collapses to the single canonical path', () => {
    expect(getDefaultTargetPaths('gen-plan', 'service')).toEqual([
      'inputs/sources/prd.md',
    ]);
    expect(getDefaultTargetPaths('gen-plan', 'game')).toEqual([
      'inputs/sources/gdd.md',
    ]);
    expect(getDefaultTargetPaths('gen-plan', undefined)).toEqual([
      'inputs/sources/prd.md',
    ]);
  });

  it('gen-plan matrix slot lists both candidates AND excludes both from refs listing', () => {
    const slots = getConfigSlots('gen-plan');
    expect(slots).toBeDefined();
    const target = slots!.target;
    expect(target.kind).toBe('generate');
    if (target.kind !== 'generate') return; // type narrowing
    const filenames = target.outputs.map(o => `${o.prefix}${o.ext}`);
    expect(filenames).toContain('prd.md');
    expect(filenames).toContain('gdd.md');

    const refSlot = slots!.refs[0];
    expect(refSlot.excludeFiles).toContain('prd.md');
    expect(refSlot.excludeFiles).toContain('gdd.md');
  });
});
