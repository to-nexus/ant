## Art Concept: Dark Fantasy

**Activation gate**: `gameArtTier.concept === 'darkFantasy'`.

### Palette identity

Desaturated, cool-leaning palette with high-contrast accents.

| Slot | Tone |
|---|---|
| Primary | Deep blacks, cool greys, charcoal blues — backgrounds and chrome read as "dim, weathered". |
| Accent | Blood reds, candle ambers, sickly greens — used sparingly to focus the eye on threat or magic. |
| Danger | Bright crimson or arterial red against dim backgrounds — danger reads at a glance. |
| Background | Murky greys, cold purples, mossy greens — atmosphere is heavy, never sunlit. |

The palette ratio is roughly 80% desaturated / 15% chrome / 5% accent. Saturation budget kept tight — saturated areas are intentional focal points.

### Silhouette

- **Weight**: heavy / bold. Characters and props read as massive against the dim ground.
- **Complexity**: detailed at character / prop scale (asymmetric forms, layered cloth, weapon edges); environment silhouettes simplify to keep readability.
- **Edge style**: angular, broken — sharp corners, jagged edges. Soft round shapes feel out of place.

### Lighting tone

- **Light source**: candle, torch, moonlight, occasional magical glow. Never sunlit.
- **Shadow policy**: hard shadow falloff with deep occlusion — characters cast distinct shadows; the world does not feel evenly lit.
- **Ambient occlusion**: present, used to push depth into corners and under props.

### Motion tone

- **Tempo**: gradual, weighty. Animations have wind-up and follow-through.
- **Scale**: expressive — large recovery arcs, dramatic camera shake on impact, slow-motion-friendly.
- **Idle**: subtle — characters breathe slowly, capes drift, banners flap rarely.

### Reference cluster (text references only)

Adjacent tones (cite in design notes, do NOT visually copy):

- Dark Souls / Bloodborne — gothic stone, candle glow, weathered armor.
- Hollow Knight — high-contrast desaturated 2D platformer with accent splashes.
- Diablo I / II — hellish reds against deep bowels.
- Frazetta paintings (style reference for character silhouette weight).

### Outputs and code-time consequences

- `game-art-tokens.json` carries this palette / silhouette / lighting / motion as token values.
- `game-art-assets.json` inline payloads (css / svg) MUST stay within the desaturated palette ranges with rare accent splashes.
- HUD chrome reads as parchment / iron / blood, never glossy plastic.

### HUD layout defaults (D28 — concept-derived)

When emitting `game-art-tokens.json` HUD tokens or `game-art-spec.json` `hud` / `menu` / `dialog` categories, default to:

- **Spacing rhythm**: `compact8pt` — dense layout matching the heavy silhouette / weighty tone. Airy whitespace breaks the gothic mood.
- **Surface treatment**: `borderedSoft` (engraved frames) or `solid` (parchment / iron) — visible edges, layered depth (drop-shadow inside + outside). Never glassy / translucent.
- **Typography weight**: bold (700+) for headers, regular for body. Display serif (e.g. Cormorant / EB Garamond) for titles, monospace or geometric sans for HUD numerics. Avoid friendly rounded fonts.
- **Border radius**: 0–4px panels, 0–2px buttons. Sharp / angular corners reinforce the silhouette identity.
- **Focus ring / interaction tone**: restrained — opacity dim on hover, subtle pulse on focus, hard cut on press (no spring / bounce). State changes feel weighty / deliberate, not playful.
