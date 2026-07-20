## Art Concept: Cel Toon

**Activation gate**: `gameArtTier.concept === 'celToon'`.

A cel-shaded cartoon/anime direction — bold outlines and flat color blocks that read like animated cel frames.

### Palette identity

Saturated, cheerful flat blocks with clear value separation.

| Slot | Tone |
|---|---|
| Primary | A vivid saturated hue; secondary blocks stay equally punchy. |
| Accent | A contrasting pop color for highlights and action. |
| Danger | Bright warning red, unambiguous against the flats. |
| Background | Clean sky/scene tones, sometimes with a soft gradient sky. |

Each surface is 2–3 flat value zones (base, shadow, occasional highlight) — no smooth gradients within a form.

### Silhouette

- **Weight**: medium. Confident, exaggerated proportions with clear read.
- **Complexity**: moderate — expressive but not fussy; detail lives in shape, not texture.
- **Edge style**: bold uniform ink outline (constant or slightly tapered), crisp interior shadow-shape boundaries.

### Lighting tone

- **Light source**: a single clear key defining a hard shadow terminator (the cel break).
- **Shadow policy**: flat shadow shapes — one darker value, hard edged. No soft falloff.
- **Atmospherics**: minimal — clarity and energy over mood haze.

### Motion tone

- **Tempo**: snappy with anticipation and squash-stretch; animation-forward.
- **Scale**: expressive — poses hold, then pop.

### Reference cluster (text references only)

- Cel-shaded action games; anime-styled fighters and adventures; toon-rendered 3D.

### Outputs and code-time consequences

- Flat fills + hard-edged shadow overlays; a consistent outline stroke on entities.
- SVG uses solid fills with a distinct stroke; shadow is a second flat shape, not a blur.
- `both` — cel shading is classically a 3d rendering technique and equally a 2d anime discipline.

### HUD layout defaults (D28 — concept-derived)

- **Spacing rhythm**: `balanced8pt` — energetic but readable.
- **Surface treatment**: `soft` with a visible outline — panels carry the same ink-line language as entities.
- **Typography weight**: bold rounded/geometric sans (600–800) for punch; medium body.
- **Border radius**: 8–16px, outlined.
- **Focus ring / interaction tone**: a bold outline thickening + quick scale-pop on select; expressive hover.
