## Mock Content Imagery

### Principle
**When `USE_MOCK` activates a mock adapter, image slots that would normally be filled by user-uploaded or database-fetched content MUST render contextually-appropriate placeholder imagery — never an empty image source, broken URL, or raw grey box.**

This partial is the SSOT for **content imagery** — images whose source is the mock data itself. It is orthogonal to two sibling SSOTs:

| Sibling SSOT | Scope | This partial defers to it for: |
|--------------|-------|--------------------------------|
| `ui-assets.json` (active UI source) | Design system assets (logo, icon, decorative illustration) | Visual identity assets — do NOT override |
| `mock-adapter-contract` | Mock data body (text, count, timestamp, IDs) | Non-image data fields |

Together the three SSOTs cover the mock-use surface; this partial fills the gap the other two do not address.

### Observation Target

For each image slot in the work scope, classify its source and route accordingly:

| Source | Owner | Behaviour under `USE_MOCK=true` |
|--------|-------|---------------------------------|
| Design system asset (logo, icon, hero illustration) | `ui-assets.json` | Same asset reference in both modes |
| User-uploaded / DB-fetched content image (avatar, thumbnail, cover, gallery) | **This partial** | Contextual placeholder MUST appear |
| Pure data field (text, number, date) | `mock-adapter-contract` | Mock value via adapter |

### Pathway Selection

Three pathways are available. Pick exactly one per image slot — the choice is biased toward the lowest-cost pathway that still produces a contextually meaningful placeholder:

1. **Inline SVG** — author the SVG payload directly when the image is deterministic and small (decorative shapes, simple iconographic content). Zero network cost, deterministic output, no new dependency.
2. **Existing library** — when the project's manifest already declares an iconography or illustration library, prefer one of its assets over introducing a new dependency. Sibling-convention observation applies.
3. **External placeholder service** — for raster mocks (avatars, photos, cover images) where authoring SVG is impractical, reference a stable public placeholder service URL.

### Constraints

- Do NOT leave the image source empty, point to a non-existent local raster, or emit a zero-byte data URI.
- Do NOT replace design-system assets defined by `ui-assets.json` — those are authoritative regardless of mock state.
- Mock activation MUST be controlled by the same `USE_MOCK` env var that gates `mock-adapter-contract`. When `USE_MOCK=false`, content imagery comes from the real source (upload pipeline, CDN, database), not from this partial's pathways.
- Placeholder URLs MUST be deterministic per mock entity — derive the URL from a stable identifier (entity id / index / slug) so re-renders show the same image. Random URLs that change every render produce a flickering mock UX worse than an empty slot.
- Mock imagery MUST be context-appropriate. Placeholder content category (people, food, scenery, abstract) MUST match the surface being mocked — a recipe app's dish thumbnail is not interchangeable with a profile-app's avatar.
- Do NOT introduce a new image library or external service when one is already declared in the manifest. Reuse the existing pathway.
- Do NOT inline raster bytes (base64) for mock imagery — bundle weight grows linearly with mock entries. Inline SVG is acceptable; raster goes through external placeholder or library.

### Blind Spot

**Empty content images degrade the perceived mock quality faster than missing data.** The mock adapter may already provide complete data fields, yet a blank image reads as a broken application — the image slot is the most visually prominent failure mode of a content-driven page. Treat it with the same diligence as the data adapter itself: every content-image slot in the scope receives an explicit pathway decision before `<done>`.
