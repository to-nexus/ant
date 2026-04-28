## 🎨 Game-Art Design Overlay (D21 — inline-payload ceiling)

This preamble is injected for game-art **design** intents (`gen-game-art-figma` /
`gen-game-art-desc` / `rev-game-art`). It defines the responsibility boundary of
game-art design — what kinds of assets the LLM is allowed to author inline
versus what must be sourced from disk.

The "css-only" framing below describes the **design-time inline complexity
ceiling** (what the LLM may author into a JSON payload). It is independent
from the code job's canvas rendering policy (see
`jobs/code/basis/gameArtTier/_preamble.md` §1.2 / §7) — the engine canvas at
runtime cannot use CSS, and the code job has its own enumeration of legal
canvas-side methods.

### 1. Responsibility — what game-art design IS

Game-art design produces three artifacts under `visual/game-art/ant/` (sub-sourced canonical, mirrors `visual/ui/ant/`):

- **`game-art-tokens.json`** — palette / silhouette / lighting / motion-tone
  derived from `gameArtTier.concept`. **D28** — also carries HUD CSS
  tokens (spacing rhythm, typography stack / weight, border radius, shadow,
  focus ring) so the React HUD overlay and the in-canvas surface share one
  art direction. Reasonable defaults come from the active concept .md
  (`HUD layout defaults` section); the LLM may override per game's PRD.
- **`game-art-assets.json`** — a catalog of asset entries, each carrying
  a `kind: 'inline' | 'external'` discriminator (D20).
- **`game-art-spec.json`** — per-category behavior / motion / interaction
  specs that reference asset ids from the catalog.

Art design's job is to:

1. **Map** existing user-placed assets at `assets/game/{category}/`
   to catalog entries with `kind: 'external'` and the verbatim `src`.
2. **Generate** simple inline assets (`kind: 'inline'`) for shapes the
   game needs at the css-only scope.
3. **Commit HUD tokens** — emit HUD CSS values in `game-art-tokens.json`
   (D28). Defaults derive from `gameArtTier.concept` so a service-domain
   visualTier is never needed for a game project.

### 2. The css-only scope (do NOT exceed)

`kind: 'inline'` entries MUST stay at the css-only complexity ceiling.
Allowed inline asset shapes:

| Format        | When                                                                           |
|---------------|--------------------------------------------------------------------------------|
| `css`         | Solid color tiles, simple gradients, geometric shapes (circle, square, hex).   |
| `svg`         | ≤5 path / circle / rect primitives; no detailed character art.                 |
| `oscillator`  | Web Audio Oscillator config (`type`, `frequency`, `durationMs`, `gain`).       |

❌ Do NOT generate:

- Multi-layer character illustrations.
- Detailed sprite sheets / animation frames.
- Photorealistic textures or backgrounds.
- Mp3 / ogg / wav file payloads (binary content).
- 3D models / tilemaps / atlas frames.

The decompose / docGen pipeline rejects inline payloads above this
ceiling (svg path complexity, css length) — escalate to `kind: 'external'`
and let the user place the production asset themselves.

### 3. External asset hand-off (production assets)

When the game needs assets above the css-only ceiling, art design
records `kind: 'external'` entries pointing into `assets/game/`
(service / game pools are domain-1:1 separated, I6).
The user (or, in Phase 5+, a `visual` job) is responsible for placing
the actual file at the recorded path:

```
assets/game/
├── entities/    # character / object sprites (.svg, .png)
├── particles/   # particle textures (.png, .svg)
├── projectiles/ # bullet shapes (.svg, .png)
├── sfx/         # SFX clips (Phase 4 hook — .mp3 / .ogg / .wav)
├── bgm/         # background music (Phase 4 hook)
├── tilemaps/    # tile JSON data (.json)
└── atlas/       # sprite atlases (Phase 4 hook)
```

Art design's contract with the user is the **`src` path** — once it is
recorded in `game-art-assets.json`, downstream `code` jobs treat that
path as the authoritative location.

### 4. Scope markers (`_meta.audioScope`, `_meta.visualScope`)

`game-art-assets.json._meta` carries two independent dials, each gating a different downstream surface at runtime:

| Marker | Values | Effect |
|---|---|---|
| `_meta.audioScope` | `'procedural-only'` (default) / `'external-enabled'` | `'procedural-only'` defers external `sfx` / `bgm` entries — only inline OscillatorNode plays at runtime. `'external-enabled'` activates external audio loading. |
| `_meta.visualScope` | `'baseline'` (default) / `'atlas-enabled'` | `'baseline'` keeps the code job on catalog single-image assets + engine procedural API. `'atlas-enabled'` activates atlas / multi-emitter / multi-projectile setups (paired with `entityCatalog === 'rich'` / `particleProfile === 'heavy'` / `projectilePolicy === 'complex'`). |

If the LLM is unsure, default to `audioScope: 'procedural-only'` and `visualScope: 'baseline'`. The two markers are orthogonal — pairing `audioScope: 'external-enabled'` with `visualScope: 'baseline'` (or vice versa) is legal.

### 5. Invariants (recap — I6 / I7-revised)

- **I6 — Asset Surface Boundary**: `kind: 'external'.src` MUST start
  with `assets/game/`. Never reach into `assets/service/`
  from `game-art-assets.json` (and `ui-assets.json` is service-only —
  D28 — so cross-domain reference is structurally impossible).
- **I7-revised — Domain-Surface Boundary (D28)**: game-art design prompts /
  outputs MUST NOT use UI-surface vocabulary (`visualLanguage` /
  `surfaceSystem` / `spatialSystem` / `interactionGrammar` /
  `componentSemantics` / `visualHierarchy`) — those belong to service-domain
  `visualTier`. HUD CSS tokens (spacing / typography / radius / shadow /
  focus ring) live in `game-art-tokens.json`, with concept-derived defaults
  per `basis/gameArtTier/concept/{name}.md`.

### 6. Future hook — visual job (Phase 5+)

Production-quality sprite / sfx / 3D model creation is reserved for the
upcoming `visual` job (Phase 5+). When that job lands, it consumes
`game-art-assets.json` `kind: 'inline'` entries as **prompts** and
re-records them as `kind: 'external'` after generating the actual
assets into `assets/game/`. Today, `kind: 'inline'` is final;
nothing rewrites it after design completes.

---

## 🎨 Game-Art Design Meta-Pattern (gated to art design intents)

This section is loaded **only** when `gameArtTier` is matrix-active —
which means an `intentGroup === 'design-game-art'` intent (i.e. `gen-game-art-figma`
/ `gen-game-art-desc` / `rev-game-art`). UI / system / spec design intents
never see these notes (matrix gate enforced by `PromptBuilder.renderGameArtTier`).

### A. Asset Catalog Discipline (`game-art-assets.json`)

Every catalog entry carries `kind: 'inline' | 'external'` (D20):

| `kind`       | Source                                                                  | When                                                              |
|--------------|-------------------------------------------------------------------------|-------------------------------------------------------------------|
| `inline`     | LLM-authored within the JSON (`css` / `svg` / `oscillator` payload).    | Simple shapes, css-only scope (D21). Production assets prohibited. |
| `external`   | User-placed file under `assets/game/{category}/...`.             | Production sprites / sfx / atlas / 3D models.                     |

Decisions:

- Categorize by asset type. Standard category keys (D25 — keys are
  LLM-chosen but the canonical menu is):
  - In-canvas: `entities` / `particles` / `projectiles` / `sfx` / `bgm`
    / `tilemaps` / `atlas`
  - HUD/menu (D28): `hud` (score / coin / health glyphs) / `menu`
    (panel chrome / button glyphs) / `dialog` (icon set for confirm /
    cancel / info modals)
  Category keys must remain stable inside one design pass —
  `game-art-spec.json` references entries by `id`, so renaming after the
  fact corrupts the spec doc.
- Set `_meta.audioScope` and `_meta.visualScope` explicitly. Defaults:
  `audioScope: 'procedural-only'` (external sfx/bgm deferred) and
  `visualScope: 'baseline'` (atlas / multi-emitter / multi-projectile
  deferred). Upgrade values: `'external-enabled'` and `'atlas-enabled'`.

### B. Entity Catalog Decision (`gameArtTier.entityCatalog`)

Phase 4 axis. When the game's PRD or directive describes character /
collectible / npc requirements, decide the catalog tier:

| Variant      | Use when                                                               |
|--------------|------------------------------------------------------------------------|
| `minimal`    | Single-shape entities (matched-3 tile, paddle, ball). 1 entity / kind. |
| `standard`   | Hero + enemy + collectible. 2–4 distinct entities.                     |
| `rich`       | Multi-character roster + variants + npcs. 5+ entities.                 |

In Phase 2 the default is `minimal`; the prompt MAY emit a different
value when the directive demands it.

### C. Audio Policy Decision (`gameArtTier.audioProfile`)

Phase 4 axis. Decides whether `sfx` / `bgm` catalog entries can be
`kind: 'external'`:

| Variant       | Effect                                                                                |
|---------------|---------------------------------------------------------------------------------------|
| `procedural`  | Inline OscillatorNode configs only. Phase 2 default — works without user-placed files. |
| `fileBased`   | `kind: 'external'` mp3 / ogg / wav under `assets/game/sfx/` and `bgm/`.        |
| `hybrid`      | Procedural SFX + external BGM. Bridge mode for prototypes that already have a BGM.    |

When `audioScope === 'procedural-only'`, force `audioProfile = 'procedural'`
regardless of LLM-emitted value (the marker gates external audio).

### D. Domain-Surface Boundary (I7-revised — D28)

Game-art design is the SOLE visual SSOT for the game domain (D28). The
UI design surface (`visual/ui/ant/`) is service-domain-only —
it does NOT exist in a game workspace and game-art templates MUST NOT
borrow from it.

- ✅ DO emit HUD CSS tokens (spacing / typography / radius / shadow /
  focus ring) directly into `game-art-tokens.json` (D28). Defaults
  derive from the active `gameArtTier.concept` — see the `HUD layout
  defaults` section of each `basis/gameArtTier/concept/{name}.md`.
- ✅ DO use the dedicated HUD vocabulary (`hud` / `menu` / `dialog`
  category keys in `game-art-spec.json`). DO NOT use UI-surface terms
  like `visualLanguage` / `surfaceSystem` / `spatialSystem` — those are
  service-domain-only.
- ❌ Do NOT reference `visual/ui/ant/...` from any
  `game-art-*.json` artifact under `visual/game-art/ant/`. The
  two surfaces are vertically split by domain (D28), so there is no
  cross-link.
- ❌ Do NOT reference `assets/service/...` from
  `game-art-assets.json` (I6 — Asset Surface Boundary).
- ✅ DO reference the same PRD and system-design RAC pool as upstream
  inputs — those are domain-agnostic and feed both domains.
