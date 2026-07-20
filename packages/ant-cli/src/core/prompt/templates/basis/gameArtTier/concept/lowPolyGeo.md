## Art Concept: Low-Poly Geometric

**Activation gate**: `gameArtTier.concept === 'lowPolyGeo'`.

A faceted, flat-shaded geometric direction — form built from a small number of visible planes.

### Palette identity

Clean saturated fills, one per facet-group, with value shifts creating the facet read.

| Slot | Tone |
|---|---|
| Primary | A confident mid-saturation hue applied per material group. |
| Accent | A contrasting hue for interactive / important geometry. |
| Danger | A clear warning hue that stays inside the flat-shaded scheme. |
| Background | A simple gradient sky or single-tone field; horizon-based depth. |

Each facet reads as one flat color; adjacent facets differ in value to express form under a single light.

### Silhouette

- **Weight**: medium. Angular, faceted forms with readable geometric mass.
- **Complexity**: simple-to-moderate — low triangle count is the aesthetic, not a limitation.
- **Edge style**: crisp facet boundaries; no outline, no texture — the polygon edges do the work.

### Lighting tone

- **Light source**: a single clear directional light producing per-facet value steps.
- **Shadow policy**: flat-shaded self-shadowing via facet value; simple ground contact shadow.
- **Atmospherics**: light fog / depth gradient acceptable to seat forms in space.

### Motion tone

- **Tempo**: clean eased motion with a slight mechanical precision.
- **Scale**: moderate — rotation and translation of solid forms; subtle idle bob.

### Reference cluster (text references only)

- Low-poly indie 3D; faceted diorama scenes; flat-shaded geometric worlds.

### Outputs and code-time consequences

- Built from code-only primitives (box / sphere / cylinder / ground) via the `enable3d` extension — no imported models.
- Per-material flat colors with light-driven facet shading; a single directional light seats the scene.
- `3d` — this is a dimensional style; the faceted read depends on a real camera and light.

### HUD layout defaults (D28 — concept-derived)

- **Spacing rhythm**: `balanced8pt` — clean, structured.
- **Surface treatment**: `soft` — flat panels with a crisp edge; minimal, geometry-consistent.
- **Typography weight**: geometric sans (500–700); precise and modern.
- **Border radius**: 4–12px, consistent and slightly angular.
- **Focus ring / interaction tone**: a crisp accent outline + subtle depth/lift on focus; clean eased transitions.
