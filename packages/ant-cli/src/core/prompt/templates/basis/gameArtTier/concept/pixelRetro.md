## Art Concept: Pixel Retro

**Activation gate**: `gameArtTier.concept === 'pixelRetro'`.

### Palette identity

8 / 16-bit-era palette — explicitly limited color count, hand-tuned ramps, and a deliberate "console era" feel.

| Slot | Tone |
|---|---|
| Primary | A constrained palette of 4–32 colors total. Each game commits a fixed palette and stays inside it. |
| Accent | Reserved palette slots for important entities (player, key collectible, danger). Accent reuse is deliberate. |
| Danger | Bright reds or hazard yellows from the same palette — never an out-of-palette color. |
| Background | Tile-friendly mid-tones; large background expanses use 2 or 3 colors only to simulate compression. |

Sub-styles:

- **NES era** (4-color sub-palettes per sprite, ~25 unique on screen).
- **SNES / Genesis era** (15–256 colors, dithered ramps).
- **Game Boy era** (4-shade greenscale or DMG monochrome).

Pick one sub-style and commit — switching mid-project breaks the aesthetic promise.

### Silhouette

- **Weight**: medium. Characters are 16×16 to 64×64 pixels; readability comes from silhouette shape, not interior detail.
- **Complexity**: low-pixel-count by definition. Anti-aliasing is forbidden; pixels are placed deliberately.
- **Edge style**: hard, jagged — pixel-perfect. Sub-pixel positioning is forbidden (use integer transforms).

### Lighting tone

- **Light source**: simulated via dithering and palette ramps. No real-time lighting.
- **Shadow policy**: dithered or single-color drop. Soft shadows are out of style.
- **Atmospherics**: 2D parallax layers, scanline filters (optional, applied at presentation layer).

### Motion tone

- **Tempo**: stepped — sprite frames at 8–24 fps, deliberately discrete. Smooth tweening is forbidden.
- **Scale**: limited by frame count. Expressive moments need extra frames in the catalog.
- **Idle**: 2- to 4-frame loops. Idle "breath" is two-frame swap, not smooth oscillation.

### Reference cluster (text references only)

- Stardew Valley, Celeste, Shovel Knight (modern pixel-retro touchstones).
- Mega Man, Castlevania (era references for silhouette).
- Game Boy library (style reference for palette discipline).

### Outputs and code-time consequences

- Token palette MUST commit a fixed color count — enforce as a JSON list, not a freeform string.
- Inline svg is unusual for pixel-retro; assets are typically `kind: 'external'` raster files (`.png`) at the chosen resolution.
- Sub-pixel rendering settings (CSS `image-rendering: pixelated`) MUST be set on render targets.
- Animations advance integer frames — no floating-point tween between sprite frames.

### HUD layout defaults (D28 — concept-derived)

When emitting `game-art-tokens.json` HUD tokens or `game-art-spec.json` `hud` / `menu` / `dialog` categories, default to:

- **Spacing rhythm**: `compact8pt` (or even tighter — 4pt grid) — pixel-era HUDs were dense by hardware necessity. Airy whitespace breaks the era promise.
- **Surface treatment**: `solid` (flat opaque backgrounds, hard borders, no shadows) — the era predates drop-shadow / blur. Dithered borders allowed.
- **Typography weight**: bitmap fonts (e.g. Press Start 2P / VT323 / monogram) — pixel-perfect at the chosen resolution. Anti-aliased fonts break the aesthetic; reject system sans-serif.
- **Border radius**: 0px — sharp square corners. Rounded panels are anachronistic. (The single exception: tile-perfect 1-pixel chamfers if the era supports it, e.g. Game Boy.)
- **Focus ring / interaction tone**: raw-instant — single-frame state swap on press (no transition), 2-frame blink on focus. Smooth tween is forbidden; everything is discrete.
