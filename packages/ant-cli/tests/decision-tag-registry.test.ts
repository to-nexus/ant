/**
 * Decision Tag Registry SSOT (Phase 2, I3 — D12-revised)
 *
 * Phase 2 ships 3 tags via the registry: `domain`, `gameArtTier`,
 * `gameContentTier`. The 5th-slot `gameEngine` lives inside the existing
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
} from '../src/core/llm-response/DecisionTagRegistry';

describe('DECISION_TAG_REGISTRY', () => {
  it('registers exactly the 3 Phase 2 tags (no <gameEngine> standalone)', () => {
    expect(DECISION_TAG_REGISTRY.map(d => d.name)).toEqual([
      'domain',
      'gameArtTier',
      'gameContentTier',
    ]);
  });
});

describe('parseDecisionTags — happy path', () => {
  it('parses domain', () => {
    const r = parseDecisionTags('<domain>game</domain>');
    expect(r.parsed.domain).toBe('game');
    expect(r.violations).toHaveLength(0);
  });

  it('parses gameArtTier (concept + perspective)', () => {
    const r = parseDecisionTags('<gameArtTier>concept=sfFantasy,perspective=2d</gameArtTier>');
    expect(r.parsed.gameArtTier).toEqual({ concept: 'sfFantasy', perspective: '2d' });
  });

  it('parses gameContentTier', () => {
    const r = parseDecisionTags('<gameContentTier>genre=puzzle,coreLoop=solve</gameContentTier>');
    expect(r.parsed.gameContentTier).toEqual({ genre: 'puzzle', coreLoop: 'solve' });
  });

  it('parses all three together', () => {
    const raw = `
      <domain>game</domain>
      <gameArtTier>concept=darkFantasy,perspective=2d</gameArtTier>
      <gameContentTier>genre=action,coreLoop=fight</gameContentTier>
    `;
    const r = parseDecisionTags(raw);
    expect(r.violations).toHaveLength(0);
    expect(r.missing).toHaveLength(0);
    expect(r.parsed.domain).toBe('game');
    expect(r.parsed.gameArtTier).toEqual({ concept: 'darkFantasy', perspective: '2d' });
    expect(r.parsed.gameContentTier).toEqual({ genre: 'action', coreLoop: 'fight' });
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
    const r = parseDecisionTags('<gameArtTier>unknownAxis=foo,concept=sfFantasy</gameArtTier>');
    expect(r.parsed.gameArtTier).toEqual({ concept: 'sfFantasy' });
  });

  it('records a violation when gameArtTier body has no recognised axes', () => {
    const r = parseDecisionTags('<gameArtTier>unknown=foo</gameArtTier>');
    expect(r.parsed.gameArtTier).toBeUndefined();
    expect(r.violations).toContainEqual(expect.objectContaining({ tag: 'gameArtTier' }));
  });
});

describe('parseDecisionTags — missing tags', () => {
  it('lists all missing names', () => {
    const r = parseDecisionTags('');
    expect(r.missing).toEqual(['domain', 'gameArtTier', 'gameContentTier']);
  });
});

describe('applyDecisionTagDefaults — graceful degrade (10.4)', () => {
  it('fills gameArtTier and gameContentTier defaults when missing', () => {
    const r = parseDecisionTags('');
    const filled = applyDecisionTagDefaults(r.parsed, ['gameArtTier', 'gameContentTier']);
    expect(filled.gameArtTier).toEqual({ concept: 'modernCasual', perspective: '2d' });
    expect(filled.gameContentTier).toEqual({ genre: 'casual', coreLoop: 'collect' });
  });

  it('does not override an existing parsed value', () => {
    const r = parseDecisionTags('<gameArtTier>concept=darkFantasy,perspective=3d</gameArtTier>');
    const filled = applyDecisionTagDefaults(r.parsed, ['gameArtTier']);
    expect(filled.gameArtTier).toEqual({ concept: 'darkFantasy', perspective: '3d' });
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
