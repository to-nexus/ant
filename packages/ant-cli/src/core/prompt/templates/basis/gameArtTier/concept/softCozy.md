## Art Concept: Soft Cozy

**Activation gate**: `gameArtTier.concept === 'softCozy'`.

A warm, pillowy, comforting direction — pastel volumes and gentle light, low-stress and inviting.

### Palette identity

High-lightness pastels with gentle saturation — nothing harsh.

| Slot | Tone |
|---|---|
| Primary | A soft pastel hue (mint / blush / lavender), 75–85% lightness. |
| Accent | A slightly warmer pastel for gentle emphasis. |
| Danger | A muted coral — alerting without alarming. |
| Background | Warm cream or the palest tint of the primary. |

Transitions are soft — pillowy gradients and rounded volume, never a hard flat edge fight.

### Silhouette

- **Weight**: light and plush. Rounded, chunky, huggable forms.
- **Complexity**: simple — big soft shapes, minimal sharp detail.
- **Edge style**: fully rounded (30–50% radius), filled volumes, no stroke.

### Lighting tone

- **Light source**: soft ambient with a gentle top light producing a pillowy highlight.
- **Shadow policy**: wide soft drop-shadow (12–24px blur, low opacity); no hard cast.
- **Atmospherics**: soft — faint ambient sparkle on reward, gentle bokeh acceptable.

### Motion tone

- **Tempo**: slow ease-out (300–500ms); nothing snaps.
- **Scale**: gentle — 1–2% idle bobbing, soft bounce on success.

### Reference cluster (text references only)

- Cozy / wholesome games; ceramic-toy aesthetics; soft casual puzzle tones.

### Outputs and code-time consequences

- Soft multi-stop gradients + generous soft-shadow filters; rounded rects and blobby SVG.
- High-lightness floor; avoid pure black — deep tints substitute where contrast is needed.
- `both` — soft pastel reads on a flat 2d plane or as soft-shaded 3d volumes.

### HUD layout defaults (D28 — concept-derived)

- **Spacing rhythm**: `airy8pt` — relaxed, comfortable breathing room.
- **Surface treatment**: `soft` — no border, wide soft shadow, generous rounding.
- **Typography weight**: rounded friendly sans (500), soft and legible. No serif, no heavy bold.
- **Border radius**: 16–24px panels, fully-rounded cells.
- **Focus ring / interaction tone**: gentle 250–400ms fades, a soft glow or subtle scale on focus; no harsh states.
