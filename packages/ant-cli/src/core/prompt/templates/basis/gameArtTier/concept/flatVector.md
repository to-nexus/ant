## Art Concept: Flat Vector

**Activation gate**: `gameArtTier.concept === 'flatVector'`.

This is the most domain-agnostic concept — the safe default when the art direction is unstated or deliberately clean.

### Palette identity

A constrained, confident palette built on solid fills — no gradients doing the storytelling.

| Slot | Tone |
|---|---|
| Primary | A single saturated mid-tone hue carries the identity. Never muddy, never neon. |
| Accent | One reserved highlight for the active / chosen / scored element. Accent scarcity IS the hierarchy. |
| Danger | Alert red or amber, desaturated enough to sit inside the palette. |
| Background | Near-white or a pale tint; deep neutral substitutes when contrast demands it. |

Ratio guidance: dominant ~60%, background ~30%, accent ~10%. Shapes carry meaning; color stays disciplined.

### Silhouette

- **Weight**: light. Large readable forms, generous interior whitespace.
- **Complexity**: simple — minimal interior detail, legible at small sizes.
- **Edge style**: crisp vector edges; rounded corners (12–24% of the element) OR hard geometric corners, chosen once and held. A thin uniform outline is optional.

### Lighting tone

- **Light source**: even, ambient. No directional key light.
- **Shadow policy**: at most a subtle elevation drop-shadow on layered surfaces; never a cast shadow.
- **Atmospherics**: none — flatness is the point.

### Motion tone

- **Tempo**: ease-out tweens, sub-200ms micro-interactions, ~300ms state transitions.
- **Scale**: expressive on resolution moments (scale-up + opacity pulse), restrained on idle.

### Reference cluster (text references only)

- Minimal digital-product aesthetics; flat editorial illustration; clean mobile game UI.

### Outputs and code-time consequences

- Palette favors HSL with a high-lightness background floor and one saturated primary.
- Inline CSS fills (solid, occasional flat gradient, rounded rects) dominate; intricate SVG is rarely needed.
- Renders cleanly in both `2d` and `3d` (flat-shaded primitives) — perspective-agnostic.

### HUD layout defaults (D28 — concept-derived)

When emitting `game-art-tokens.json` HUD tokens or `game-art-spec.json` `hud` / `menu` / `dialog` categories, default to:

- **Spacing rhythm**: `balanced8pt` — comfortable symmetric padding around HUD panels.
- **Surface treatment**: `soft` — subtle elevation, 12–16px radius, hairline border in a darker tint of the dominant tone.
- **Typography weight**: regular-to-medium (400–600), rounded/geometric sans-serif. Bold reserved for numerics and primary buttons. No serif.
- **Border radius**: 12–16px panels, 8–12px cells, pill only on primary CTAs.
- **Focus ring / interaction tone**: 2px accent-color outline on focus, 200ms color-fade on hover, no idle scale changes.
