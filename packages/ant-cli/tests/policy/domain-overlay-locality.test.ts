/**
 * Domain-Overlay Locality SSOT — three orthogonal SBS / locality concerns
 * for the `jobs/<job>/domain/{game,service}.md` overlay files plus the
 * §7 render-boundary policy that lives across code/design/plan/asset
 * surfaces.
 *
 *   1. Plan-overlay vocabulary purity (D27 / SBS)
 *      `jobs/plan/domain/{game,service}.md` MUST speak its own gate's
 *      vocabulary and MUST NOT leak the sibling's vocabulary into prose.
 *      Backtick-wrapped tokens inside "FORBIDDEN to use X / Y / Z"
 *      disclaimers are allowed.
 *
 *   2. Code-overlay vocabulary purity (Wave 1 / SBS)
 *      Same contract for `jobs/code/domain/{game,service}.md`. Plus the
 *      Phaser engine partial (`basis/techTier/gameEngine/phaser.md`)
 *      must reference Phaser API surfaces (gate payload), and the
 *      gameArtTier code preamble must mention `audioScope` /
 *      `visualScope` discriminators (D16 / D21).
 *
 *   3. Render-boundary policy locality (Q1~Q3 / R1~R5 regression guard)
 *      Game domain partitions UI rendering by coordinate system —
 *      screen-space (React) vs world-space (engine canvas). The boundary
 *      is asserted across 6 prompt surfaces so it survives every
 *      authoring path:
 *        - jobs/code/domain/game.md             §7 SSOT
 *        - jobs/code/basis/techTier/gameEngine/phaser.md  engine SBS
 *        - jobs/design/domain/game.md           §9 design-level policy
 *        - jobs/plan/domain/game.md             §9 GDD orientation
 *        - jobs/code/basis/gameContentTier/_preamble.md  HUD anchor
 *        - jobs/code/basis/gameArtTier/_preamble.md      table rows split
 *        - jobs/code/base/injections/game-art-source.md  table rows split
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const TEMPLATES_ROOT = path.resolve(__dirname, '../../src/core/prompt/templates');

function read(p: string): string {
  return fs.readFileSync(p, 'utf-8');
}

/**
 * Strip everything inside backticks (inline code spans) and fenced
 * code blocks. Disclaimer sections cite cross-domain vocabulary as
 * code spans on purpose; the test only flags pollution in narrative prose.
 */
function plainText(src: string): string {
  return src
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]*`/g, '');
}

function hasAny(text: string, words: readonly string[]): { hit: boolean; matched: string[] } {
  const matched: string[] = [];
  for (const w of words) {
    const re = new RegExp(`\\b${w.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
    if (re.test(text)) matched.push(w);
  }
  return { hit: matched.length > 0, matched };
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Plan-Overlay Vocabulary Purity (D27 / SBS)
// ════════════════════════════════════════════════════════════════════════════

const PLAN_GAME_FILE = path.join(TEMPLATES_ROOT, 'jobs/plan/domain/game.md');
const PLAN_SERVICE_FILE = path.join(TEMPLATES_ROOT, 'jobs/plan/domain/service.md');

const PLAN_GAME_VOCAB = [
  'coreloop',
  'core loop',
  'coreLoop',
  '5-minute hook',
  '5-Minute Hook',
  'MDA',
  'fail condition',
  'playable verb',
  'playable verbs',
  'playtest',
  'progression curve',
  'GDD',
  'game design document',
  'mechanic',
  'mechanics',
  'aesthetic',
];

const PLAN_SERVICE_VOCAB = [
  'RBAC',
  'ACL',
  'SLA',
  'persona',
  'personas',
  'non-functional',
  'audit',
  'retention',
  'PRD',
  'SaaS',
  'permissions',
];

describe('Plan-Overlay Domain Locality (D27 / SBS)', () => {
  it('plan game overlay uses game-design vocabulary in plain text (positive sanity)', () => {
    const plain = plainText(read(PLAN_GAME_FILE));
    const { hit, matched } = hasAny(plain, PLAN_GAME_VOCAB);
    expect(hit, `game.md must use game-design vocabulary in plain text. Matched: ${matched.join(', ')}`).toBe(true);
    expect(matched.length).toBeGreaterThanOrEqual(3);
  });

  it('plan service overlay uses service / SaaS PRD vocabulary in plain text (positive sanity)', () => {
    const plain = plainText(read(PLAN_SERVICE_FILE));
    const { hit, matched } = hasAny(plain, PLAN_SERVICE_VOCAB);
    expect(hit, `service.md must use service vocabulary in plain text. Matched: ${matched.join(', ')}`).toBe(true);
    expect(matched.length).toBeGreaterThanOrEqual(3);
  });

  it('plan game overlay must NOT leak service vocabulary into plain text', () => {
    const plain = plainText(read(PLAN_GAME_FILE));
    const { matched } = hasAny(plain, PLAN_SERVICE_VOCAB);
    expect(matched, `game.md plain text contains service-domain vocabulary: ${matched.join(', ')}`).toEqual([]);
  });

  it('plan service overlay must NOT leak game vocabulary into plain text', () => {
    const plain = plainText(read(PLAN_SERVICE_FILE));
    const { matched } = hasAny(plain, PLAN_GAME_VOCAB);
    expect(matched, `service.md plain text contains game-domain vocabulary: ${matched.join(', ')}`).toEqual([]);
  });

  it('both overlays exist in the post-D27 directory location', () => {
    expect(fs.existsSync(PLAN_GAME_FILE)).toBe(true);
    expect(fs.existsSync(PLAN_SERVICE_FILE)).toBe(true);
  });

  it('legacy basis/domain/ paths must NOT exist (D27 cleanup)', () => {
    expect(fs.existsSync(path.join(TEMPLATES_ROOT, 'jobs/plan/basis/domain/game.md'))).toBe(false);
    expect(fs.existsSync(path.join(TEMPLATES_ROOT, 'jobs/plan/basis/domain/service.md'))).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. Code-Overlay Vocabulary Purity (Wave 1 / SBS)
// ════════════════════════════════════════════════════════════════════════════

const CODE_GAME_FILE = path.join(TEMPLATES_ROOT, 'jobs/code/domain/game.md');
const CODE_SERVICE_FILE = path.join(TEMPLATES_ROOT, 'jobs/code/domain/service.md');

const CODE_GAME_VOCAB = [
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

const CODE_SERVICE_VOCAB = [
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
    const plain = plainText(read(CODE_GAME_FILE));
    const { hit, matched } = hasAny(plain, CODE_GAME_VOCAB);
    expect(hit, `code/domain/game.md must use game-implementation vocabulary. Matched: ${matched.join(', ')}`).toBe(true);
    expect(matched.length).toBeGreaterThanOrEqual(3);
  });

  it('code service overlay uses service-implementation vocabulary in plain text (positive sanity)', () => {
    const plain = plainText(read(CODE_SERVICE_FILE));
    const { hit, matched } = hasAny(plain, CODE_SERVICE_VOCAB);
    expect(hit, `code/domain/service.md must use service-implementation vocabulary. Matched: ${matched.join(', ')}`).toBe(true);
    expect(matched.length).toBeGreaterThanOrEqual(3);
  });

  it('code game overlay must NOT leak service vocabulary into plain text', () => {
    const plain = plainText(read(CODE_GAME_FILE));
    const { matched } = hasAny(plain, CODE_SERVICE_VOCAB);
    expect(matched, `code/domain/game.md plain text contains service-domain vocabulary: ${matched.join(', ')}`).toEqual([]);
  });

  it('code service overlay must NOT leak game vocabulary into plain text', () => {
    const plain = plainText(read(CODE_SERVICE_FILE));
    const { matched } = hasAny(plain, CODE_GAME_VOCAB);
    expect(matched, `code/domain/service.md plain text contains game-domain vocabulary: ${matched.join(', ')}`).toEqual([]);
  });

  it('both overlays exist in the post-D27 directory location', () => {
    expect(fs.existsSync(CODE_GAME_FILE)).toBe(true);
    expect(fs.existsSync(CODE_SERVICE_FILE)).toBe(true);
  });

  it('legacy basis/domain/ paths must NOT exist (D27 cleanup)', () => {
    expect(fs.existsSync(path.join(TEMPLATES_ROOT, 'jobs/code/basis/domain/game.md'))).toBe(false);
    expect(fs.existsSync(path.join(TEMPLATES_ROOT, 'jobs/code/basis/domain/service.md'))).toBe(false);
  });
});

describe('Phaser engine partial — SBS gate sanity', () => {
  const PHASER_FILE = path.join(TEMPLATES_ROOT, 'basis/techTier/gameEngine/phaser.md');

  it('phaser.md mentions Phaser API surfaces (SBS gate payload)', () => {
    const src = read(PHASER_FILE);
    const tokens = ['Phaser.Game', 'Phaser.Scene', 'Phaser.GameObjects', 'preload', 'create'];
    const matched = tokens.filter(t => src.includes(t));
    expect(matched.length, `phaser.md must reference Phaser API surfaces. Matched: ${matched.join(', ')}`).toBeGreaterThanOrEqual(3);
  });

  it('phaser.md is non-stub (length > 1000 chars)', () => {
    expect(read(PHASER_FILE).length).toBeGreaterThan(1000);
  });
});

describe('Game-art code-overlay preamble — audioScope / visualScope discriminators', () => {
  const FILE = path.join(TEMPLATES_ROOT, 'jobs/code/basis/gameArtTier/_preamble.md');

  it('code/basis/gameArtTier/_preamble.md references audioScope and visualScope markers', () => {
    const src = read(FILE);
    expect(src).toMatch(/audioScope/);
    expect(src).toMatch(/visualScope/);
  });

  it('code/basis/gameArtTier/_preamble.md is non-stub (length > 800 chars)', () => {
    expect(read(FILE).length).toBeGreaterThan(800);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. Render Boundary Locality (Q1~Q3 / R1~R5 regression guard)
// ════════════════════════════════════════════════════════════════════════════

const CODE_DOMAIN_GAME = path.join(TEMPLATES_ROOT, 'jobs/code/domain/game.md');
const CODE_PHASER = path.join(TEMPLATES_ROOT, 'jobs/code/basis/techTier/gameEngine/phaser.md');
const DESIGN_DOMAIN_GAME = path.join(TEMPLATES_ROOT, 'jobs/design/domain/game.md');
const PLAN_DOMAIN_GAME = path.join(TEMPLATES_ROOT, 'jobs/plan/domain/game.md');
const GAMECONTENT_PREAMBLE = path.join(TEMPLATES_ROOT, 'jobs/code/basis/gameContentTier/_preamble.md');
const GAMEART_PREAMBLE = path.join(TEMPLATES_ROOT, 'jobs/code/basis/gameArtTier/_preamble.md');
const GAMEART_SOURCE = path.join(TEMPLATES_ROOT, 'jobs/code/base/injections/game-art-source.md');

describe('Render Boundary Locality — code/domain/game.md (§7 SSOT)', () => {
  const src = read(CODE_DOMAIN_GAME);

  it('declares §7 Render boundary & viewport heading', () => {
    expect(src).toMatch(/^### 7\. Render boundary/m);
  });

  it('MECE table advertises 7 sections (header row counts §1~§7)', () => {
    const rows = src.match(/^\| \d+ \| /gm) ?? [];
    expect(rows.length, 'MECE table must list 7 numbered sections').toBe(7);
  });

  it('each section heading 1..7 is present exactly once', () => {
    for (let i = 1; i <= 7; i += 1) {
      const re = new RegExp(`^### ${i}\\. `, 'gm');
      const matches = src.match(re) ?? [];
      expect(matches.length, `### ${i}. heading count`).toBe(1);
    }
  });

  it('uses screen-space + world-space + viewport vocabulary', () => {
    expect(src.toLowerCase()).toContain('screen-space');
    expect(src.toLowerCase()).toContain('world-space');
    expect(src.toLowerCase()).toContain('viewport');
  });

  it('includes the four viewport blind-spot reminders', () => {
    expect(src).toMatch(/100dvh/);
    expect(src).toMatch(/safe-area-inset/);
    expect(src.toLowerCase()).toContain('place-items');
    expect(src.toLowerCase()).toContain('pixel buffer');
  });

  it('R1 — pointer-events guidance is present', () => {
    expect(src.toLowerCase()).toContain('pointer-events');
  });

  it('R3 — full-screen modal location is committed (React, not engine scene)', () => {
    expect(src.toLowerCase()).toMatch(/full-screen modals?.*react/i);
  });

  it('R5 — single-screen disclaimer for the five registered genres', () => {
    expect(src.toLowerCase()).toContain('single-screen');
    expect(src).toMatch(/match3.*slidingPuzzle.*cardSolitaire.*arcadePaddle.*arcadeSnake/);
  });
});

describe('Render Boundary Locality — phaser.md (engine API + R2/R4 SBS)', () => {
  const src = read(CODE_PHASER);

  it('legacy "HUD in UIScene NOT React" phrasing is removed', () => {
    expect(src).not.toMatch(/NOT a React absolute-positioned div/);
    expect(src).not.toMatch(/HUD in `?UIScene`?/);
  });

  it('UIScene is redefined as world-space overlay only', () => {
    expect(src.toLowerCase()).toMatch(/UIScene.*world-space/i);
  });

  it('Phaser Scale Manager API is committed (FIT / RESIZE)', () => {
    expect(src).toMatch(/Phaser\.Scale\.FIT/);
    expect(src).toMatch(/Phaser\.Scale\.RESIZE/);
  });

  it('scale.parent / devicePixelRatio guidance is present', () => {
    expect(src.toLowerCase()).toContain('scale.parent');
    expect(src.toLowerCase()).toContain('devicepixelratio');
  });

  it('R2 — useSyncExternalStore is referenced for per-frame HUD', () => {
    expect(src).toMatch(/useSyncExternalStore/);
  });

  it('R4 — WebGL context lost / restored handlers are required', () => {
    expect(src.toLowerCase()).toContain('context lost');
    expect(src).toMatch(/CONTEXT_(LOST|RESTORED)|context-lost|contextlost/i);
  });
});

describe('Render Boundary Locality — design/domain/game.md (§9 policy)', () => {
  const src = read(DESIGN_DOMAIN_GAME);

  it('declares §9 Render Boundary Policy heading', () => {
    expect(src).toMatch(/^### 9\. Render Boundary Policy/m);
  });

  it('uses screen-space / world-space vocabulary at policy level', () => {
    expect(src.toLowerCase()).toContain('screen-space');
    expect(src.toLowerCase()).toContain('world-space');
  });

  it('refuses engine API names at design level (phaser-specific tokens absent)', () => {
    const section9 = src.split(/^### 9\. Render Boundary Policy/m)[1] ?? '';
    expect(section9).not.toMatch(/Phaser\.Scale\.(FIT|RESIZE|ENVELOP)/);
    expect(section9).not.toMatch(/setSize\(/);
  });

  it('commits viewport-fill policy at concept level', () => {
    expect(src.toLowerCase()).toContain('viewport-fill policy');
  });
});

describe('Render Boundary Locality — plan/domain/game.md (§9 GDD)', () => {
  const src = read(PLAN_DOMAIN_GAME);

  it('§9 Input & Perspective row commits orientation policy + viewport target', () => {
    expect(src.toLowerCase()).toContain('orientation policy');
    expect(src.toLowerCase()).toContain('viewport target');
  });

  it('blind-spot reminder for §9 omission is present', () => {
    expect(src.toLowerCase()).toMatch(/orientation.*viewport|viewport.*orientation/);
  });
});

describe('Render Boundary Locality — gameContentTier preamble (anchor)', () => {
  const src = read(GAMECONTENT_PREAMBLE);

  it('HUD = React rendering surface anchor line is present', () => {
    expect(src.toLowerCase()).toMatch(/hud.*react.*rendering surface|hud.*screen-space.*react/i);
  });

  it('Cross-references the code/domain/game.md §7 SSOT', () => {
    expect(src).toMatch(/jobs\/code\/domain\/game\.md/);
  });
});

describe('Render Boundary Locality — gameArtTier preamble (table rows split)', () => {
  const src = read(GAMEART_PREAMBLE);

  it('§4 table separates screen-space (React) and world-space (Phaser) rows', () => {
    expect(src.toLowerCase()).toContain('screen-space');
    expect(src.toLowerCase()).toContain('world-space');
  });

  it('legacy mixed-row "UIScene / React HUD overlay" phrasing is removed', () => {
    expect(src).not.toMatch(/UIScene \/ React HUD overlay/);
  });
});

describe('Render Boundary Locality — game-art-source injection (table rows split)', () => {
  const src = read(GAMEART_SOURCE);

  it('"two render paths" table is restructured by coordinate system', () => {
    expect(src.toLowerCase()).toContain('coordinate system');
    expect(src.toLowerCase()).toContain('screen-space');
    expect(src.toLowerCase()).toContain('world-space');
  });
});
