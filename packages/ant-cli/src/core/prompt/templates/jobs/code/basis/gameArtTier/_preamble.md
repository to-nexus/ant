## Code-Overlay: Game-Art Tier (asset import policy)

**Activation gate**: job `code` × `gameArtTier` opted into the basis slot. Layered on top of `basis/gameArtTier/_preamble.md` (the design-side game-art ledger).

This preamble defines how a code intent **consumes** the game-art catalog at runtime. It is the code-job complement to the design-job `_preamble.md` under `jobs/design/basis/gameArtTier/`. Where the design preamble defines what art design is allowed to author (D21 — design-time inline-payload ceiling), this file defines how the code job translates the resulting `game-art-assets.json` into running code.

### 1. Active-scope detectors (`_meta.audioScope`, `_meta.visualScope`)

Every `game-art-assets.json` carries two independent dials. They are orthogonal — phase progress is tracked by the surrounding pipeline, not by a shared prefix on these markers.

#### 1.1 Audio scope

| `audioScope` | Code-time effect |
|---|---|
| `'procedural-only'` | All `kind: 'external'` audio entries (`sfx`, `bgm`) are suppressed at load time. Procedural OscillatorNode is the only audio path. |
| `'external-enabled'` | All `kind: 'external'` audio entries load. File-based audio activates. |

Default: `'procedural-only'`. The code MUST honor the marker regardless of the LLM-emitted `audioProfile`. Even if `audioProfile === 'fileBased'` slipped through, the code path stays procedural until the marker advances.

#### 1.2 Visual scope

| `visualScope` | Code-time effect |
|---|---|
| `'baseline'` | Catalog `kind: 'inline'` payloads + catalog `kind: 'external'` single-image entries + the engine's immediate-mode graphics API + build-time static-asset imports + runtime procedural texture composition are all the legal canvas paths. Atlas loading, multi-emitter particle systems, and multi-projectile-kind groups are **disabled**. |
| `'atlas-enabled'` | Atlas loading + multi-emitter / multi-projectile groups activate (`entityCatalog === 'rich'` / `particleProfile === 'heavy'` / `projectilePolicy === 'complex'` reach full power). |

Default: `'baseline'`. The marker also commits a meta policy that holds across **both** values — see §6 below — naming what a code job MUST NOT introduce regardless of the visual tier.

### 2. Inline payload materialization contract

Inline catalog entries (D20, D21) translate into runtime values without file I/O:

| Inline `format` | Code-time materialization |
|---|---|
| `css` | A CSS-in-JS object literal or string template applied at sprite-spawn time. |
| `svg` | An `<svg>` element rendered into the engine's texture cache; for non-engine surfaces, an inlined component or raw HTML injection (the framework partial commits the exact prop / API name). The exact engine API name is committed by the engine partial (`basis/techTier/gameEngine/<engine>.md`). |
| `oscillator` | A procedural-audio config played via the Web Audio API at event time (the engine / framework partial commits the exact instantiation API). The audio context is acquired lazily on first user gesture (browser autoplay policy). |

Constraints:

- ❌ Do NOT base64-encode the inline payload into a `data:` URL inside the catalog file — the catalog stores the raw payload (`css` string, `svg` markup, `oscillator` config). Encoding is a code-time decision.
- ❌ Do NOT bake inline SVG into JSX as plain markup when the engine wants a texture — the engine's texture cache call (engine partial commits the name) is the right boundary.
- ✅ DO cache materialized inline assets at module scope. Per-frame regeneration of the same SVG burns CPU and breaks frame budgets.

### 3. External fallback (per-category loading rules)

`kind: 'external'` entries point at files under `assets/game/{category}/...`. The loading boundary is engine-specific and lives in the engine partial; this file commits which categories are gated by which marker.

#### 3.1 Audio categories — gated by `audioScope`

| Category | `audioScope === 'procedural-only'` | `audioScope === 'external-enabled'` |
|---|---|---|
| `sfx` | **Suppressed**. `kind: 'external'` SFX entries are ignored at load time; procedural OscillatorNode is the only audio path. | **Active**. External SFX entries load via the engine's audio loader; gameplay code calls a uniform `playSfx(id)` regardless of source. |
| `bgm` | **Suppressed**. `kind: 'external'` BGM entries are ignored; the scene runs without BGM. | **Active**. External BGM entries load and loop from a chosen entry-point scene. |

#### 3.2 Visual categories — gated by `visualScope`

| Category | `visualScope === 'baseline'` | `visualScope === 'atlas-enabled'` |
|---|---|---|
| `entities` | `kind: 'external'` single-image entries load via the engine's image loader. | Same. Atlas variants activate when `entityCatalog === 'rich'`. |
| `particles` | `kind: 'external'` single-image entries load; emitter consumes the texture. | Same; multi-emitter + ambient continuous emitters activate when `particleProfile === 'heavy'`. |
| `projectiles` | `kind: 'external'` single-image entries load; group-pool consumes the texture. | Same. Multi-projectile-kind groups activate only when `projectilePolicy === 'complex'`. |
| `atlas` | **Suppressed** (entity / particle external entries still resolve their image, but atlas manifests are not consumed). | **Active**. Atlas manifests register and animation managers consume them. |
| `tilemaps` | `kind: 'external'` `.json` loads. | Same. Independent of `visualScope`. |

#### 3.3 Conditional emit pattern

Code emitted from baseline scope onward MUST stage the audio loader behind the marker so the upgrade transition is a flag flip rather than a rewrite. The loader key is `entry.id` **verbatim** (the spec references assets by `id`), and the fetch target is the framework-servable URL for `entry.src` — NOT the raw `assets/game/...` path (see §3.4):

```ts
// BootScene.preload (illustrative — engine partial commits the API names)
if (catalog._meta.audioScope === 'external-enabled') {
  for (const entry of catalog.sfx ?? []) {
    if (entry.kind === 'external') /* engine audio loader */ (entry.id, servableUrl(entry.src));
  }
  for (const entry of catalog.bgm ?? []) {
    if (entry.kind === 'external') /* engine audio loader */ (entry.id, servableUrl(entry.src));
  }
}
// Inline OscillatorNode SFX always remain available regardless of audioScope.
```

#### 3.4 External `src` → servable URL (path convention SSOT)

`entry.src` (`assets/game/<category>/...`) is the **source-of-truth location** the design surface recorded — it is NOT assumed to be directly fetchable by the browser. At code-emission time the referenced file is made web-servable per the **framework's static-asset convention** (the code job's runtime asset-placement guidance commits the concrete destination for the active framework — e.g. a public static root vs a bundler source-tree import). The engine loader receives that derived servable URL, registered under `entry.id`. Do NOT hardcode `assets/game/...` as a fetch URL and do NOT assume a specific framework's folder here — the framework layer owns the physical destination.

The audio module wraps both subsystems behind a uniform `playSfx(id)` / `playBgm(id)` API so the gameplay code does not need a marker branch — only the loader does.

### 3b. Audio profile contract

The `audioProfile` axis names how the audio module composes the procedural and file-based paths:

| `audioProfile` | SFX path | BGM path |
|---|---|---|
| `procedural` | OscillatorNode (always) | None or stacked-oscillator looper |
| `fileBased` | Engine audio loader for SFX | Engine audio loader for BGM |
| `hybrid` | OscillatorNode (procedural) | Engine audio loader for BGM |

Under `audioScope === 'procedural-only'`, `fileBased` and `hybrid` BOTH degrade to procedural-SFX-only (the BGM half goes silent). The audio module logs the degrade once at boot so the user understands what they are hearing.

### 4. Domain-Surface Boundary (I7-revised — D28)

A game-domain code job consumes **one** asset surface — the game-art catalog under `visual/game-art/ant/` (sub-sourced canonical, mirrors `visual/ui/ant/`). The service-domain UI catalog (`visual/ui/ant/ui-*.json`) is NOT in scope (D28 vertical split).

The render paths split by **coordinate system** (see `jobs/code/domain/game.md` §7) — screen-space UI is React, world-space UI is the engine canvas. Both paths pull tokens / specs from the same `game-art-*` SSOT so the two surfaces share one art direction:

| Render path (coordinate system) | Owner | Reads | Loader |
|---|---|---|---|
| Screen-space — React HUD overlay (HUD readouts / menus / dialog / settings / page chrome) | React (HTML/CSS) | `game-art-tokens.json` HUD CSS tokens + `game-art-spec.json` `hud` / `menu` / `dialog` categories + `game-art-assets.json` glyph entries | React imports inline SVG / CSS or external icons from `assets/game/icons/` |
| World-space — engine scene (sprites / particles / projectiles) and overlay scene (sprite-anchored speech bubbles, in-world banners — typically empty for the five single-screen genres) | Engine scene | `game-art-tokens.json` palette / silhouette / lighting / motion-tone + `game-art-assets.json` `entities` / `particles` / `projectiles` categories | Boot scene preload registers textures from inline base64 or external `src` under `assets/game/{category}/` |

Forbidden cross-pollution:

- ❌ A HUD glyph MUST NOT be sourced from `visual/ui/ant/ui-assets.json` (that catalog is service-domain-only — D28).
- ❌ An in-canvas sprite MUST NOT come from a `ui-source` slot.
- ❌ Engine textures MUST NOT load from `assets/service/...` — the game pool is the only legal `external` `src` root for a game workspace.
- ❌ A game-domain code job MUST NOT import or reference `ui-tokens.json` / `ui-spec.json`. HUD CSS values come from `game-art-tokens.json` (palette / silhouette / lighting / motion-tone + HUD spacing / typography / radius / shadow).

The single-source guarantee is what keeps the in-canvas surface and the HUD surface tonally consistent — both render paths derive from the same `gameArtTier.concept` decision.

### 5. Audio scope × audio profile precedence

When the LLM-emitted `audioProfile` and the catalog's `_meta.audioScope` disagree:

| `audioProfile` | `audioScope` | Effective audio path |
|---|---|---|
| `procedural` | `procedural-only` | Procedural (consistent) |
| `procedural` | `external-enabled` | Procedural (axis is more specific than the marker) |
| `fileBased` | `procedural-only` | **Procedural** (marker wins — baseline boundary) |
| `fileBased` | `external-enabled` | File-based (consistent) |
| `hybrid` | `procedural-only` | **Procedural for SFX, no BGM** (marker degrades) |
| `hybrid` | `external-enabled` | Hybrid (consistent) |

The marker is the boundary; the axis is a hint.

### 6. Forbidden code-time shortcuts

The following are forbidden regardless of `audioScope` / `visualScope` value:

- ❌ Reading the catalog with `fs.readFileSync` at runtime — JSON is bundled at build time (`import catalog from '...'`).
- ❌ Mutating the catalog object at runtime — it is the design surface's output, not a runtime store.
- ❌ Caching materialized assets across game instance lifetimes — each instance owns its own texture / audio cache and tearing down without releasing causes leaks.
- ❌ Registering **new entries** in the engine's texture cache from code (e.g. base64-encoding a fresh SVG payload at code time and adding it as if it were a catalog entry that the spec would reference by `id`). The catalog is the design surface's output; the code job consumes it, it does not author it. A shape the catalog does not carry is first served by the §7.1 minimum-playable floor (engine draw API, reproducible from code); escalate to a follow-up directive only when the need exceeds that floor.
- ❌ **image-LLM API calls** (text-to-image model invocations of any kind) — out of scope for the code job. This responsibility is reserved for the future `visual` job (Phase 5+).
- ❌ **Insertion of image-LLM-derived assets via side channels** (pulling in a library / pre-generated file that is known to be image-LLM output). The image-LLM cut is absolute across both `visualScope` values.

### 7. Available canvas-side methods (positive enumeration)

A code job that needs to render a shape on the canvas surface has five legal categories. The category names are committed here; the **concrete API / library / browser-API names belong to the engine partial** (`basis/techTier/gameEngine/<engine>.md`) — naming them in this file would leak gameEngine-axis specifics across the gameArtTier gate (SBS violation).

1. **Engine immediate-mode graphics API** — procedural shape calls (rectangles, circles, polygons, lines, text). The engine partial commits the exact API surface.
2. **Catalog `kind: 'inline'` payload runtime materialization** — `css` / `svg` / `oscillator` payloads converted to module-scope values at first use (see §2).
3. **Catalog `kind: 'external'` asset preload** — single images load on both `visualScope` values; atlas / multi-emitter / multi-projectile setups gate behind `visualScope === 'atlas-enabled'`.
4. **Build-time static-asset import** — engine-agnostic. Any library or module-system surface that ships static assets (icons, sprites, packed images) and bundles into the build. The image-LLM cut in §6 still applies.
5. **Runtime procedural texture composition** — engine-agnostic. Deterministic code that paints onto a drawing surface and registers the result as a texture (engine partial commits the exact API). Acceptable because the output is reproducible from code, not from a generative model.

These five categories ALWAYS serve a minimum-playable render for any shape or sound (§7.1). The follow-up directive is reserved for fidelity *beyond* the floor — production-grade multi-layer art, atlas / animation richness, or the future `visual` job (image-LLM territory). Surface it for the design surface (catalog inline / external entry) or that future job, and do NOT silently violate the §6 cuts. A directive that merely lacks a catalog entry is NOT such a case — it is served by the floor.

### 7.1 Minimum-playable floor (catalog-silent fallback)

The five categories above are not just *permitted* — when the catalog is silent, using them is a **contract**. This section states the floor and its boundary with the §6 / §7 follow-up-directive language.

- **Catalog HAS the entry** (`kind: 'inline'` or `kind: 'external'`): consume it as authored. Fidelity is bounded only by the §4 markers / the design-time envelope — the floor imposes NO ceiling on a present asset and MUST NOT downgrade it to a primitive. A game WITH external / handoff assets renders them at full fidelity.
- **Catalog is SILENT** on a shape or sound the running build needs: the code job MUST construct a **minimum-playable stand-in** on the spot — category #1 (immediate-mode shapes) or #5 (procedural texture) for visuals, category #2 (materialize an inline payload) when one exists, and a procedural OscillatorNode for a needed sound. Observable outcome: a solid-color rectangle or circle stands in for an entity, a short tone marks an event — enough to be *playable*, not to look finished. **This is a floor, not art authoring.**
- **Boundary with §6.** Drawing a primitive stand-in through the engine's own draw API is reproducible from code (§5 already legitimizes this) and is always allowed. What §6 forbids is *masquerading* a self-authored asset as a catalog entry — registering a fabricated `id` the spec would then reference. The floor never does that; it renders directly.
- **Boundary with the follow-up directive.** Leaving the build unrenderable because "the catalog had no entry" is itself the violation — the floor removes that excuse. Reserve the follow-up directive for a need that genuinely exceeds the primitive floor (production art / image-LLM territory), never for basic playability.
