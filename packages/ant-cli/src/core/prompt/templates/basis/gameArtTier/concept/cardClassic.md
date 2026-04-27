## Art Concept: Card Classic

**Activation gate**: `gameArtTier.concept === 'cardClassic'`.

### Palette identity

The canonical Solitaire tone — green felt table, white card faces, traditional red/black suit pictograms.

| Slot | Tone |
|---|---|
| Primary | Felt green (#1F6F3E / #266B40 — slightly desaturated forest green). Used for the table surface and the empty-stack outlines. |
| Accent | Card-face white (#FFFEF7 — off-white, never sterile pure white) and the red/black suit colors (#C7202F / #1A1A1A). |
| Danger | Crimson (#9C1F2A) or warm gold — used for invalid-move feedback and trophy / win flourishes. |
| Background | Felt green (often with a subtle vignette) or a wood-tone surround if the project wants a "table with chairs" frame. |

The palette ratio: felt green ~50%, card-face white ~30%, suit reds/blacks ~15%, accent gold ~5%. The overall feel is "kitchen-table Sunday" — warm, familiar, never austere.

### Silhouette

- **Weight**: medium — cards are crisp rectangles with a defined edge. Every card has a readable suit pictogram and rank.
- **Complexity**: low to medium — the card face is a flat rectangle with `♠♥♦♣` plus a 2-character rank in two corners. The "court card" face (J / Q / K) may carry a stylized portrait at higher tiers but text-only is the css-only baseline.
- **Edge style**: rounded corners on cards (~6–10% of card width), a thin 1px shadow under each card to suggest physicality. No outline on the card face itself; the shadow does the lifting.

### Lighting tone

- **Light source**: soft top-down lamp — cards in active stacks have slightly stronger shadows; cards face-down show a uniform back pattern.
- **Shadow policy**: drop-shadow under each card (blur 4–8 px, low opacity ~15%, downward y-offset 2–4 px). Stack shadows accumulate so a tall stack visibly sits above the table.
- **Atmospherics**: none on the table; subtle dust-mote sparkle is allowed for "win" celebrations only.

### Motion tone

- **Tempo**: deliberate ease-in-out tween — card moves take ~200–300ms with a slight overshoot at the destination so the card "settles" into the stack.
- **Scale**: card flip (front ↔ back) is the signature motion — 3D rotateY transition with mid-flip width clamp. Win celebrations cascade cards into the foundation.
- **Idle**: cards do not animate at rest. The table is calm.

### Reference cluster (text references only)

- Microsoft Solitaire Collection (legacy reference for the canonical tone).
- Solitaired / Solitr web variants (modern reference for card-back patterning).
- Cardistry photo references (style reference for card flip + spread).

### Outputs and code-time consequences

- Token palette commits the felt-green dominant + suit red/black accents. The dominant palette is small (4–6 colors) and stable.
- Inline svg / css renders the suit pictograms (`♠♥♦♣` are Unicode glyphs — no external svg needed); the card frame is a rounded rect with a drop-shadow filter.
- HUD elements integrate with the table (felt-toned buttons, ribbon-style score banner).

### HUD layout defaults (D28 — concept-derived)

When emitting `game-art-tokens.json` HUD tokens or `game-art-spec.json` `hud` / `menu` / `dialog` categories, default to:

- **Spacing rhythm**: `balanced8pt` — symmetric padding, comfortable score / move-count readouts. The table space carries some negative space already, so HUD does not need to add airy whitespace.
- **Surface treatment**: `borderedSoft` — flat panels with a 1px hairline border in a darker felt-green tint, soft drop-shadow underneath. Buttons use a felt-tone hover state and a satisfying click depression on press.
- **Typography weight**: regular-to-medium (400–600), serif or transitional family (Playfair Display / Lora / Source Serif) for menu titles to evoke the playing-card font tradition; rank numerics in a card-face-friendly geometric sans.
- **Border radius**: 6–10px on panels (matching the card corners), 999px on action buttons. Sharp corners feel cold against the felt.
- **Focus ring / interaction tone**: warm — 200ms gold-tone fade on hover, gentle press depression on click. Card-flip animation is the win-state celebration.

### Genre affinity (guidance, not a hard gate)

`cardClassic` is the 1st-class match for `cardSolitaire` (the canonical Solitaire tone). It works as an unusual choice for `match3` only when the project explicitly themes "playing cards as match tiles". `slidingPuzzle`, `arcadePaddle`, `arcadeSnake`, and `crowdRunner` are mismatches — the table-and-chairs context fights those genres' verbs (auto-advance + crowd dynamics in particular do not read as a card table).
