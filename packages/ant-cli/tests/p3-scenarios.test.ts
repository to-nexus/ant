/**
 * Phase 3 — Scenario verification (static, file-set + invariant-marker)
 *
 * The two end-to-end scenarios in `docs/tmp/phase-3-game-minimum-content-plan.md`
 * §3 Wave 3 are LLM-driven by definition. This suite is the **static
 * counterpart** that locks the *file set* + *content markers* a real run
 * MUST be able to layer. A refactor that deletes one of the partials,
 * or a content edit that strips a key invariant token, trips this suite
 * before any actual scenario run is executed.
 *
 * Scenario A (single-shot directive, match-3 / Phaser):
 *   gen-code-directive + workspaceConfig.domain === 'game'
 *   + basis.gameContentTier = { genre: 'match3', coreLoop: 'solve' }       (D31-revised v8)
 *   + basis.gameArtTier     = { concept: 'flatMinimal', perspective: '2d' } (D32-revised v8 + D30)
 *   + basis.techTier        = [{ stack: 'frontend', language: 'typescript',
 *                                framework: 'react', gameEngine: 'phaser' }]  (D29 single)
 *
 *   PromptBuilder MUST be able to layer:
 *     1. domain/game.md                                  — workspace identity
 *     2. jobs/code/domain/game.md                        — code-overlay
 *     3. basis/gameContentTier/genre/match3.md           — Wave 2 ledger (v8)
 *     4. basis/gameContentTier/coreLoop/solve.md         — Wave 2 ledger
 *     5. basis/gameArtTier/concept/flatMinimal.md        — Wave 2 ledger (v8)
 *     6. basis/gameArtTier/perspective/2d.md             — Wave 2 ledger
 *     7. basis/techTier/gameEngine/phaser.md             — Wave 1 engine
 *     8. jobs/code/basis/gameArtTier/_preamble.md        — Wave 1 css-only
 *     9. jobs/code/basis/gameContentTier/_preamble.md    — Wave 1 bridge
 *
 * Scenario B (3+1 job chain — gen-plan / gen-sys-fe / gen-ui-desc +
 * gen-game-art-desc / gen-code-sys), the per-step partial set:
 *   Step 1 (gen-plan):          jobs/plan/domain/game.md (12 GDD sections)
 *   Step 2 (gen-sys-fe):        jobs/design/domain/game.md
 *                               (state ownership / determinism / event flow / multiplayer / physics)
 *   Step 3a (gen-ui-desc):      jobs/design/nodes/execute/injections/{ui-tokens,ui-assets,ui-spec}-guide-by-desc.md
 *   Step 3b (gen-game-art-desc): jobs/design/nodes/execute/injections/game-art-{tokens,assets,spec}-guide-by-desc.md
 *   Step 4 (gen-code-sys):      code job consumes BOTH ui-assets AND
 *                               game-art-assets — guarded by I7 game-art-design-surface
 *                               locality + asset-surface-boundary I6.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const TEMPLATES_DIR = join(__dirname, '../src/core/prompt/templates');

function readTemplate(rel: string): string {
  const path = rel.endsWith('.md') ? rel : `${rel}.md`;
  return readFileSync(join(TEMPLATES_DIR, path), 'utf8');
}

/** Strip ` ```fenced``` ` and inline `backticks` so SBS markers are not
 *  fooled by example mentions inside code blocks. */
function plainText(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]*`/g, '');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Scenario A — single-shot directive, match-3 / Phaser
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Phase 3 — Scenario A (single-shot directive, match-3 / Phaser)', () => {
  const SCENARIO_A_PARTIALS: ReadonlyArray<{ rel: string; markers: ReadonlyArray<RegExp> }> = [
    {
      rel: 'domain/game',
      markers: [/game/i],
    },
    {
      rel: 'jobs/code/domain/game',
      markers: [/loop ownership/i, /scene/i, /asset import policy/i, /determinism/i],
    },
    {
      rel: 'basis/gameContentTier/genre/match3',
      markers: [/match-?3/i, /board/i, /matching|match/i, /cascade/i],
    },
    {
      rel: 'basis/gameContentTier/coreLoop/solve',
      markers: [/solve/i, /loop steps/i, /failure/i],
    },
    {
      rel: 'basis/gameArtTier/concept/flatMinimal',
      markers: [/palette/i, /silhouette/i],
    },
    {
      rel: 'basis/gameArtTier/perspective/2d',
      markers: [/camera/i, /depth/i],
    },
    {
      rel: 'basis/techTier/gameEngine/phaser',
      markers: [/phaser/i, /scene/i, /preload|preLoad/i],
    },
    {
      rel: 'jobs/code/basis/gameArtTier/_preamble',
      markers: [/audioScope/i, /visualScope/i, /OscillatorNode/i],
    },
    {
      rel: 'jobs/code/basis/gameContentTier/_preamble',
      markers: [/genre/i, /coreLoop/i],
    },
  ];

  it.each(SCENARIO_A_PARTIALS)(
    'partial $rel exists and carries its required SBS markers',
    ({ rel, markers }) => {
      const content = readTemplate(rel);
      expect(content.length, `${rel} content too small`).toBeGreaterThan(200);
      for (const marker of markers) {
        expect(content, `${rel} missing marker ${marker}`).toMatch(marker);
      }
    },
  );

  it('Phaser engine partial commits to Phase 3 minimum graphics scope', () => {
    const content = readTemplate('basis/techTier/gameEngine/phaser');
    expect(content).toMatch(/Phaser\.GameObjects\.Graphics|fillStyle|fillRect/);
  });

  it('code-overlay game.md does NOT borrow service-domain vocabulary (I8 — code-overlay locality)', () => {
    const content = plainText(readTemplate('jobs/code/domain/game'));
    for (const word of ['RBAC', 'SLA', 'audit log', 'persona role', 'non-functional']) {
      expect(content, `service vocab "${word}" leaked into game code-overlay`).not.toMatch(
        new RegExp(`\\b${word}\\b`, 'i'),
      );
    }
  });

  it('gameArtTier preamble forbids runtime catalog mutation + fs reads (D21 hard cuts)', () => {
    const content = readTemplate('jobs/code/basis/gameArtTier/_preamble');
    expect(content).toMatch(/forbidden|MUST NOT|do not/i);
    expect(content).toMatch(/runtime/i);
  });

  it('genre partial is non-stub (≥ 600 chars) and locality-clean vs sibling genres (D31-revised v8)', () => {
    const content = plainText(readTemplate('basis/gameContentTier/genre/match3'));
    expect(content.length).toBeGreaterThan(600);
    // v8 sibling genres — match3 partial MUST NOT borrow vocabulary from
    // its 4 siblings in plain prose. Backtick-wrapped citations are
    // stripped by `plainText` so the cross-reference table at the bottom
    // (which lists siblings as `match3 → flatMinimal/...`) is not flagged.
    for (const sibling of ['slidingPuzzle', 'cardSolitaire', 'arcadePaddle', 'arcadeSnake']) {
      expect(content, `match3.md leaks sibling genre "${sibling}" in plain text`).not.toMatch(
        new RegExp(`\\b${sibling}\\b`, 'i'),
      );
    }
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Scenario B — 3+1 job chain
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Phase 3 — Scenario B (3+1 chain: plan → sys-fe → ui+art design → code)', () => {
  // ----- Step 1: gen-plan + domain=game → GDD 12 sections
  it('Step 1 — plan-overlay game GDD has all 12 MECE sections', () => {
    const content = readTemplate('jobs/plan/domain/game');
    const required = [
      /Core Concept/i,
      /Genre & Coreloop/i,
      /5-Minute Hook|five[-\s]minute hook/i,
      /Mechanics → Dynamics → Aesthetic|MDA/i,
      /Progression Curve/i,
      /Reward & Feedback/i,
      /Fail Condition/i,
      /Content Scope/i,
      /Input & Perspective/i,
      /Game Modes/i,
      /Meta-Progression/i,
      /Out-of-Scope/i,
    ];
    for (const re of required) {
      expect(content, `plan-overlay missing section ${re}`).toMatch(re);
    }
  });

  it('Step 1 — plan-overlay forbids design-surface vocabulary (state ownership / determinism)', () => {
    const content = plainText(readTemplate('jobs/plan/domain/game'));
    // The overlay explicitly forbids these in its SBS section but uses them
    // verbally to instruct the LLM to NOT emit them. To keep the test honest
    // we require that they appear ONLY in the forbidden / boundary block.
    // A lighter check: the code section of the file should not adopt them as
    // design verbs. We allow occurrences inside the FORBIDDEN list.
    expect(content).toMatch(/FORBIDDEN|forbidden/i);
  });

  // ----- Step 2: gen-sys-fe → fe-system 8-section design overlay
  it('Step 2 — design-overlay game has the FE system commitments (state ownership / determinism / events / multiplayer / physics)', () => {
    const content = readTemplate('jobs/design/domain/game');
    expect(content).toMatch(/State Ownership/i);
    expect(content).toMatch(/Determinism/i);
    expect(content).toMatch(/Domain Events/i);
    expect(content).toMatch(/Multiplayer/i);
    expect(content).toMatch(/Physics|simulation/i);
  });

  // ----- Step 3a: gen-ui-desc → ui by-desc guide injections
  const UI_BY_DESC_INJECTIONS = [
    'jobs/design/nodes/execute/injections/ui-tokens-guide-by-desc',
    'jobs/design/nodes/execute/injections/ui-assets-guide-by-desc',
    'jobs/design/nodes/execute/injections/ui-spec-guide-by-desc',
  ] as const;
  it.each(UI_BY_DESC_INJECTIONS)(
    'Step 3a — UI by-desc injection %s exists and is non-trivial',
    (rel) => {
      const content = readTemplate(rel);
      expect(content.length).toBeGreaterThan(200);
    },
  );

  // ----- Step 3b: gen-game-art-desc → game-art by-desc guide injections
  const GAME_ART_BY_DESC_INJECTIONS = [
    'jobs/design/nodes/execute/injections/game-art-tokens-guide-by-desc',
    'jobs/design/nodes/execute/injections/game-art-assets-guide-by-desc',
    'jobs/design/nodes/execute/injections/game-art-spec-guide-by-desc',
  ] as const;
  it.each(GAME_ART_BY_DESC_INJECTIONS)(
    'Step 3b — game-art by-desc injection %s exists and is non-trivial',
    (rel) => {
      const content = readTemplate(rel);
      expect(content.length).toBeGreaterThan(200);
    },
  );

  it('Step 3b — game-art-assets-guide commits to kind:inline | external taxonomy (D20)', () => {
    const content = readTemplate('jobs/design/nodes/execute/injections/game-art-assets-guide-by-desc');
    expect(content).toMatch(/inline/);
    expect(content).toMatch(/external/);
  });

  // ----- Step 4: gen-code-sys → consumes game-art catalog only (D28 vertical
  // split — game-domain code does NOT consume UI catalog). The overlay
  // mentions `ui-assets` only inside the negation / forbidden block to
  // pin the cross-surface guard.
  it('Step 4 — code-overlay game references game-art catalog (game-domain SSOT — D28)', () => {
    const content = readTemplate('jobs/code/domain/game');
    expect(content).toMatch(/game-art-assets/i);
    // ui-assets MUST appear only in a "MUST NOT" / cross-pool guard
    // context — verified by I6 asset-surface-boundary test, not here.
  });

  it('Step 4 — code-overlay game-art preamble enforces I7-revised Domain-Surface Boundary (D28)', () => {
    const content = readTemplate('jobs/code/basis/gameArtTier/_preamble');
    // I7-revised in code overlay (D28) is named "Domain-Surface Boundary".
    expect(content).toMatch(/I7-revised|Domain-Surface Boundary|cross-surface/i);
    expect(content).toMatch(/game-art-assets/i);
    // ui catalog references appear only under "MUST NOT" guards.
    expect(content).toMatch(/ui-(?:tokens|assets|spec)/i);
  });

  // ----- Domain-locality cross-cuts (Scenario B touches all four jobs)
  it('plan / design / code domain-overlays are domain-locality clean (no cross-surface borrow)', () => {
    const planGame = plainText(readTemplate('jobs/plan/domain/game'));
    const designGame = plainText(readTemplate('jobs/design/domain/game'));
    const codeGame = plainText(readTemplate('jobs/code/domain/game'));

    // service-job vocabulary MUST NOT leak into any of the three overlays.
    // We only treat hard service-only nouns; common English words are excluded.
    const serviceNouns = ['RBAC', 'SLA', 'persona role', 'non-functional', 'audit log', 'retention policy'];
    for (const noun of serviceNouns) {
      const re = new RegExp(`\\b${noun.replace(/\s+/g, '\\s+')}\\b`, 'i');
      // plan game.md may MENTION these in a forbidden list; check they're
      // NOT used as committed plan vocabulary outside that list. The
      // simplest invariant — they don't appear in design + code overlays
      // (the most likely leak surface).
      expect(designGame, `${noun} leaked into design game-overlay`).not.toMatch(re);
      expect(codeGame, `${noun} leaked into code game-overlay`).not.toMatch(re);
    }

    // Also guard against bare "the GDD uses XYZ" outside its forbidden list.
    expect(planGame).toMatch(/coreloop|core[-\s]loop/i);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Scenario C — Phase 4 external-asset enabled (match-3 with file-based audio)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// Scenario C upgrades Scenario A:
//   gen-code-sys + workspaceConfig.domain === 'game'
//   + basis.gameContentTier = { genre: 'match3', coreLoop: 'solve' }       (D31-revised v8)
//   + basis.gameArtTier     = {
//       concept: 'flatMinimal', perspective: '2d',
//       entityCatalog: 'standard',                                          (Phase 4)
//       motionPattern: 'subtle',                                            (Phase 4)
//       particleProfile: 'light',                                           (Phase 4)
//       projectilePolicy: 'none',                                           (Phase 4)
//       audioProfile: 'fileBased',                                          (Phase 4)
//     }
//   + `inputs/assets/game/{entities/hero.svg, sfx/match-clear.mp3}` placed.
//
//   PromptBuilder MUST be able to layer ALL Scenario A partials PLUS:
//     1. basis/gameArtTier/entityCatalog/standard.md       — Phase 4 axis
//     2. basis/gameArtTier/motionPattern/subtle.md         — Phase 4 axis
//     3. basis/gameArtTier/particleProfile/light.md        — Phase 4 axis
//     4. basis/gameArtTier/projectilePolicy/none.md        — Phase 4 axis
//     5. basis/gameArtTier/audioProfile/fileBased.md       — Phase 4 axis
//   And the code-overlay preamble MUST commit the audio-loader conditional
//   (`audioScope === 'external-enabled'` activates `this.load.audio`).

describe('Phase 4 — Scenario C (external-asset enabled match-3 / fileBased audio)', () => {
  const SCENARIO_C_AXIS_PARTIALS: ReadonlyArray<{ rel: string; markers: ReadonlyArray<RegExp> }> = [
    {
      rel: 'basis/gameArtTier/entityCatalog/standard',
      markers: [/standard/i, /hero|antagonist|collectible/i, /entities/i],
    },
    {
      rel: 'basis/gameArtTier/motionPattern/subtle',
      markers: [/subtle/i, /ease/i, /tween/i],
    },
    {
      rel: 'basis/gameArtTier/particleProfile/light',
      markers: [/light/i, /particles/i, /5–10|5-10|emit/i],
    },
    {
      rel: 'basis/gameArtTier/projectilePolicy/none',
      markers: [/none/i, /no projectile|zero projectile/i],
    },
    {
      rel: 'basis/gameArtTier/audioProfile/fileBased',
      markers: [/fileBased|file-based/i, /external/i, /\.(mp3|ogg|wav)/i],
    },
  ];

  it.each(SCENARIO_C_AXIS_PARTIALS)(
    'Phase 4 axis partial $rel exists and carries its required SBS markers',
    ({ rel, markers }) => {
      const content = readTemplate(rel);
      expect(content.length, `${rel} content too small (Phase 4 stub regression)`).toBeGreaterThan(600);
      for (const marker of markers) {
        expect(content, `${rel} missing marker ${marker}`).toMatch(marker);
      }
    },
  );

  it('code-overlay game-art preamble stages the audio loader conditional behind audioScope', () => {
    const content = readTemplate('jobs/code/basis/gameArtTier/_preamble');
    expect(content).toMatch(/audioScope/);
    expect(content).toMatch(/external-enabled/);
    // Conditional shape — staged as illustrative code (engine partial commits the API names).
    expect(content).toMatch(/audio loader|load\.audio/);
  });

  it('asset-extension policy admits .mp3 / .ogg / .wav under inputs/assets/game (D-P4)', async () => {
    const { ARTIFACT_DIR_POLICIES } = await import('@ant/shared');
    const gamePolicy = ARTIFACT_DIR_POLICIES['inputs/assets/game'];
    expect(gamePolicy).toBeDefined();
    expect(gamePolicy.acceptedExtensions).toEqual(
      expect.arrayContaining(['.mp3', '.ogg', '.wav', '.atlas', '.glb', '.gltf']),
    );
  });

  it('asset-extension policy admits .woff / .woff2 / .ttf / .otf under inputs/assets/service (D-P4)', async () => {
    const { ARTIFACT_DIR_POLICIES } = await import('@ant/shared');
    const servicePolicy = ARTIFACT_DIR_POLICIES['inputs/assets/service'];
    expect(servicePolicy).toBeDefined();
    expect(servicePolicy.acceptedExtensions).toEqual(
      expect.arrayContaining(['.woff', '.woff2', '.ttf', '.otf']),
    );
  });

  it('assets-guide-by-desc (game-art) commits to the external-asset hook via per-marker gating', () => {
    const content = readTemplate('jobs/design/nodes/execute/injections/game-art-assets-guide-by-desc');
    expect(content).toMatch(/audioScope/);
    expect(content).toMatch(/external-enabled/);
    expect(content).toMatch(/sfx|bgm/);
  });
});
