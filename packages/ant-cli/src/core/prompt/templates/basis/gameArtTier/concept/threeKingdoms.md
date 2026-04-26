## Art Concept: Three Kingdoms

**Activation gate**: `gameArtTier.concept === 'threeKingdoms'`.

### Palette identity

Classical Eastern epic palette — earth-toned with banner-color accents drawn from heraldic schemes.

| Slot | Tone |
|---|---|
| Primary | Ink black, parchment cream, weathered bronze — the world reads as ancient, hand-recorded. |
| Accent | Heraldic red, imperial gold, jade green, deep blue — banner colors used to mark factions and importance. |
| Danger | Heraldic red used at higher saturation, or fresh-blood crimson on weapon edges. |
| Background | Mountain mist, river silt, paddy-field green — landscapes painted as ink-wash, not photo-real. |

The palette ratio favors earth tones (~70%), with heraldic accents reserved for faction identity (~25%), and danger spikes (~5%).

### Silhouette

- **Weight**: medium-heavy. Armored generals and cavalry dominate; common troops are simpler.
- **Complexity**: detailed at character scale, especially helms / banners / weapons; landscape silhouettes simplify to ink-wash strokes.
- **Edge style**: brush-stroke inflected — silhouettes hint at calligraphy edges, not vector-clean.

### Lighting tone

- **Light source**: dawn / dusk sun (low-angle, warm), torch-lit interiors, banner shadow.
- **Shadow policy**: long, low-angle shadows. Interior scenes use single-source torchlight with deep falloff.
- **Atmospherics**: morning mist, smoke, dust — battlefield air is rarely clear.

### Motion tone

- **Tempo**: gradual on parley / strategy beats; sudden on cavalry charge / duel impact.
- **Scale**: expressive on duels (dust kick, banner sway, slow-motion flourish), measured on troop movement.
- **Idle**: banners ripple, robes drift, smoke curls.

### Reference cluster (text references only)

- Romance of the Three Kingdoms (Koei Tecmo series) — banner-driven faction visuals.
- Total War: Three Kingdoms — battlefield ink-wash transitions.
- Akira Kurosawa films (style reference for cavalry framing and dust).
- Song-dynasty landscape paintings (style reference for environment silhouette).

### Outputs and code-time consequences

- Token palette includes a faction-color slot — multiple accent values, not a single accent.
- Inline svg payloads favor brush-stroke filters over flat fills.
- Banner / flag entities are likely catalog members; HUD chrome reads as parchment scroll.

### HUD layout defaults (D28 — concept-derived)

When emitting `game-art-tokens.json` HUD tokens or `game-art-spec.json` `hud` / `menu` / `dialog` categories, default to:

- **Spacing rhythm**: `balanced8pt` — moderate density. Strategy panels need information-dense readouts (army strength / supply / morale) but the ink-wash atmosphere wants breathing room.
- **Surface treatment**: `borderedSoft` (parchment frame with brush-stroke inner edge) — paper / wood / banner textures. Glass / chrome surfaces are anachronistic.
- **Typography weight**: regular-medium body, bold display for titles. Serif or brush-script display fonts for headers (e.g. Noto Serif CJK / Ma Shan Zheng). HUD numerics in clean serif — never pixel / monospace.
- **Border radius**: 2–6px panels (parchment edge softness), 0–4px buttons. Avoid pill shapes — they read as modern.
- **Focus ring / interaction tone**: calm-premium — slow ink-bloom on hover, brush-stroke underline on focus, banner-sway micro-animation on confirmation. Restrained tempo matches the strategic genre.
