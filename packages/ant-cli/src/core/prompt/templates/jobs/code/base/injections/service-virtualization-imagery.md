## Service Virtualization — Imagery

### Principle

When a virtualized adapter would normally return user-uploaded or
database-fetched imagery, the surface MUST render contextually
appropriate placeholder imagery — never an empty image source, broken
URL, or raw grey box. **The same component code MUST render correctly
in both mock and production modes**; mode behaviour adapts via the SV
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
   photos, cover images) where authoring SVG is impractical. Prefer
   services that return the image directly (e.g., `placehold.co`);
   services with 3xx redirect chains (e.g., `picsum.photos` →
   `fastly.picsum.photos`) are acceptable because the Rendering
   Contract below bypasses the optimizer in mock mode.

### Rendering Contract (mode-aware via SV master toggle)

The same component code MUST handle both modes by binding the
optimizer-bypass attribute to the SV master toggle. Mode behaviour is
runtime; no source change at mode-switch.

Wiring per framework:

| Framework | Pattern |
|---|---|
| Next.js | `<Image src={url} unoptimized={isMockMode()} ... />` |
| Vite (React / Vue) | same pattern, helper reads `import.meta.env.VITE_USE_MOCK` |

The `isMockMode()` helper lives once in `shared/lib/` (or the
equivalent shared location) and reads the framework-prefixed master
toggle defined by `preview-env-contract.md §4.5`:
`NEXT_PUBLIC_USE_MOCK` for Next.js, `VITE_USE_MOCK` for Vite. One
helper, imported by every component that renders virtualizable
imagery.

Why mode-aware: an image optimizer fetches the upstream URL
server-side, follows redirects, and decides image validity by
content-sniffing the response body. That pipeline has many
environment-dependent failure modes — intermediate proxies returning
HTML for the resource, restricted egress on the redirect destination,
stale negative cache entries, third-party placeholder service
flakiness — all surfacing as 400 "not a valid image" with no obvious
cause. Adding observed failing hosts to the allowlist does NOT
address these; the failures are upstream of the allowlist check.
Mock mode bypasses the pipeline entirely. Production mode keeps the
optimizer ON because the real CDN is presumed stable and the auto
sizing / lazy loading / format conversion benefits matter.

### Constraints

- Do NOT replace `<Image>` (or the framework equivalent) with plain
  `<img>` permanently. Plain `<img>` loses optimizer benefits in
  production mode and forces a refactor at mode-switch.
- Do NOT hardcode `unoptimized={true}`. The binding MUST be runtime
  via the SV master toggle so mode-switching requires zero source
  change.
- Do NOT add `remotePatterns` (or equivalent allowlist) entries for
  the redirect targets of placeholder services as a fix path. The
  optimizer's failure is downstream of the allowlist; enumerating
  hosts is a band-aid that does not address the body-sniff failure
  mode.
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
explicit pathway decision AND the SV-toggle-bound rendering wiring
before `<done>`. A `<Image>` without `unoptimized={isMockMode()}` (or
the framework equivalent) in a project that virtualizes business
connections is an incomplete render.
