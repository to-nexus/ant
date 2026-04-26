## Code-Overlay: Game-Art Tier (asset import policy)

**Activation gate**: job `code` × `gameArtTier` opted into the basis slot. Layered on top of `basis/gameArtTier/_preamble.md` (the design-side game-art ledger).

This preamble defines how a code intent **consumes** the game-art catalog at runtime. It is the code-job complement to the design-job `_preamble.md` under `jobs/design/basis/gameArtTier/`. Where the design preamble defines what art design is allowed to author (D21 — css-only scope), this file defines how the code job translates the resulting `game-art-assets.json` into running code.

### 1. Active-scope detector (`_meta.phaseScope`)

Every `game-art-assets.json` carries `_meta.phaseScope`, the explicit dial that gates external-asset import:

| `phaseScope` | Active in | Code-time effect |
|---|---|---|
| `'p2-css-only'` | Phase 3 default | Inline + external both readable, BUT all `kind: 'external'` audio entries (`sfx`, `bgm`) are suppressed at load time. Procedural OscillatorNode is the only audio path. |
| `'p4-external-enabled'` | Phase 4+ | All `kind: 'external'` entries (including audio) load. File-based audio activates. |

The code emitted by Phase 3 MUST honor `'p2-css-only'` regardless of the LLM-emitted `audioProfile`. Even if `audioProfile === 'fileBased'` slipped through, the code path stays procedural until the marker advances. Phase 4 lifts this guard.

### 2. CSS / SVG / OscillatorNode contract (inline mapping)

Inline catalog entries (D20, D21) translate into runtime values without file I/O:

| Inline `format` | Code-time materialization |
|---|---|
| `css` | A CSS-in-JS object literal (`{ background: 'linear-gradient(...)' }`) attached at sprite-spawn time, or a string template applied to `style` |
| `svg` | A `<svg>` element rendered into the engine's texture cache (Phaser: `this.textures.addBase64(id, dataUri)`); for non-engine surfaces, an inlined React component / `dangerouslySetInnerHTML` |
| `oscillator` | A `Web Audio` config object passed into `AudioContext.createOscillator()` at play time. The `AudioContext` is acquired lazily on first user gesture (browser autoplay policy) |

Constraints:

- ❌ Do NOT base64-encode the inline payload into a `data:` URL inside the catalog file — the catalog stores the raw payload (`css` string, `svg` markup, `oscillator` config). Encoding is a code-time decision.
- ❌ Do NOT bake inline SVG into JSX as plain markup when the engine wants a texture — Phaser needs `addBase64`, not `<svg>` in the DOM.
- ✅ DO cache materialized inline assets at module scope. Per-frame regeneration of the same SVG burns CPU and breaks frame budgets.

### 3. External fallback (Phase 4 hook)

`kind: 'external'` entries point at files under `inputs/assets/game/{category}/...`. In Phase 3 the only external entries that load are images (entities, particles, projectiles); audio is gated by `phaseScope`. The loading boundary is engine-specific and lives in the engine partial (e.g. `BootScene.preload` for Phaser).

When Phase 4 lifts `phaseScope` to `'p4-external-enabled'`, the same code path activates for sfx/bgm. Code emitted today MUST already have the conditional in place — `if (phaseScope !== 'p2-css-only') { /* load audio */ }` — so Phase 4 is a flag flip rather than a rewrite.

### 4. Domain-Surface Boundary (I7-revised — D28)

A game-domain code job consumes **one** asset surface — the game-art catalog under `outputs/design/game-art/`. The service-domain UI catalog (`outputs/design/ui/ant/ui-*.json`) is NOT in scope (D28 vertical split).

Both render paths in a React + Phaser host pull from the same source:

| Render surface | Reads | Loader |
|---|---|---|
| `UIScene` / React HUD overlay (menus / score / dialog) | `game-art-tokens.json` HUD CSS tokens + `game-art-spec.json` `hud` / `menu` / `dialog` categories + `game-art-assets.json` glyph entries | React imports inline SVG / CSS or external icons from `inputs/assets/game/icons/` |
| `MainScene` (game canvas) sprite / particle / projectile | `game-art-assets.json` `entities` / `particles` / `projectiles` categories | `BootScene.preload` registers textures from inline base64 or external `src` under `inputs/assets/game/{category}/` |

Forbidden cross-pollution:

- ❌ A HUD glyph MUST NOT be sourced from `outputs/design/ui/ant/ui-assets.json` (that catalog is service-domain-only — D28).
- ❌ An in-canvas sprite MUST NOT come from a `ui-source` slot.
- ❌ Engine textures (Phaser `texture.add*`) MUST NOT load from `inputs/assets/service/...` — the game pool is the only legal `external` `src` root for a game workspace.
- ❌ A game-domain code job MUST NOT import or reference `ui-tokens.json` / `ui-spec.json`. HUD CSS values come from `game-art-tokens.json` (palette / silhouette / lighting / motion-tone + HUD spacing / typography / radius / shadow).

The single-source guarantee is what keeps the in-canvas surface and the HUD surface tonally consistent — both render paths derive from the same `gameArtTier.concept` decision.

### 5. Phase scope precedence

When the LLM-emitted `audioProfile` and the catalog's `_meta.phaseScope` disagree:

| `audioProfile` | `phaseScope` | Effective audio path |
|---|---|---|
| `procedural` | `p2-css-only` | Procedural (consistent) |
| `procedural` | `p4-external-enabled` | Procedural (axis is more specific than the marker) |
| `fileBased` | `p2-css-only` | **Procedural** (marker wins — Phase 3 boundary) |
| `fileBased` | `p4-external-enabled` | File-based (consistent) |
| `hybrid` | `p2-css-only` | **Procedural for SFX, no BGM** (marker degrades) |
| `hybrid` | `p4-external-enabled` | Hybrid (consistent) |

The marker is the boundary; the axis is a hint. Phase 4 promotes the axis.

### 6. Forbidden code-time shortcuts

- ❌ Reading the catalog with `fs.readFileSync` at runtime — JSON is bundled at build time (`import catalog from '...'`).
- ❌ Mutating the catalog object at runtime — it is the design surface's output, not a runtime store.
- ❌ Caching materialized assets across `Phaser.Game` instances — each game instance owns its own texture / audio cache and tearing down without releasing causes leaks.
- ❌ Generating new inline payloads from code — inline assets are the design surface's responsibility (D21). If the game needs a shape that is not in the catalog, surface a follow-up directive to art design rather than fabricating one in code.
