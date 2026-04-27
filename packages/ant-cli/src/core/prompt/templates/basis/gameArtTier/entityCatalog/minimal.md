## Entity Catalog: Minimal

**Activation gate**: `gameArtTier.entityCatalog === 'minimal'`.

### Promise

The `minimal` entity catalog declares a single-shape, single-purpose set of entities — one geometry per role. The match-3 gem, the slidingPuzzle tile, the cardSolitaire pictogram, the arcadeSnake body cell, the arcadePaddle paddle / ball / brick — each is a single inline shape. No multi-frame sprites, no facing variants, no body parts.

### Entity catalog shape (3-row maximum)

When this variant is active, `game-art-assets.json`'s `entities` category lists at most 3 entries — and typically just 1–3:

| Role | Geometry | css-only realization |
|---|---|---|
| Player / focal element | One inline `kind: 'inline'` entry (svg circle or rect / css rounded box) | A 1-shape svg or a CSS-styled `<div>` with border-radius. |
| Antagonist / hazard | One inline entry, optionally a tinted variant of the player shape | Same primitive, different fill or border-color. |
| Collectible / reward | One inline entry — a single recognizable token | A simple geometric shape (circle / star using stroke-only svg). |

Beyond 3 entries the project should commit `entityCatalog === 'standard'` instead — the SBS payload is "we are not authoring distinct character art".

### Genre cross-reference (D31-revised v8 — guidance, not strict)

- `match3` → 1 gem geometry × N tinted color variants (the variants are `game-art-tokens.json` palette slots applied to the same `entities[0]` shape; the catalog itself stays minimal).
- `slidingPuzzle` → 1 tile shape × the goal-state markers (e.g. number labels rendered as text overlay, not a separate sprite).
- `cardSolitaire` → 1 card-frame shape; the suit pictogram (`♠♥♦♣`) is a Unicode glyph rendered on top, not a separate entity.
- `arcadePaddle` → paddle + ball + brick = 3 entries, each a single rectangle.
- `arcadeSnake` → head + body-cell + food = 3 entries; the body extension uses repeated body-cell instances.

### Code-time consequences

- `BootScene.preload` (Phaser): no external `texture.add*` calls — entities are drawn at spawn time via `Graphics.fillRect` / `Graphics.fillCircle` or rendered as DOM `<div>` overlays for Phaser-React hybrids.
- Sprite atlas / spritesheet plumbing is out of scope. Phase 4's external-asset hook (`audioProfile === 'fileBased'`) does NOT activate sprite atlases for `entityCatalog === 'minimal'`.
- Animation = transform-only (translate / rotate / scale). No sprite-frame swaps.

### Phase scope

`minimal` sits comfortably at the baseline visual scope (`_meta.visualScope === 'baseline'`). It works under both visual scopes — `'atlas-enabled'` does not change the entity catalog (only atlas / multi-emitter / multi-projectile setups activate), and `audioScope` is independent.

### Blind-spot reminders

- ⚠️ A `minimal` entry that depends on a multi-frame sprite belongs in `standard` instead — declaring a Phase 4 sprite atlas while keeping `entityCatalog === 'minimal'` is an inconsistency.
- ⚠️ The `_meta.entityCount` field (if recorded) should match the actual `entities` array length; LLM emissions occasionally inflate the meta count beyond the catalog rows.
