## Interaction Grammar: Raw Instant

### Micro-interaction
**Hover**: Immediate state swap — background color toggle or underline. No transition.
**Focus**: High-contrast focus outline. Functional, not decorative.
**Active**: Instant visual inversion or stark color change. Zero delay.
**Loading**: Raw progress indicator or plain text status. No polish.
**Empty**: Blunt text message. No illustration, no embellishment.
**Error**: Bold error color + direct message. No softening.

### Presentation Motion
**Page entrance**: None. Content appears instantly. No fade, no slide.
**Section reveal**: None. Everything renders at once.
**Parallax**: None.
**Hero**: Static. Intentionally abrupt presence.
**Duration**: 0ms or near-0ms. Intentionally jarring transitions are acceptable.

Constraint: All motion MUST respect prefers-reduced-motion.
Constraint: Do NOT add transition properties unless explicitly required by interaction state.
Constraint: Rawness is intentional — do NOT smooth or polish the experience.
