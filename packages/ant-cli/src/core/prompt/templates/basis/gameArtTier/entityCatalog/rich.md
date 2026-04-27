## Entity Catalog: Rich

**Activation gate**: `gameArtTier.entityCatalog === 'rich'`.

### Promise

The `rich` entity catalog declares a multi-character roster, multi-frame animated sprite cycles, and per-role variants. Hero / antagonist / NPC / collectible counts run 5+. This is the catalog the project commits when sprite production assets (atlases, spritesheet frames, multi-state animations) become first-class — it is the **Phase 5+ recommended tier** because css-only inline cannot reasonably author this volume.

### Entity catalog shape (5+ rows, with named state cycles)

When this variant is active, `game-art-assets.json`'s `entities` category lists 5 or more entries with the following typical roles:

| Role | Composition |
|---|---|
| Hero / player | Multi-frame spritesheet (idle, walk, jump, hit, ...). External atlas typical. |
| Hero variants | Cosmetic variants, different states, optional skins. Each variant is an entry. |
| Antagonist roster | 2–4 distinct enemy types, each with its own animation cycle. |
| NPC | Friendly / neutral characters that populate the world. |
| Collectible roster | Tiered collectibles (common / rare / legendary), each its own entry. |
| Boss | Single-instance entity with multi-stage animation. |

### Phase scope contract

`rich` requires **`_meta.visualScope === 'atlas-enabled'`** — the baseline visual scope cannot author this many distinct inline svg / CSS shapes within the design-time inline-payload ceiling (D21). If `entityCatalog === 'rich'` is emitted while `visualScope === 'baseline'`, the design pipeline downgrades the effective catalog to `standard` and surfaces a notice.

### Genre cross-reference (guidance, not strict)

- `match3`, `slidingPuzzle`, `cardSolitaire` — `rich` is unusual for these genres. Match-3 and card-solitaire do not require a multi-character roster; sliding-puzzle is reflective and does not add NPCs. Adopt `rich` only when the project explicitly introduces story characters (e.g. a match-3 with a level-map mascot roster).
- `arcadePaddle` — `rich` is unusual. The canonical paddle / ball / brick set fits `minimal` or `standard`; only adopt `rich` for thematic reskin packs.
- `arcadeSnake` — `rich` is unusual. The canonical body / food / obstacle set fits `minimal`; `rich` is reserved for narrative / shop-driven snake variants.
- `crowdRunner` — `rich` is reachable when the project commits a unit-cosmetic roster (multi-tier crowd skins + boss-stage telegraphs + variant gate glyphs). Default `crowdRunner` fits `standard`; `rich` is opt-in for projects that want production-grade unit / boss animation.

### Code-time consequences

- Phaser `BootScene.preload` performs `this.load.atlas(...)` calls for each external sprite atlas. The atlas JSON + image pairs live under `inputs/assets/game/atlas/`.
- Animation manifest: the `entities[*].animations[]` field per entry lists named cycles (`idle`, `walk`, `attack`) with frame ids and durations. The Phaser `AnimationManager` consumes this manifest 1:1.
- React HUD integration: rich character art rarely flows into HUD; HUD glyphs stay `minimal` or `standard` even when the in-canvas catalog is `rich`.

### Phase 5+ hook signal

When `entityCatalog === 'rich'` is selected today, the design pipeline emits a Phase 5+ note: production sprite assets (atlas + animation frames) are not authored by the LLM — the user (or, in Phase 5+, the visual job) places them under `inputs/assets/game/atlas/` and the catalog `src` paths reference them. The css-only inline alternative is **not viable** for this tier.

### Blind-spot reminders

- ⚠️ `rich` while `visualScope === 'baseline'` is an inconsistency — the validator should downgrade or reject.
- ⚠️ Listing 8+ entities without animation manifests is a "wide but shallow" `rich` — typically the project meant `standard` with cosmetic variants. The signal for `rich` is the **per-entry animation cycle**, not just the entry count.
- ⚠️ A `rich` catalog adopted by a `cardSolitaire` project should justify the deviation explicitly (PRD section). Otherwise downgrade to `minimal` to honor the genre's tone.
