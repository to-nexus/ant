## Art Concept: Pixel Arcade

**Activation gate**: `gameArtTier.concept === 'pixelArcade'`.

An 8-bit arcade pixel aesthetic — bold, punchy, committed to the grid.

### Palette identity

A hard limited palette (roughly 8–16 colors), fixed and reused with discipline.

| Slot | Tone |
|---|---|
| Primary | A saturated arcade hue (electric blue / hot red / bright green). |
| Accent | A complementary bright reserved for scoring / power states. |
| Danger | Pure warning red inside the limited ramp. |
| Background | A flat dark or single-tone field so foreground pixels pop. |

Colors are chosen from a small committed ramp; dithering — not blending — bridges tones.

### Silhouette

- **Weight**: bold. Chunky readable blocks, strong 1-color contours.
- **Complexity**: simple — forms read at 16×16–48×48 pixel scale.
- **Edge style**: hard jagged pixel edges, no anti-aliasing, pixel-perfect alignment.

### Lighting tone

- **Light source**: implied, not simulated — highlight/shadow are separate palette ramp steps.
- **Shadow policy**: single-color drop pixels or dithered shade, never soft blur.
- **Atmospherics**: none — clarity over mood.

### Motion tone

- **Tempo**: stepped, discrete frames (8–16fps feel). Tweening between positions is avoided; snap to whole pixels.
- **Scale**: 2–4 frame loops for idle; punchy instant swaps on action.

### Reference cluster (text references only)

- 8-bit arcade cabinets; NES-era platformers and shooters; chiptune-adjacent visual energy.

### Outputs and code-time consequences

- Integer-pixel rendering: snap all coordinates to whole pixels; use integer zoom so pixels stay square.
- CSS `image-rendering: pixelated`; SVG shapes are blocky rectangles, not smooth paths.
- `2d` only — pixel art is a flat-plane discipline.

### HUD layout defaults (D28 — concept-derived)

- **Spacing rhythm**: `compact8pt` (or 4pt) — tight arcade readouts.
- **Surface treatment**: `solid` — no shadow, no blur; flat filled panels with 1px hard borders.
- **Typography weight**: bitmap / pixel display fonts, single weight. No smooth anti-aliased type.
- **Border radius**: 0px — sharp corners only.
- **Focus ring / interaction tone**: raw instant single-frame swaps; blink or hard color flip on select, no fades.
