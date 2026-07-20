/**
 * Decision Tag Registry SSOT (Phase 2, I3 — D12-revised)
 *
 * The registry ships 3 tags: `domain`, `gameArtTier`,
 * `serviceVirtualization`. The `gameEngine` slot lives inside the existing
 * `<techTier>` JSON (parsed in `responseParser.ts`) and is NOT a separate
 * registry entry. The other 4 (executionTier / techTier / boundary /
 * directHints) keep their per-callsite parsers — Phase 4 migrates them.
 */

import { describe, it, expect } from 'vitest';
import {
  parseDecisionTags,
  decisionTagRetryFraming,
  applyDecisionTagDefaults,
  DECISION_TAG_REGISTRY,
} from '../../src/core/llm-response/DecisionTagRegistry';

describe('DECISION_TAG_REGISTRY', () => {
  it('registers the decision tags (no <gameEngine> standalone)', () => {
    expect(DECISION_TAG_REGISTRY.map(d => d.name)).toEqual([
      'domain',
      'gameArtTier',
      'serviceVirtualization',
    ]);
  });
});

describe('parseDecisionTags — happy path', () => {
  it('parses domain', () => {
    const r = parseDecisionTags('<domain>game</domain>');
    expect(r.parsed.domain).toBe('game');
    expect(r.violations).toHaveLength(0);
  });

  it('parses gameArtTier (concept + perspective — v8 D32-revised)', () => {
    const r = parseDecisionTags('<gameArtTier>concept=flatVector,perspective=2d</gameArtTier>');
    expect(r.parsed.gameArtTier).toEqual({ concept: 'flatVector', perspective: '2d' });
  });

  it('parses gameArtTier with all 7 axes (Phase 4)', () => {
    const r = parseDecisionTags(
      '<gameArtTier>concept=neonSynth,perspective=2d,entityCatalog=standard,motionPattern=expressive,particleProfile=heavy,projectilePolicy=none,audioProfile=fileBased</gameArtTier>',
    );
    expect(r.parsed.gameArtTier).toEqual({
      concept: 'neonSynth',
      perspective: '2d',
      entityCatalog: 'standard',
      motionPattern: 'expressive',
      particleProfile: 'heavy',
      projectilePolicy: 'none',
      audioProfile: 'fileBased',
    });
  });

  it('parses serviceVirtualization build → { optedOut: false } (§4)', () => {
    const r = parseDecisionTags('<serviceVirtualization>build</serviceVirtualization>');
    expect(r.parsed.serviceVirtualization).toEqual({ optedOut: false });
  });

  it('parses serviceVirtualization opt-out → { optedOut: true } (§4)', () => {
    const r = parseDecisionTags('<serviceVirtualization>opt-out</serviceVirtualization>');
    expect(r.parsed.serviceVirtualization).toEqual({ optedOut: true });
  });

  it('serviceVirtualization invalid body → violation, no value', () => {
    const r = parseDecisionTags('<serviceVirtualization>maybe</serviceVirtualization>');
    expect(r.parsed.serviceVirtualization).toBeUndefined();
    expect(r.violations.some(v => v.tag === 'serviceVirtualization')).toBe(true);
  });

  it('applyDecisionTagDefaults fills serviceVirtualization → build when missing', () => {
    const r = parseDecisionTags('');
    const filled = applyDecisionTagDefaults(r.parsed, ['serviceVirtualization']);
    expect(filled.serviceVirtualization).toEqual({ optedOut: false });
  });

  it('parses domain + gameArtTier together', () => {
    const raw = `
      <domain>game</domain>
      <gameArtTier>concept=darkGothic,perspective=2d</gameArtTier>
    `;
    const r = parseDecisionTags(raw);
    expect(r.violations).toHaveLength(0);
    // serviceVirtualization is naturally absent from a game-domain decompose
    // (SV is service-only) — it is the one registered tag not emitted here.
    expect(r.missing).toEqual(['serviceVirtualization']);
    expect(r.parsed.domain).toBe('game');
    expect(r.parsed.gameArtTier).toEqual({ concept: 'darkGothic', perspective: '2d' });
  });

  it('IGNORES standalone <gameEngine> tag (lives inside <techTier>)', () => {
    const r = parseDecisionTags('<gameEngine>phaser</gameEngine>');
    expect((r.parsed as Record<string, unknown>).gameEngine).toBeUndefined();
    expect(r.violations.find(v => v.tag === ('gameEngine' as never))).toBeUndefined();
  });
});

describe('parseDecisionTags — invalid bodies', () => {
  it('records a violation for invalid domain value', () => {
    const r = parseDecisionTags('<domain>not-a-domain</domain>');
    expect(r.parsed.domain).toBeUndefined();
    expect(r.violations).toContainEqual(expect.objectContaining({ tag: 'domain', reason: 'invalid_value' }));
  });

  it('drops unknown art axis silently (forward-compat)', () => {
    const r = parseDecisionTags('<gameArtTier>unknownAxis=foo,concept=flatVector</gameArtTier>');
    expect(r.parsed.gameArtTier).toEqual({ concept: 'flatVector' });
  });

  it('drops unknown variant value silently for Phase 4 axes (forward-compat)', () => {
    const r = parseDecisionTags(
      '<gameArtTier>concept=flatVector,entityCatalog=ultraRich,motionPattern=subtle</gameArtTier>',
    );
    // ultraRich is not a registered entityCatalog variant — dropped.
    expect(r.parsed.gameArtTier).toEqual({ concept: 'flatVector', motionPattern: 'subtle' });
  });

  it('records a violation when gameArtTier body has no recognised axes', () => {
    const r = parseDecisionTags('<gameArtTier>unknown=foo</gameArtTier>');
    expect(r.parsed.gameArtTier).toBeUndefined();
    expect(r.violations).toContainEqual(expect.objectContaining({ tag: 'gameArtTier' }));
  });
});

// `parseDecisionTags — genre × coreLoop matrix gate` describe lives in
// tests/prompt/genre-coreloop-matrix.test.ts (the I9/D31-revised SSOT).

describe('parseDecisionTags — missing tags', () => {
  it('lists all missing names', () => {
    const r = parseDecisionTags('');
    expect(r.missing).toEqual(['domain', 'gameArtTier', 'serviceVirtualization']);
  });
});

describe('applyDecisionTagDefaults — graceful degrade (10.4)', () => {
  it('fills gameArtTier defaults when missing (Phase 4)', () => {
    const r = parseDecisionTags('');
    const filled = applyDecisionTagDefaults(r.parsed, ['gameArtTier']);
    // Phase 4 default fills all 7 art axes — registry-backed conservative
    // values that work in css-only inline production.
    expect(filled.gameArtTier).toEqual({
      concept: 'flatVector',
      perspective: '2d',
      entityCatalog: 'minimal',
      motionPattern: 'static',
      particleProfile: 'none',
      projectilePolicy: 'none',
      audioProfile: 'procedural',
    });
  });

  it('does not override an existing parsed value', () => {
    const r = parseDecisionTags('<gameArtTier>concept=neonSynth,perspective=2d</gameArtTier>');
    const filled = applyDecisionTagDefaults(r.parsed, ['gameArtTier']);
    // Phase 4 — defaults supplement only the axes the LLM did NOT emit.
    // The parsed value (neonSynth / 2d) is preserved verbatim; this test
    // verifies that the merge does not stomp the existing value.
    expect(filled.gameArtTier).toEqual({ concept: 'neonSynth', perspective: '2d' });
  });
});

describe('decisionTagRetryFraming', () => {
  it('returns empty when no missing/invalid tags', () => {
    expect(decisionTagRetryFraming([], [])).toBe('');
  });

  it('lists missing tags with hints', () => {
    const out = decisionTagRetryFraming(['domain', 'gameArtTier'], []);
    expect(out).toContain('<domain>');
    expect(out).toContain('<gameArtTier>');
  });

  it('lists invalid bodies', () => {
    const out = decisionTagRetryFraming([], [
      { tag: 'domain', reason: 'invalid_value', observed: 'foo', message: 'Decision tag "domain" — invalid_value: "foo"' },
    ]);
    expect(out).toContain('domain');
    expect(out).toContain('invalid_value');
  });
});
