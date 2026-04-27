/**
 * Code-Overlay Domain Locality (Phase 3 — Wave 1 / SBS regression)
 *
 * The job × domain code overlays at
 *   `templates/jobs/code/domain/{game,service}.md`
 * are gated on `domain === 'game'` and `domain === 'service'`
 * respectively. Under SBS (Scope-Bound Specificity) each file MUST
 * speak its own gate's vocabulary and MUST NOT leak vocabulary that
 * belongs to the sibling gate — otherwise the gate's information
 * payload is zero (game.md that talks like service.md is wasted, and
 * vice versa).
 *
 * Mechanics:
 *   1. Positive sanity — game.md must use game-implementation
 *      vocabulary in its plain text; service.md must use service /
 *      SaaS implementation vocabulary.
 *   2. Cross-pollution — game.md plain text MUST NOT mention service
 *      vocabulary, and service.md plain text MUST NOT mention game
 *      vocabulary. "Plain text" excludes backtick-wrapped tokens so
 *      the explicit "FORBIDDEN to use X / Y / Z" disclaimer at the
 *      end of each file is allowed.
 *
 * This is the code-job analogue of `plan-domain-overlay-locality.test.ts`
 * (plan job) and `motion-locality.test.ts` (I5).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const TEMPLATES_ROOT = path.resolve(__dirname, '../src/core/prompt/templates');

const GAME_FILE = path.join(TEMPLATES_ROOT, 'jobs/code/domain/game.md');
const SERVICE_FILE = path.join(TEMPLATES_ROOT, 'jobs/code/domain/service.md');

/**
 * Strip everything inside backticks (inline code spans) and fenced
 * code blocks. Disclaimer sections cite cross-domain vocabulary as
 * code spans on purpose; the test only flags pollution in narrative
 * prose.
 */
function plainText(src: string): string {
  return src
    .replace(/```[\s\S]*?```/g, '') // fenced code blocks
    .replace(/`[^`\n]*`/g, '');     // inline code spans
}

function hasAny(text: string, words: readonly string[]): { hit: boolean; matched: string[] } {
  const matched: string[] = [];
  for (const w of words) {
    const re = new RegExp(`\\b${w.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
    if (re.test(text)) matched.push(w);
  }
  return { hit: matched.length > 0, matched };
}

// Game-implementation vocabulary the game overlay MUST cover and the
// service overlay MUST NOT leak into prose.
const GAME_VOCAB = [
  'game loop',
  'scene',
  'sprite',
  'tick',
  'oscillator',
  'fixed-timestep',
  'snapshot',
  'dt',
  'BootScene',
  'MainScene',
  'UIScene',
  'HUD',
];

// Service-implementation vocabulary the service overlay MUST cover and
// the game overlay MUST NOT leak into prose. Some of these (RBAC,
// non-functional, audit, retention) overlap with the plan-job locality
// test's SERVICE_VOCAB.
const SERVICE_VOCAB = [
  'use case',
  'use-case',
  'transaction',
  'RBAC',
  'audit',
  'idempotency',
  'retry',
  'circuit breaker',
  'SLA',
  'non-functional',
  'persona',
  'retention',
];

describe('Code-Overlay Domain Locality (Wave 1 / SBS)', () => {
  it('code game overlay uses game-implementation vocabulary in plain text (positive sanity)', () => {
    const src = fs.readFileSync(GAME_FILE, 'utf-8');
    const plain = plainText(src);
    const { hit, matched } = hasAny(plain, GAME_VOCAB);
    expect(hit, `code/domain/game.md must use game-implementation vocabulary in plain text. Matched: ${matched.join(', ')}`).toBe(true);
    expect(matched.length).toBeGreaterThanOrEqual(3);
  });

  it('code service overlay uses service-implementation vocabulary in plain text (positive sanity)', () => {
    const src = fs.readFileSync(SERVICE_FILE, 'utf-8');
    const plain = plainText(src);
    const { hit, matched } = hasAny(plain, SERVICE_VOCAB);
    expect(hit, `code/domain/service.md must use service-implementation vocabulary in plain text. Matched: ${matched.join(', ')}`).toBe(true);
    expect(matched.length).toBeGreaterThanOrEqual(3);
  });

  it('code game overlay must NOT leak service vocabulary into plain text', () => {
    const src = fs.readFileSync(GAME_FILE, 'utf-8');
    const plain = plainText(src);
    const { matched } = hasAny(plain, SERVICE_VOCAB);
    expect(
      matched,
      `code/domain/game.md plain text contains service-domain vocabulary (move to backticks if quoting): ${matched.join(', ')}`,
    ).toEqual([]);
  });

  it('code service overlay must NOT leak game vocabulary into plain text', () => {
    const src = fs.readFileSync(SERVICE_FILE, 'utf-8');
    const plain = plainText(src);
    const { matched } = hasAny(plain, GAME_VOCAB);
    expect(
      matched,
      `code/domain/service.md plain text contains game-domain vocabulary (move to backticks if quoting): ${matched.join(', ')}`,
    ).toEqual([]);
  });

  it('both overlays exist in the post-D27 directory location', () => {
    expect(fs.existsSync(GAME_FILE), 'jobs/code/domain/game.md must exist (D27 — moved out of basis/)').toBe(true);
    expect(fs.existsSync(SERVICE_FILE), 'jobs/code/domain/service.md must exist (D27 — moved out of basis/)').toBe(true);
  });

  it('legacy basis/domain/ paths must NOT exist (D27 cleanup)', () => {
    const legacyGame = path.join(TEMPLATES_ROOT, 'jobs/code/basis/domain/game.md');
    const legacyService = path.join(TEMPLATES_ROOT, 'jobs/code/basis/domain/service.md');
    expect(fs.existsSync(legacyGame), 'jobs/code/basis/domain/game.md should be moved to jobs/code/domain/game.md').toBe(false);
    expect(fs.existsSync(legacyService), 'jobs/code/basis/domain/service.md should be moved to jobs/code/domain/service.md').toBe(false);
  });
});

describe('Phaser engine partial — SBS gate sanity', () => {
  // The Phaser engine partial lives at basis/techTier/gameEngine/phaser.md
  // and is gated on `techTier × gameEngine === 'phaser'`. Under SBS the
  // gate's information payload requires the partial to actually mention
  // Phaser API surfaces — a "stub" body would defeat the gate.
  const PHASER_FILE = path.join(TEMPLATES_ROOT, 'basis/techTier/gameEngine/phaser.md');

  it('phaser.md mentions Phaser API surfaces (SBS gate payload)', () => {
    const src = fs.readFileSync(PHASER_FILE, 'utf-8');
    // Phaser-specific tokens that prove this is not a stub.
    const tokens = ['Phaser.Game', 'Phaser.Scene', 'Phaser.GameObjects', 'preload', 'create'];
    const matched = tokens.filter(t => src.includes(t));
    expect(
      matched.length,
      `phaser.md must reference Phaser API surfaces (SBS gate). Matched: ${matched.join(', ')}`,
    ).toBeGreaterThanOrEqual(3);
  });

  it('phaser.md is non-stub (length > 1000 chars)', () => {
    const src = fs.readFileSync(PHASER_FILE, 'utf-8');
    expect(src.length, 'phaser.md is non-stub (Wave 1 body)').toBeGreaterThan(1000);
  });
});

describe('Game-art code-overlay preamble — audioScope / visualScope discriminators', () => {
  // The code-side gameArtTier preamble must reference both scope markers —
  // `audioScope` gates external audio loading and `visualScope` gates atlas /
  // multi-emitter / multi-projectile setups (D16 / D21). Without these
  // markers, the code emitted today silently ignores the scope guard.
  const FILE = path.join(TEMPLATES_ROOT, 'jobs/code/basis/gameArtTier/_preamble.md');

  it('code/basis/gameArtTier/_preamble.md references audioScope and visualScope markers', () => {
    const src = fs.readFileSync(FILE, 'utf-8');
    expect(src).toMatch(/audioScope/);
    expect(src).toMatch(/visualScope/);
  });

  it('code/basis/gameArtTier/_preamble.md is non-stub (length > 800 chars)', () => {
    const src = fs.readFileSync(FILE, 'utf-8');
    expect(src.length, 'gameArtTier preamble is non-stub (Wave 1 body)').toBeGreaterThan(800);
  });
});
