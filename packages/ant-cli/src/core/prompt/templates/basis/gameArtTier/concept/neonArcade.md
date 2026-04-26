## Art Concept: Neon Arcade

**Activation gate**: `gameArtTier.concept === 'neonArcade'`.

### Palette identity

Dark canvas + neon glow lines — the synthwave / Tron aesthetic. Color does the storytelling on a near-black background.

| Slot | Tone |
|---|---|
| Primary | Cyan, magenta, or hot pink at high saturation — the lit element on the dark canvas. |
| Accent | A complementary neon (lime / electric-blue / orange) reserved for danger / power-up / special states. |
| Danger | Hazard red — used at the highest saturation in the palette so it dominates focus when active. |
| Background | Near-black (#0A0A12 / very-dark deep blue / deep purple). The background is never pure black; a subtle hue tint keeps the neon legible. |

The palette ratio: background near-black ~70%, primary neon ~20%, accent and danger ~10%. The overall feel is "after-dark arcade cabinet" — bright lines on a void.

### Silhouette

- **Weight**: minimal — silhouettes are thin lines, not filled shapes. Form is described by the outline, not the fill.
- **Complexity**: low — single-stroke or double-stroke shapes are typical. Detailed interior fill breaks the neon-on-void contrast.
- **Edge style**: stroke-only (1–3 px outline at rendered resolution) plus an outer glow halo (shadow-blur ~8–16 px in the same hue). Anti-aliased; pixel-art does not belong here.

### Lighting tone

- **Light source**: each shape is its own emissive source (CSS `box-shadow` / `text-shadow` glow). No external sun / lamp model.
- **Shadow policy**: shadows are GLOWS, not occlusion — colored, additive, hue-matched to the source. Never a dark cast shadow.
- **Atmospherics**: scanline overlay (subtle horizontal lines) is optional; CRT vignette acceptable. Particles are sparkles or motion trails — never smoke / dust.

### Motion tone

- **Tempo**: snappy linear motion plus an "after-image" trail. Recovery is fast; the next interaction never waits more than ~200ms.
- **Scale**: expressive on collisions (color flash + glow surge), restrained on idle.
- **Idle**: subtle pulse on the player's primary entity (glow intensity ±10%); the rest of the world is static.

### Reference cluster (text references only)

- Tron (cinematic reference for the lit-line aesthetic).
- Geometry Wars, Resogun (game references for trail-and-particle handling).
- Synthwave album art (palette / atmosphere reference).
- Vectrex era (era reference for the stroke-only approach).

### Outputs and code-time consequences

- Token palette favors HSL with deep dark backgrounds (~10% lightness) and saturated neon accents (~70% lightness, 90%+ saturation).
- Inline css `box-shadow` / `filter: drop-shadow` is the primary glow tool; svg `<filter><feGaussianBlur>` for sharper canvas-side effects.
- HUD typography uses bright neon hue with a subtle text-shadow glow — readability at small sizes depends on contrast tuning.

### HUD layout defaults (D28 — concept-derived)

When emitting `game-art-tokens.json` HUD tokens or `game-art-spec.json` `hud` / `menu` / `dialog` categories, default to:

- **Spacing rhythm**: `compact8pt` — neon HUDs run dense and tight (the void background absorbs negative space). Airy spacing reads empty here.
- **Surface treatment**: `tinted` (translucent dark overlay with neon hairline border) — flat panels, no drop-shadow (the glow IS the elevation). Buttons use a glow-on-hover (shadow-blur expands).
- **Typography weight**: medium-to-bold (500–700), monospaced (Press Start 2P / Inconsolata / IBM Plex Mono) or geometric sans (Orbitron / Audiowide). Serif breaks the era promise.
- **Border radius**: 0–4px (sharp corners on panels and buttons). Rounded shapes feel friendly — neon-arcade is not friendly.
- **Focus ring / interaction tone**: instant — single-frame color flash on tap, 100ms glow-pulse on focus. No scale changes; the glow does the work.

### Genre affinity (D32-revised v8 — guidance, not a hard gate)

`neonArcade` is the canonical match for `arcadePaddle` (Tron paddle), `arcadeSnake` (Tron grid), and any project that wants a synthwave atmosphere. It is unusual — but legal — for `match3` (energy-crystal theme) and `cardSolitaire` (futuristic card deck). `slidingPuzzle` rarely benefits.
