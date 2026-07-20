## Art Concept: Neon Synth

**Activation gate**: `gameArtTier.concept === 'neonSynth'`.

A dark-ground, emissive-neon direction — synthwave / cyber glow where light lines carry the whole image.

### Palette identity

Near-black canvas with a small set of high-energy emissive hues.

| Slot | Tone |
|---|---|
| Primary | An electric neon (cyan / magenta / hot pink), used as glowing stroke. |
| Accent | A complementary neon for contrast and secondary glow. |
| Danger | Neon red/orange that reads as alarm against the dark. |
| Background | Deep near-black or dark indigo; optional subtle grid / horizon. |

Ratio: dark field ~70%, neon lines ~20%, deep accent ~10%. Color IS light here.

### Silhouette

- **Weight**: minimal. Stroke-first forms — 1–3px glowing outlines rather than filled mass.
- **Complexity**: simple — clean geometric contours, wireframe-adjacent.
- **Edge style**: anti-aliased stroke with an outer glow halo; fills are dark or absent.

### Lighting tone

- **Light source**: emissive — each shape is its own light. Shadows are GLOWS (spread), not occlusion.
- **Shadow policy**: outer glow / bloom around strokes; optional scanline / CRT overlay.
- **Atmospherics**: embraced — haze, grid horizon, chromatic edge shimmer.

### Motion tone

- **Tempo**: snappy linear with an after-image trail; sub-200ms recovery.
- **Scale**: pulsing glow (±10% intensity) on idle; sharp flash on action.

### Reference cluster (text references only)

- Synthwave / retrowave visuals; neon-vector arcade; cyber-grid aesthetics.

### Outputs and code-time consequences

- CSS `box-shadow` / `text-shadow` glow stacks and SVG stroke + blur filters carry the look; fills stay dark.
- Emissive treatment means high foreground/background contrast — accessibility of text over glow needs care.
- `both` — a 2d neon grid or a 3d wireframe both express the emissive language.

### HUD layout defaults (D28 — concept-derived)

- **Spacing rhythm**: `compact8pt` — tight, technical readouts.
- **Surface treatment**: `tinted` — dark translucent panels with a glowing hairline edge.
- **Typography weight**: techno / mono display (500–700); glowing headings, restrained body.
- **Border radius**: 0–4px — sharp, circuit-like.
- **Focus ring / interaction tone**: an intensified glow / neon flash on focus; instant color pop, no soft fade.
