## Art Concept: Flat Minimal

**Activation gate**: `gameArtTier.concept === 'flatMinimal'`.

### Palette identity

A constrained Material/iOS-derived palette — single dominant tone plus one or two accents on a near-white background.

| Slot | Tone |
|---|---|
| Primary | Single dominant hue (sky / sage / sand). Saturated mid-tone, never muddy, never neon. |
| Accent | One reserved highlight color for the active / chosen / scored cell. Used sparingly — accent reuse is the visual hierarchy. |
| Danger | Soft alert red or amber — desaturated relative to the dominant tone so the calm is preserved. |
| Background | Off-white or pale tint (#FAFAFA / very-light dominant-tone variant). Pure black is rare; deep navy / charcoal substitutes when contrast is needed. |

The palette ratio: dominant ~60%, background near-white ~30%, accent ~10%. The overall feel is "modern app store" — the shapes do the storytelling, not the color.

### Silhouette

- **Weight**: light. Round shapes, soft edges, generous interior whitespace.
- **Complexity**: simple — large readable forms, minimal interior detail. Designed to be legible at small grid cells.
- **Edge style**: rounded corners (border-radius around 12–24% of the cell dimension), 1–2 px outline at the rendered resolution. Hard square corners feel hostile here.

### Lighting tone

- **Light source**: even, ambient. No single directional source.
- **Shadow policy**: subtle drop-shadow (~4–8 px blur, low opacity ~10–15%) for elevation cues on cards / panels; never deep cast shadow.
- **Atmospherics**: none — flat-minimal is a UI tone, atmospheric haze breaks the cleanliness. Ambient sparkle on success states is acceptable.

### Motion tone

- **Tempo**: ease-out tweens, sub-200ms for micro-interactions, ~300ms for state transitions. No bounce on idle.
- **Scale**: expressive on win moments (gentle scale-up + opacity-pulse), restrained on idle.
- **Idle**: hover lifts the surface 1–2 px via shadow; never a moving sprite.

### Reference cluster (text references only)

- Two Dots, Threes (match-class minimal references).
- iOS Reminders / Apple Photos (UI reference for elevation + spacing).
- Linear / Notion (digital-product reference for the typographic hierarchy).

### Outputs and code-time consequences

- Token palette favors HSL with a high-lightness background floor (≥ 95%) and a saturated dominant primary (~50% lightness).
- Inline css fills (gradients, rounded rects, drop-shadow filters) dominate — flat-minimal rarely needs intricate svg.
- HUD elements use ease-out tween tokens; hover / tap feedback is restrained.

### HUD layout defaults (D28 — concept-derived)

When emitting `game-art-tokens.json` HUD tokens or `game-art-spec.json` `hud` / `menu` / `dialog` categories, default to:

- **Spacing rhythm**: `balanced8pt` — symmetric padding around HUD panels, comfortable score / move-count readouts. Tight `compact8pt` is acceptable; airy `airy8pt` reads slightly luxurious for this tone.
- **Surface treatment**: `soft` (drop-shadow elevation) — round corners (12–16px radius), 1px hairline border in a darker tint of the dominant tone. Buttons use lift-on-hover (shadow grows ~2x) and a tiny scale-up on press.
- **Typography weight**: regular-to-medium (400–600), rounded sans-serif (e.g. Inter / Manrope / SF Pro). Bold weights reserved for score numerics and primary buttons. No serif.
- **Border radius**: 12–16px on panels, 8–12px on cells, 999px (pill) only on call-to-action buttons. Sharp 0–4px corners read hostile against the soft palette.
- **Focus ring / interaction tone**: subtle — 2px accent-color outline on focus, 200ms color-fade on hover, no scale changes on idle. Restrained delight reserved for win-state.

### Genre affinity (guidance, not a hard gate)

`flatMinimal` is the most domain-agnostic of the 5 concepts. It pairs naturally with `match3` (clean gem look), `slidingPuzzle` (Material crate aesthetic), `cardSolitaire` (modern phone-app solitaire), and `crowdRunner` (modern hyper-casual look — bold flat units / gates / threats with high silhouette contrast). It is also the safe default when the LLM is unsure — its calm tone refuses to overstate any genre.
