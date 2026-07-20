## Art Concept: Painted Fantasy

**Activation gate**: `gameArtTier.concept === 'paintedFantasy'`.

A hand-painted, illustrated high-fantasy direction — the classic role-playing look of jewel palettes, ornate forms, and dramatic light.

### Palette identity

Rich, layered color with painterly depth — jewel tones grounded by earthen neutrals.

| Slot | Tone |
|---|---|
| Primary | A deep jewel hue (sapphire / emerald / royal purple) anchoring the world. |
| Accent | Gilded gold / warm brass for magic, treasure, and emphasis. |
| Danger | Ember red / crimson, glowing against darker surrounds. |
| Background | Earthen and shadowed tones (stone, moss, dusk) with atmospheric gradation. |

Color transitions blend rather than step — surfaces feel painted, with soft value ramps and glazed highlights.

### Silhouette

- **Weight**: substantial. Ornate, detailed forms with heraldic / decorative motifs.
- **Complexity**: detailed — filigree, texture, and material contrast (metal / cloth / stone) read within the form.
- **Edge style**: soft painted edges with occasional rim light; no hard vector outline.

### Lighting tone

- **Light source**: a strong directional key with warm/cool interplay; chiaroscuro contrast.
- **Shadow policy**: soft graded shadows and ambient occlusion in the crevices; glow around magical elements.
- **Atmospherics**: embraced — haze, god-rays, dust, torchlight bloom set the mood.

### Motion tone

- **Tempo**: weighted, deliberate — motion has heft and follow-through.
- **Scale**: grand on spell/impact moments; slow ambient drift (banners, embers) otherwise.

### Reference cluster (text references only)

- Painted RPG key art; illustrated tabletop-fantasy sourcebooks; high-fantasy adventure splash screens.

### Outputs and code-time consequences

- **Minimal-guide caveat**: pure code primitives cannot render production-grade painted art. This concept's highest value is as a HANDOFF / DESIGN.md seed (full art direction, real assets placed by the user). Greenfield code approximates the DIRECTION only — jewel gradients, dramatic directional shading, ornate-leaning shapes — under the minimum-playable floor.
- Palette expressed as multi-stop gradients + soft shadow filters; SVG favors layered fills over flat shapes.
- `both` — a painted look suits a 2d illustrated plane or a 3d textured scene.

### HUD layout defaults (D28 — concept-derived)

- **Spacing rhythm**: `balanced8pt` — framed, slightly ornate panels.
- **Surface treatment**: `borderedSoft` — parchment / carved-stone panels, gilded hairline borders, soft inner shadow.
- **Typography weight**: serif or high-contrast display for headings (500–700); readable serif/humanist body.
- **Border radius**: 6–10px with decorative corner accents permitted.
- **Focus ring / interaction tone**: a warm gold glow / illuminated border on focus; deliberate weighted transitions.
