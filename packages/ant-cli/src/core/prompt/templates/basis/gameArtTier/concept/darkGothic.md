## Art Concept: Dark Gothic

**Activation gate**: `gameArtTier.concept === 'darkGothic'`.

A high-contrast, desaturated, dramatic direction — gothic ink and shadow, dark-fantasy and horror mood.

### Palette identity

Mostly dark and desaturated, punctuated by a single ominous accent.

| Slot | Tone |
|---|---|
| Primary | A near-monochrome dark base (charcoal / oxblood / deep slate). |
| Accent | One sinister highlight (blood crimson / sickly green / bone white). |
| Danger | The accent intensifies — glowing threat against the murk. |
| Background | Deep shadow with heavy vignette; light is scarce and pooled. |

Low saturation overall; the accent's scarcity makes it menacing. Contrast is dramatic, values crushed toward the dark.

### Silhouette

- **Weight**: heavy and angular, or gnarled and organic. Strong readable dark silhouettes.
- **Complexity**: moderate-to-detailed — texture in shadow, ink hatching, jagged edges.
- **Edge style**: harsh inked contours or scratchy strokes; rim light separates form from murk.

### Lighting tone

- **Light source**: a single dramatic key from an oblique angle; deep chiaroscuro.
- **Shadow policy**: dominant — shadow is the default state, light is the exception. Heavy vignette.
- **Atmospherics**: embraced — fog, grain, ink spatter, candle/ember pooling.

### Motion tone

- **Tempo**: weighted and deliberate, occasionally jarring (horror punctuation).
- **Scale**: restrained ambient dread; sharp on scares/impacts.

### Reference cluster (text references only)

- Gothic ink-illustration roguelikes; dark-fantasy horror; high-contrast silhouette platformers.

### Outputs and code-time consequences

- Crushed-value palette with heavy vignette gradients + grain overlay; SVG favors jagged inked shapes and hatching.
- Ensure interactive elements clear the accessibility floor despite the low-light scheme (the accent must stay legible).
- `both` — 2d inked plane or 3d moody scene; both live on shadow-dominant contrast.

### HUD layout defaults (D28 — concept-derived)

- **Spacing rhythm**: `compact8pt` — tense, dense readouts.
- **Surface treatment**: `tinted` — dark translucent panels with a sharp inked border; heavy inner shadow.
- **Typography weight**: gothic/blackletter or high-contrast serif display for headings; restrained body.
- **Border radius**: 0–4px — sharp, austere.
- **Focus ring / interaction tone**: a stark accent-color edge on focus; abrupt, weighted transitions — no soft delight.
