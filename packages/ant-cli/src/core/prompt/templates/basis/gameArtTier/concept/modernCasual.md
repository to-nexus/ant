## Art Concept: Modern Casual

**Activation gate**: `gameArtTier.concept === 'modernCasual'`.

### Palette identity

Bright, playful palette tuned for mobile / web — saturated primaries and friendly secondaries on light backgrounds.

| Slot | Tone |
|---|---|
| Primary | Sky blue, mint green, sunshine yellow, candy pink — saturated mid-tones, never muddy. |
| Accent | Coral, lavender, lime — palette extension for highlights and rewards. |
| Danger | Hazard yellow, alert red — used at lower saturation than dark-toned genres so the friendly tone is preserved. |
| Background | White, pastel sky, pastel grass — backgrounds rarely fall below 70% lightness. |

The palette ratio: saturated primaries ~50%, accent secondaries ~30%, near-white backgrounds ~20%. Black is rare; deep navy / charcoal substitutes when contrast is needed.

### Silhouette

- **Weight**: light. Round characters, soft props, no menacing edges.
- **Complexity**: simple — large readable shapes, minimal interior detail. Designed for small screens.
- **Edge style**: rounded, generous outlines (1–3 px stroke at 1080p). Sharp corners feel hostile.

### Lighting tone

- **Light source**: even, sky-lit. Almost never directional / dramatic.
- **Shadow policy**: soft drop-shadows for elevation cues; cast shadows are subtle and never deep.
- **Atmospherics**: confetti, sparkle, soap-bubble pop — playful FX rather than dust / mist.

### Motion tone

- **Tempo**: snappy, bouncy. Squash-and-stretch on impact; quick recovery so the next interaction is fast.
- **Scale**: expressive on win moments (confetti, scale-up), restrained on idle.
- **Idle**: gentle bobbing, blink eyes, sparkle accents on important UI.

### Reference cluster (text references only)

- Candy Crush, Royal Match (match-3 reference).
- Subway Surfers, Temple Run (endless runner reference).
- Animal Crossing (style reference for friendly silhouettes, color palette).
- Among Us (style reference for simple high-contrast character shapes).

### Outputs and code-time consequences

- Token palette favors HSL with high lightness floor — no value goes below 25% lightness for primaries.
- Inline css fills (gradients, rounded rects) dominate — modern casual rarely needs intricate svg.
- HUD elements use bouncy animation tokens; hover / tap feedback is exaggerated.

### HUD layout defaults (D28 — concept-derived)

When emitting `game-art-tokens.json` HUD tokens or `game-art-spec.json` `hud` / `menu` / `dialog` categories, default to:

- **Spacing rhythm**: `airy8pt` — generous padding between HUD panels, breathable score / coin readouts. Tight density (compact / dense) feels hostile to the friendly tone.
- **Surface treatment**: `soft` (drop-shadow elevation) or `glassLight` (frosted overlay) — round corners (≥ 12px radius), no hard borders. Buttons use scale-up (~5%) on hover, bouncy spring on press.
- **Typography weight**: medium-bold (600–700), rounded sans-serif (e.g. Nunito / Quicksand family). Avoid serif or display weights — they conflict with the playful silhouette.
- **Border radius**: 12–24px on panels, 999px (pill) on action buttons. Sharp 0–4px corners read hostile.
- **Focus ring / interaction tone**: expressive — visible scale-up + saturation bump on hover, micro-bounce on press, confetti / sparkle accent on success states.
