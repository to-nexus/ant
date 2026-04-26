## Art Concept: Martial Arts

**Activation gate**: `gameArtTier.concept === 'martialArts'`.

### Palette identity

Wuxia-inflected palette — robe-color accents on misty mountain backgrounds, with chi / energy hues for ability work.

| Slot | Tone |
|---|---|
| Primary | Pearl white, jade green, charcoal grey, deep blue — read as "robe" / "stone" / "running water". |
| Accent | Vermillion red, gold leaf, lapis blue — sash / ribbon / weapon-aura colors. |
| Danger | Crimson chi-energy, blood-edge red — reserved for finishing moves and fatal hits. |
| Background | Mountain mist, bamboo green, cloud-sea white — vertically layered atmospherics. |

Saturation is moderate; the palette emphasizes graceful contrast over high punch. Chi / aura accents pulse rather than blare.

### Silhouette

- **Weight**: light to medium. Robes and sashes flow; characters read as agile, not massive.
- **Complexity**: detailed at character scale via cloth folds and weapon trails; environments simplify to layered atmospherics.
- **Edge style**: smooth, curving — flowing cloth and water-like movement; hard angular edges feel wrong.

### Lighting tone

- **Light source**: filtered sunlight through canopies / mist, lantern light, chi-aura emission.
- **Shadow policy**: soft, atmospheric. Hard shadows reserved for blade-strike moments.
- **Atmospherics**: vertical mist layers, falling petals, dust trails behind quick movement.

### Motion tone

- **Tempo**: contrast-driven — long held poses punctuated by sudden, fluid bursts of motion.
- **Scale**: expressive on technique (wide arcs, aerial dashes, after-image trails), still on stance.
- **Idle**: sashes flutter, hair drifts, robes settle.

### Reference cluster (text references only)

- Crouching Tiger Hidden Dragon (style reference for aerial choreography).
- Sekiro: Shadows Die Twice (martial pacing in a darker palette).
- Sifu (modern beat-em-up grounded in martial movement).
- Classical Chinese landscape painting (style reference for atmospherics).

### Outputs and code-time consequences

- Token palette includes a chi / aura emissive slot — used for ability work.
- Motion tokens favor extended after-image / trail effects (Phase 4 axis: `motionPattern = expressive`).
- HUD chrome reads as scroll / lantern, with calligraphic glyphs.
