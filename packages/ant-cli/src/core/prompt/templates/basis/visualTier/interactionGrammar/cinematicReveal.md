## Interaction Grammar: Cinematic Reveal

### Micro-interaction
**Hover**: Minimal — content should not compete with presentation motion.
**Focus**: Clear, accessible focus ring.
**Active**: Quiet press state.
**Loading**: Subtle fade or skeleton. No attention-grabbing animation.
**Empty**: Understated empty state. Let the layout breathe.
**Error**: Calm inline error. Do not break the visual rhythm.

### Presentation Motion
**Page entrance**: Staggered fade-in from bottom. Each section reveals on scroll.
**Section reveal**: Intersection Observer — 20-30% viewport threshold. Fade + upward drift.
**Parallax**: Background layers at 0.3-0.5x scroll speed. Foreground at 1x.
**Hero**: Dramatic fade-in (opacity 0→1 over 800ms, slight upward drift 20-30px).
**Duration**: Section reveals 400-600ms. Stagger 100-150ms between siblings.

Constraint: All motion MUST respect prefers-reduced-motion.
Constraint: Do NOT animate text content — only containers and media.
Constraint: Micro-interaction must stay minimal to preserve cinematic focus.
