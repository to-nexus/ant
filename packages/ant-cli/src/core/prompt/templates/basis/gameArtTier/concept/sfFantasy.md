## Art Concept: SF Fantasy

**Activation gate**: `gameArtTier.concept === 'sfFantasy'`.

### Palette identity

Hybrid sci-fi + fantasy palette — saturated technological hues sit alongside organic / arcane warm tones.

| Slot | Tone |
|---|---|
| Primary | Deep teal, indigo, plasma violet — readable as "high-tech" or "cosmic". |
| Accent | Holographic cyan, plasma magenta, emerald arcane glow — applied to tech surfaces and magical signals. |
| Danger | Hot pink, hazard orange, warning red — reserved for damage, alerts, system failures. |
| Background | Star-fields, nebula gradients, alien biomes — never earth-like, often gradient-heavy. |

Saturation budget is generous — SF Fantasy lets neon and starlight coexist with arcane warm light, but avoids muddy mid-tones.

### Silhouette

- **Weight**: medium. Characters mix organic and mechanical forms — capes plus pauldrons, robes plus visors.
- **Complexity**: detailed at character scale; environments balance silhouette density with negative space (cosmic voids).
- **Edge style**: mixed — clean tech edges (panels, antennae) on top of organic curves (cloth, biomass).

### Lighting tone

- **Light source**: emissive surfaces (panels, runes, plasma), star-fields, distant suns.
- **Shadow policy**: soft, often layered with rim-light. Pure black is rare — even shadow zones glow faintly.
- **Volumetrics**: nebula gradient, atmospheric scatter, particle dust. The world rarely reads as "dry".

### Motion tone

- **Tempo**: snappy on tech action (charge → fire → recoil), gradual on arcane (chant, summon). Two tempos coexist.
- **Scale**: expressive — particles, energy trails, holographic warp.
- **Idle**: emissive surfaces pulse / shimmer; capes drift in low gravity.

### Reference cluster (text references only)

- Mass Effect — armored protagonists in star-lit environments.
- Destiny — cosmic palette with rune accents.
- Final Fantasy XIV / XV — high-fantasy materials with synthetic accents.
- Heavy Metal magazine illustrations (style reference for hybrid silhouettes).

### Outputs and code-time consequences

- Token palette MUST allow at least one emissive accent slot — the concept depends on glow.
- Inline svg payloads use gradient fills more often than flat fills.
- Particle effects (Phase 4 axis) trend toward `light` or `heavy` profile, never `none`.
