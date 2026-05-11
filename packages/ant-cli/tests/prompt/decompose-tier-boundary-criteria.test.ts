/**
 * Tier boundary criteria regression guard.
 *
 * Locks the observable-property language that the decompose default variant
 * uses to teach the LLM how to classify Tier 1 / 2 / 3:
 * - Tier 1 vs 2 boundary = "scope of effect" (module graph / type surface
 *   / module-init order). FPOP "what over how" — replaces the legacy
 *   subjective "could plausibly break typecheck" phrasing.
 * - Tier 2 vs 3 boundary = "investigation surface" count. Uses the same
 *   noun as tier-deep-think.md (single SSOT for "surface") so the three
 *   files speak with one vocabulary.
 * - symptom-only directives have an explicit blind-spot block — stack
 *   trace spanning ≥ 2 layers and multi-origin root cause concepts route
 *   to Tier 3.
 * - error-or-general.md carries the Error → Tier mapping bridge with the
 *   same "surface count" framing.
 *
 * Anti-pattern guards:
 * - No "persistence surface" alias (the legacy term that was considered
 *   and rejected). One noun, one meaning.
 * - No "could plausibly break typecheck" residue from the pre-rewrite
 *   wording.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { readFileSync } from 'node:fs';

const TEMPLATES_DIR = join(__dirname, '../../src/core/prompt/templates');
const RULES_PATH = join(
  TEMPLATES_DIR,
  'jobs/code/nodes/decompose/variants/default/rules.md',
);
const TIER_DEEP_THINK_PATH = join(
  TEMPLATES_DIR,
  'jobs/code/nodes/decompose/variants/default/tier-deep-think.md',
);
const ERROR_OR_GENERAL_PATH = join(
  TEMPLATES_DIR,
  'jobs/code/nodes/decompose/variants/default/error-or-general.md',
);

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('decompose tier boundary criteria', () => {
  describe('rules.md — classification table', () => {
    const body = read(RULES_PATH);

    it('Tier 1 row uses cross-cutting effects vocabulary (FPOP — observable)', () => {
      expect(body).toMatch(/exported symbol's type \/ signature/);
      expect(body).toMatch(/module-load order/);
      expect(body).toMatch(/module dependency graph/);
    });

    it('Tier 2 row introduces the "investigation surface" noun', () => {
      expect(body).toMatch(/investigation surface/);
    });

    it('Tier 3 row names surface count (≥ 2) as the boundary', () => {
      expect(body).toMatch(/clearly distinct components/);
      expect(body).toMatch(/≥ 2 surfaces/);
    });

    it('Tier 1 vs 2 boundary statement is observable, not subjective', () => {
      expect(body).toMatch(/Tier 1 vs Tier 2 boundary[\s\S]*scope of effect/);
      expect(body).toMatch(/module graph[\s\S]*type surface[\s\S]*module-init order/);
    });

    it('Tier 2 vs 3 boundary names surface count explicitly', () => {
      expect(body).toMatch(/single unit of work["']? is observable by surface count/);
      expect(body).toMatch(/1 surface → Tier 2.*≥ 2 surfaces → Tier 3/);
    });

    it('symptom-only blind spot covers stack-trace and multi-origin signals', () => {
      expect(body).toMatch(/Blind spot — symptom-only directives/);
      expect(body).toMatch(/Stack trace spanning ≥ 2 layers/);
      expect(body).toMatch(/Root cause concept.*≥ 2 places/);
    });
  });

  describe('tier-deep-think.md — Tier 2 self-check', () => {
    const body = read(TIER_DEEP_THINK_PATH);

    it('self-check asks for single-component test', () => {
      expect(body).toMatch(/Can I name a single component/);
      expect(body).toMatch(/≥ 2 components/);
    });

    it('escalate target is documented (Tier 3 with [error|feature × 1 + verification × 1])', () => {
      expect(body).toContain('[error × 1 + verification × 1]');
      expect(body).toContain('[feature × 1 + verification × 1]');
    });
  });

  describe('error-or-general.md — Error → Tier mapping bridge', () => {
    const body = read(ERROR_OR_GENERAL_PATH);

    it('lists Tier 1 / 2 / 3 mapping with surface count framing', () => {
      expect(body).toMatch(/Error directive → Tier mapping \(by surface count\)/);
      expect(body).toMatch(/\*\*Tier 1\*\*:.*single file \+ line/);
      expect(body).toMatch(/\*\*Tier 2\*\*:.*single component/);
      expect(body).toMatch(/\*\*Tier 3\*\*:.*≥ 2 layers/);
    });

    it('warns against defaulting in either direction', () => {
      expect(body).toMatch(/Do NOT default to Tier 3 because the input contains a stack trace/);
      expect(body).toMatch(/Do NOT default to Tier 2 because/);
    });
  });

  describe('parchment guards — no fragmentation, no legacy residue', () => {
    const rules = read(RULES_PATH);
    const deepThink = read(TIER_DEEP_THINK_PATH);
    const errorGen = read(ERROR_OR_GENERAL_PATH);

    it('no "persistence surface" alias anywhere in the default variant', () => {
      expect(rules).not.toMatch(/persistence surface/);
      expect(deepThink).not.toMatch(/persistence surface/);
      expect(errorGen).not.toMatch(/persistence surface/);
    });

    it('no legacy "could plausibly break typecheck" residue in the boundary statements', () => {
      // The phrase "could plausibly break typecheck / build / test" was the
      // pre-rewrite Tier 1 vs 2 boundary. Replaced by the observable
      // "scope of effect" test.
      expect(rules).not.toMatch(/could plausibly break typecheck \/ build \/ test/);
    });
  });
});
