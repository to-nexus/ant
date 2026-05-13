## Service Virtualization — Imagery

### Principle

**When a virtualized adapter would normally return user-uploaded or
database-fetched imagery, the surface MUST render contextually-appropriate
placeholder imagery — never an empty image source, broken URL, or raw
grey box.**

This partial is the SSOT for the **image subtype** of fake body data.
Routing among orthogonal sibling SSOTs:

| Sibling SSOT | Scope | This partial defers to it for: |
|---|---|---|
| `ui-assets.json` (active UI source) | Design system assets (logo, icon, decorative illustration) | Visual identity assets — do NOT override |
| `service-virtualization-data` | Non-image fake body fields | Everything that is not an image slot |
| `service-virtualization-contract` | Port shape + activation toggle grammar | The env var that gates whether this partial fires at runtime |

Together the three partials cover the Service Virtualization surface
without duplication.

### Observation Target

For each image slot in the work scope, classify its source and route
accordingly:

| Source | Owner | Behaviour when virtualization is active |
|---|---|---|
| Design system asset (logo, icon, hero illustration) | `ui-assets.json` | Same asset reference in both modes |
| User-uploaded / DB-fetched content image (avatar, thumbnail, cover, gallery) | **This partial** | Contextual placeholder MUST appear |

### Pathway Selection

Three pathways are available. Pick exactly one per image slot — the
choice is biased toward the lowest-cost pathway that still produces a
contextually meaningful placeholder:

1. **Inline SVG** — author the SVG payload directly when the image is
   deterministic and small (decorative shapes, simple iconographic
   content). Zero network cost, deterministic output, no new dependency.
2. **Existing library** — when the project's manifest already declares
   an iconography or illustration library, prefer one of its assets over
   introducing a new dependency. Sibling-convention observation applies.
3. **External placeholder service** — for raster imagery (avatars,
   photos, cover images) where authoring SVG is impractical, reference
   a stable public placeholder service URL.

   **Rendering constraint**: External placeholder URLs MUST bypass the
   framework's image optimizer. Use plain `<img>` (HTML element) OR the
   framework's opt-out attribute for that component. Reason: an image
   optimizer fetches the upstream URL server-side, follows redirects,
   and decides image validity by content-sniffing the response body.
   That pipeline has many environment-dependent failure modes —
   intermediate proxies returning HTML for the resource, restricted
   egress on the CDN, stale negative cache entries, third-party
   placeholder service flakiness — all surfacing as 400 "not a valid
   image" with no obvious cause. Adding observed failing hosts to the
   allowlist does not address these; the failures are upstream of the
   allowlist check. Bypassing the optimizer for placeholder URLs is
   the contract.

### Constraints

- Do NOT leave the image source empty, point to a non-existent local
  raster, or emit a zero-byte data URI
- Do NOT replace design-system assets defined by `ui-assets.json` —
  those are authoritative regardless of virtualization state
- Activation is gated by the same toggle env var that the SV adapter
  reads — exact name per the framework-aware table in
  `preview-env-contract.md §4.5`. When the production adapter is active,
  imagery comes from the real source (upload pipeline, CDN, database),
  not from this partial's pathways
- Placeholder URLs MUST be deterministic per virtualized entity — derive
  the URL from a stable identifier (entity id / index / slug) so
  re-renders show the same image. Random URLs that change every render
  produce a flickering UX worse than an empty slot
- Placeholder content category MUST match the surface being rendered —
  a recipe app's dish thumbnail is not interchangeable with a profile
  app's avatar
- Do NOT introduce a new image library or external service when one is
  already declared in the manifest. Reuse the existing pathway
- Do NOT inline raster bytes (base64) — bundle weight grows linearly
  with virtualized entries. Inline SVG is acceptable; raster goes
  through external placeholder or library
- External placeholder URLs (pathway 3) MUST NOT be rendered through
  the framework's image optimizer. See pathway 3 rendering constraint
  above. This rule trumps any framework convention that defaults to
  the optimized image component

### Blind Spot

**Empty imagery degrades perceived quality faster than missing body
text.** The fake body adapter may already provide complete fields, yet
a blank image reads as a broken application — the image slot is the
most visually prominent failure mode of a content-driven page. Treat it
with the same diligence as the data adapter itself: every content-image
slot in the scope receives an explicit pathway decision before `<done>`.
