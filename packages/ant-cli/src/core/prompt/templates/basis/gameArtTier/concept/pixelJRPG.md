## Art Concept: Pixel JRPG

**Activation gate**: `gameArtTier.concept === 'pixelJRPG'`.

A lush 16-bit role-playing pixel aesthetic — richer than arcade pixel, built for worlds and characters rather than a single board.

### Palette identity

A wider pixel palette (roughly 16–48 colors) organized into jewel and earth families.

| Slot | Tone |
|---|---|
| Primary | A jewel tone (deep teal / royal blue / emerald) for hero and key UI. |
| Accent | Warm gold / amber for treasure, selection, and emphasis. |
| Danger | Blood red or ember for damage and threat. |
| Background | Layered earth and sky tones supporting parallax depth. |

Ramps have several shade steps per hue so sprites read as volumetric within the pixel grid.

### Silhouette

- **Weight**: medium. Distinct character/entity silhouettes with recognizable proportions.
- **Complexity**: moderate — interior detail (armor, foliage, tiles) within a controlled pixel budget.
- **Edge style**: clean pixel edges with selective anti-alias-by-hand (manual dithered ramps), tile-aligned.

### Lighting tone

- **Light source**: a soft implied key, expressed through baked ramp shading and warm/cool separation.
- **Shadow policy**: contact shadows as dithered ovals; parallax layers carry atmospheric depth.
- **Atmospherics**: gentle — weather, time-of-day tints, layered background parallax are welcome.

### Motion tone

- **Tempo**: expressive sprite animation — walk cycles, idle breathing, spell/effect flourishes.
- **Scale**: dramatic on key moments (level-up, cast), calm ambient looping otherwise.

### Reference cluster (text references only)

- 16-bit console RPGs; parallax overworlds; expressive spell and portrait spritework; HD-2D revival lighting.

### Outputs and code-time consequences

- Integer-pixel rendering with square pixels; layered parallax backgrounds when depth is implied.
- Palette shading via ramp steps, not real-time light; portraits/entities carry hand-shaded volume.
- `2d` only — the sprite-plane discipline defines the look (pseudo-3D depth comes from parallax, not a 3D camera).

### HUD layout defaults (D28 — concept-derived)

- **Spacing rhythm**: `balanced8pt` — framed menu windows with comfortable readouts.
- **Surface treatment**: `borderedSoft` — decorative bordered panels (menu-window feel), subtle inner shade.
- **Typography weight**: readable pixel/bitmap serif-or-slab display for headings, clean pixel body. Warm and legible.
- **Border radius**: 4–8px on window frames; ornamental corner treatment acceptable.
- **Focus ring / interaction tone**: a moving selection cursor / highlight sweep on the active menu row; snappy confirm.
