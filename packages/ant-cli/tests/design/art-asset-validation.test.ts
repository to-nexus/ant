/**
 * Game-Art Asset Validation (Phase 2 — D20 + I6 backstop)
 *
 * Covers the production validator at
 * `infrastructure/workspace/gameArtAssetValidator.ts`. The template under
 * `jobs/code/basis/gameArtTier/_preamble.md` enforces the same invariants
 * verbally — this suite is the programmatic backstop so a refactor that
 * loosens the rules trips a lint failure rather than silently leaking
 * across surfaces.
 *
 * Invariants under test:
 *   - D20 — `kind:inline` entries are exempt from src-existence checks.
 *   - D20 — `kind:external` entries require a `src` that resolves on disk.
 *   - I6  — `kind:external` srcs may NOT point into the service pool.
 */

import { describe, it, expect } from 'vitest';
import {
  validateGameArtAssetCatalog,
  validateGameArtAssetEntry,
  type GameArtAssetEntry,
} from '../../src/infrastructure/workspace/gameArtAssetValidator';

describe('Game-Art Asset Validation (D20 + I6)', () => {
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // D20 — kind discipline
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  it('kind:inline entries are skipped from src existence check', () => {
    const inline: GameArtAssetEntry = {
      id: 'spark',
      kind: 'inline',
      format: 'svg',
    };
    const srcExists = () => false; // intentionally pessimistic

    const issues = validateGameArtAssetEntry(inline, { srcExists });
    expect(issues).toEqual([]);
  });

  it('kind:inline entries are still skipped even with multiple inline entries', () => {
    const entries: GameArtAssetEntry[] = [
      { id: 'spark', kind: 'inline', format: 'svg' },
      { id: 'click', kind: 'inline', format: 'oscillator' },
      { id: 'card', kind: 'inline', format: 'css' },
    ];
    const issues = validateGameArtAssetCatalog(entries, { srcExists: () => false });
    expect(issues).toEqual([]);
  });

  it('kind:external src must exist under assets/game/', () => {
    const present = new Set([
      'assets/game/entities/hero.svg',
    ]);
    const srcExists = (p: string) => present.has(p);

    const ok: GameArtAssetEntry = {
      id: 'hero',
      kind: 'external',
      src: 'assets/game/entities/hero.svg',
    };
    expect(validateGameArtAssetEntry(ok, { srcExists })).toEqual([]);

    const missing: GameArtAssetEntry = {
      id: 'enemy',
      kind: 'external',
      src: 'assets/game/entities/enemy.svg',
    };
    const issues = validateGameArtAssetEntry(missing, { srcExists });
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('external-src-missing');
    expect(issues[0].id).toBe('enemy');
    expect(issues[0].src).toBe('assets/game/entities/enemy.svg');
  });

  it('kind:external without src yields external-missing-src issue', () => {
    const broken: GameArtAssetEntry = { id: 'orphan', kind: 'external' };
    const issues = validateGameArtAssetEntry(broken);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('external-missing-src');
    expect(issues[0].id).toBe('orphan');
  });

  it('kind:external src outside the game pool flags external-outside-game-pool (without throwing)', () => {
    const stray: GameArtAssetEntry = {
      id: 'stray',
      kind: 'external',
      src: 'architecture/leftovers/stray.svg',
    };
    const issues = validateGameArtAssetEntry(stray);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('external-outside-game-pool');
    expect(issues[0].src).toBe('architecture/leftovers/stray.svg');
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // I6 — cross-surface boundary
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  it('kind:external src starting with assets/service/ throws (I6)', () => {
    const leak: GameArtAssetEntry = {
      id: 'logo',
      kind: 'external',
      src: 'assets/service/icons/logo.svg',
    };
    expect(() => validateGameArtAssetEntry(leak)).toThrowError(/\[I6\]/);
    expect(() => validateGameArtAssetEntry(leak)).toThrowError(/logo/);
  });

  it('I6 throw bubbles out of validateGameArtAssetCatalog as well', () => {
    const entries: GameArtAssetEntry[] = [
      { id: 'spark', kind: 'inline' },
      { id: 'logo', kind: 'external', src: 'assets/service/icons/logo.svg' },
    ];
    expect(() => validateGameArtAssetCatalog(entries)).toThrowError(/\[I6\]/);
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Sanity — mixed catalog producing zero issues
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  it('a clean mixed catalog (inline + valid external) produces zero issues', () => {
    const present = new Set([
      'assets/game/entities/hero.svg',
      'assets/game/sfx/click.mp3',
    ]);
    const entries: GameArtAssetEntry[] = [
      { id: 'spark', kind: 'inline', format: 'svg' },
      { id: 'click', kind: 'inline', format: 'oscillator' },
      { id: 'hero', kind: 'external', src: 'assets/game/entities/hero.svg' },
      { id: 'click-sfx', kind: 'external', src: 'assets/game/sfx/click.mp3' },
    ];
    const issues = validateGameArtAssetCatalog(entries, {
      srcExists: p => present.has(p),
    });
    expect(issues).toEqual([]);
  });

  it('skipping the srcExists predicate disables only the existence leg (D20 hard cases still fire)', () => {
    const entries: GameArtAssetEntry[] = [
      { id: 'orphan', kind: 'external' },
      { id: 'hero', kind: 'external', src: 'assets/game/entities/hero.svg' }, // unchecked existence
    ];
    const issues = validateGameArtAssetCatalog(entries);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('external-missing-src');
  });
});
