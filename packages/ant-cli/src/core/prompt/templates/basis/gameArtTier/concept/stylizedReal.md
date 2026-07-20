## Art Concept: Stylized Realistic

**Activation gate**: `gameArtTier.concept === 'stylizedReal'`.

A semi-realistic, stylized direction — naturalistic proportion and light, pushed slightly for readability and mood (fantasy-realism).

### Palette identity

Naturalistic color with a curated, slightly heightened mood.

| Slot | Tone |
|---|---|
| Primary | A grounded natural hue (steel / forest / stone) tuned for material believability. |
| Accent | A curated warm or cool pop for focus and magic/tech emphasis. |
| Danger | A believable but heightened red/amber threat tone. |
| Background | Layered environmental tones with atmospheric depth and value hierarchy. |

Color reads as lit material, not flat symbol — value and temperature separate planes in depth.

### Silhouette

- **Weight**: substantial and grounded. Believable proportion with clear read.
- **Complexity**: detailed — material contrast (metal / cloth / skin / terrain) matters, kept readable.
- **Edge style**: soft naturalistic edges with rim light; no outline.

### Lighting tone

- **Light source**: a physically-plausible key + fill + ambient; volumetric where mood calls for it.
- **Shadow policy**: soft graded shadows, contact occlusion, believable falloff.
- **Atmospherics**: embraced — fog, depth haze, god-rays, particulate.

### Motion tone

- **Tempo**: weighted, physically-grounded easing with momentum and follow-through.
- **Scale**: measured — grand on set-pieces, naturalistic otherwise.

### Reference cluster (text references only)

- Stylized-realistic action-RPGs; fantasy-realism environments; believable-but-heightened adventure worlds.

### Outputs and code-time consequences

- **Minimal-guide caveat**: realistic rendering is beyond pure code primitives — this concept's value is a HANDOFF / DESIGN.md seed (full art direction; real models/textures placed by the user). Greenfield code approximates only the DIRECTION (naturalistic palette, soft volumetric light, grounded shapes) under the minimum-playable floor.
- Palette via layered gradients + soft shadow/occlusion; depth via atmospheric value separation.
- `3d` — believable material and light presuppose a real camera, light, and depth.

### HUD layout defaults (D28 — concept-derived)

- **Spacing rhythm**: `balanced8pt` — grounded, functional.
- **Surface treatment**: `tinted` — semi-translucent panels reading as glass/metal, soft depth shadow.
- **Typography weight**: clean humanist or industrial sans (400–700); legible over busy scenes.
- **Border radius**: 4–10px, restrained.
- **Focus ring / interaction tone**: a subtle material highlight / soft glow on focus; smooth weighted transitions.
