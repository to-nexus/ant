/**
 * Render Boundary Locality (Q1~Q3 / R1~R5 regression guard)
 *
 * Game domain prompts partition UI rendering by **coordinate system**:
 *   - Screen-space UI (HUD / menus / modals / settings) → React (HTML/CSS)
 *   - World-space UI (sprite-anchored bubbles, in-world banners) → engine canvas
 *
 * The boundary is asserted across 3 prompt surfaces so it survives every
 * authoring path (plan-only / design-only / direct-to-code):
 *
 *   - jobs/code/domain/game.md         §7 Render Boundary & Viewport
 *     (FPOP — engine-agnostic principles + 4 blind-spot reminders +
 *      R1/R3/R5 mitigation)
 *   - jobs/code/basis/techTier/gameEngine/phaser.md
 *     (SBS — Phaser API: Scale.FIT/RESIZE, parent, devicePixelRatio,
 *      context-lost handling, useSyncExternalStore for per-frame HUD)
 *   - jobs/design/domain/game.md       §9 Render Boundary Policy
 *     (system-design coordinate-system commit, no engine API names)
 *
 * Tests assert the SSOT lives in the right place AND the legacy
 * contradiction phrasing is gone.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const TEMPLATES_ROOT = path.resolve(__dirname, '../../src/core/prompt/templates');

const CODE_DOMAIN_GAME = path.join(TEMPLATES_ROOT, 'jobs/code/domain/game.md');
const CODE_PHASER = path.join(TEMPLATES_ROOT, 'jobs/code/basis/techTier/gameEngine/phaser.md');
const DESIGN_DOMAIN_GAME = path.join(TEMPLATES_ROOT, 'jobs/design/domain/game.md');
const PLAN_DOMAIN_GAME = path.join(TEMPLATES_ROOT, 'jobs/plan/domain/game.md');
const GAMECONTENT_PREAMBLE = path.join(TEMPLATES_ROOT, 'jobs/code/basis/gameContentTier/_preamble.md');
const GAMEART_PREAMBLE = path.join(TEMPLATES_ROOT, 'jobs/code/basis/gameArtTier/_preamble.md');
const GAMEART_SOURCE = path.join(TEMPLATES_ROOT, 'jobs/code/base/injections/game-art-source.md');

function read(p: string): string {
  return fs.readFileSync(p, 'utf-8');
}

describe('Render Boundary Locality — code/domain/game.md (§7 SSOT)', () => {
  const src = read(CODE_DOMAIN_GAME);

  it('declares §7 Render boundary & viewport heading', () => {
    expect(src).toMatch(/^### 7\. Render boundary/m);
  });

  it('MECE table advertises 7 sections (header row counts §1~§7)', () => {
    // Match table rows that start with a numeric digit + ` | ` (markdown
    // table cell separator). Only the MECE table at the top has this shape.
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
    expect(src).toMatch(/100dvh/); // mobile vh jump fix
    expect(src).toMatch(/safe-area-inset/); // iOS notch / Android system bars
    expect(src.toLowerCase()).toContain('place-items'); // canvas left-skew fix
    expect(src.toLowerCase()).toContain('pixel buffer'); // <canvas width/height> trap
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
    // The §9 block is design-level; phaser API symbols MUST NOT leak here.
    // We narrow to the §9 block to allow other sections to mention them
    // only in negative ("Do NOT specify ...") prose.
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
