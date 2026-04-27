## Art Concept: Soft Pastel

**Activation gate**: `gameArtTier.concept === 'softPastel'`.

### Palette identity

Pastel hues with pillowy gradients — the cozy mobile-game palette tuned for low arousal and long sessions.

| Slot | Tone |
|---|---|
| Primary | Pastel mint, blush pink, lavender, sky blue, butter yellow — values around 75–85% lightness, saturation 30–55%. |
| Accent | A warmer pastel (peach / coral) reserved for the active or scoring cell. Accent saturation runs ~10% higher than primaries. |
| Danger | Warm rose or coral — never red. The genre this concept serves rarely wants alarm; the danger color is more "warning" than "alarm". |
| Background | Cream, near-white pastel (#FFF6F0 / #F2F8FF), or a wash of the dominant primary at ~95% lightness. |

The palette ratio: pastel primaries ~50%, near-white background ~30%, warm accent ~15%, soft danger ~5%. The overall feel is "ceramic toy" — every surface has a soft glow.

### Silhouette

- **Weight**: light. Round shapes, plush proportions, generous corner radius.
- **Complexity**: low — large readable forms, occasional inner highlight to suggest a sphere or pillow. No outlines.
- **Edge style**: anti-aliased rounded corners (border-radius around 30–50% of the cell dimension), no stroke. The shapes are filled volumes.

### Lighting tone

- **Light source**: ambient + a soft top-light. Often expressed as a subtle inner highlight (lighter pastel at the top of a circle, darker at the bottom).
- **Shadow policy**: pillowy drop-shadow (blur 12–24 px, low opacity 8–12%, slight downward y-offset). Cast shadows are uniform — no directional drama.
- **Atmospherics**: subtle ambient sparkle on win states; no haze, no dust, no rain.

### Motion tone

- **Tempo**: slow ease-out (~300–500ms). Soft-pastel motion never snaps — every transition has settle time.
- **Scale**: gentle pulse on win moments (scale-up 5%), almost invisible idle motion.
- **Idle**: gentle bobbing (1–2% scale oscillation, 2-second period); never a hard movement.

### Reference cluster (text references only)

- Two Dots, Threes, Alto's Adventure (cozy puzzle / casual references).
- Animal Crossing: Pocket Camp (palette / softness reference).
- Studio Ghibli backgrounds (style reference for muted gradient).

### Outputs and code-time consequences

- Token palette favors HSL with high lightness floors (≥ 70%) and moderate saturation (~30–55%).
- Inline css linear-gradient + radial-gradient does most of the lighting work; svg shapes are simple ellipses / rounded rects.
- HUD elements use slow ease-out tweens; instant feedback feels jarring against the calm tone.

### HUD layout defaults (D28 — concept-derived)

When emitting `game-art-tokens.json` HUD tokens or `game-art-spec.json` `hud` / `menu` / `dialog` categories, default to:

- **Spacing rhythm**: `airy8pt` — generous whitespace around HUD panels, breathable readouts. Compact density reads stressful in this concept.
- **Surface treatment**: `soft` (pillowy drop-shadow, no border) — high border-radius (16–24px), inner highlight on cards. Buttons swell gently on hover (~3% scale-up over 250ms).
- **Typography weight**: medium (500), rounded sans-serif (e.g. Quicksand / Nunito / Comfortaa). Bold weights only for primary actions; serif breaks the calm.
- **Border radius**: 16–24px on panels, 999px (pill) on action buttons, 50% on indicator dots. Sharp corners read aggressive against the pastel palette.
- **Focus ring / interaction tone**: gentle — 250–400ms color-fade on hover, soft scale-up on press, settle-back on release. Never an instant snap.

### Genre affinity (guidance, not a hard gate)

`softPastel` is the 1st-class match for cozy `match3` (Two Dots / Threes tone) and works naturally for `cardSolitaire` casual variants. `slidingPuzzle` benefits when the project wants a "puzzle book on a rainy afternoon" tone. `arcadePaddle`, `arcadeSnake`, and `crowdRunner` are unusual fits — the survive loop's tension expects sharper feedback than soft-pastel naturally provides; only adopt for a calmer "drone garden / paper-craft procession" reframing of the genre.
