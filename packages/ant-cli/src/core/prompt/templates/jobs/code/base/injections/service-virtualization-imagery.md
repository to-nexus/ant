## Service Virtualization — Imagery

### Principle

When a virtualized adapter would normally return user-uploaded or
database-fetched imagery, the surface MUST render contextually
appropriate placeholder imagery — never an empty image source, broken
URL, or raw grey box. The same component code MUST render correctly
in both mock and production modes; mode behaviour adapts via the SV
master toggle at runtime, not via source divergence.

### Sibling SSOTs (defer)

| Sibling | Scope | Defer for |
|---|---|---|
| `ui-assets.json` (active UI source) | Design system assets | Logo / icon / decorative illustration — do NOT override |
| `service-virtualization-data` | Non-image FAKE body fields | Text / number / date / id / relation |
| `service-virtualization-contract` | Port shape + toggle grammar | Activation env var naming |

### Observation Target

For each image slot in scope, classify the source:

| Source | Owner | Mock mode | Production mode |
|---|---|---|---|
| Design system asset (logo, icon, hero illustration) | `ui-assets.json` | Same reference | Same reference |
| User-uploaded / DB-fetched content image (avatar, thumbnail, cover, gallery) | **This partial** | Placeholder via pathway below | Real source (CDN / upload pipeline / database) |

### Placeholder Pathway Selection (mock mode source)

Pick the lowest-cost pathway that still produces a contextually
meaningful placeholder:

1. **Inline SVG** — author the SVG payload directly when the image is
   deterministic and small (decorative shapes, simple iconographic
   content). Zero network, deterministic output, no new dependency.
2. **Existing library** — when the project's manifest already declares
   an iconography or illustration library, prefer one of its assets
   over introducing a new dependency. Sibling-convention observation
   applies.
3. **External placeholder service URL** — for raster imagery (avatars,
   photos, cover images) where authoring SVG is impractical. Both
   direct-response services (e.g., `placehold.co`) and services with
   3xx redirect chains (e.g., `picsum.photos` → `fastly.picsum.photos`)
   are acceptable. The framework's rendering primitive (see Rendering
   Contract below) handles delivery; placeholder URL selection is
   independent of the optimizer concern.

### Rendering Contract

The same component code MUST handle both modes. Use the framework's
rendering primitive for imagery as defined in the per-framework hint
files under `basis/techTier/framework/*.md`. Framework-specific
primitive names, optimizer-pipeline policy, and any mode-aware
attributes are enumerated there — never enumerate them in this
partial.

Why this is delegated: image-optimizer pipelines and their failure
modes vary across frameworks and across the operational environment
they run in. An optimizer that fetches upstream URLs server-side,
follows redirects, and decides validity by content-sniffing the
response body has many environment-dependent failure modes —
intermediate proxies returning HTML for the resource, restricted
egress on the redirect destination, stale negative cache entries,
third-party placeholder service flakiness — all surfacing as 400
"not a valid image" with no obvious cause. The right rendering
primitive for the current platform is a framework-axis decision; this
partial states only that some appropriate primitive is required.

### Constraints

- Do NOT leave the image source empty, point to a non-existent local
  raster, or emit a zero-byte data URI.
- Do NOT replace design-system assets defined by `ui-assets.json` —
  they are authoritative regardless of virtualization state.
- Placeholder URLs MUST be deterministic per virtualized entity —
  derive the URL from a stable identifier (entity id / index / slug).
  Random per-render URLs produce flickering UX worse than empty
  slots.
- Placeholder content category MUST match the surface — a recipe
  app's dish thumbnail is not interchangeable with a profile app's
  avatar.
- Do NOT introduce a new image library or external service when one
  is already declared in the manifest. Reuse the existing pathway.
- Do NOT inline raster bytes (base64) — bundle weight grows linearly
  with virtualized entries. Inline SVG is acceptable; raster goes
  through external placeholder or library.

### Blind Spot

Empty imagery degrades perceived quality faster than missing body
text — the image slot is the most visually prominent failure mode of
a content-driven page. Every content-image slot in scope receives an
explicit pathway decision before `<done>`. An image slot rendered
without an explicit placeholder pathway in a project that virtualizes
business connections is an incomplete render.
